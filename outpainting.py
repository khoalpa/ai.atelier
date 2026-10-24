"""Canvas geometry and compositing for outpainting, independent of GPU models."""
import os

import numpy as np
from PIL import Image


def integer(value, name, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or int(value) != value:
        raise ValueError(f"{name} phải là số nguyên")
    value = int(value)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} phải từ {minimum} đến {maximum}")
    return value


def prepare_canvas(source, body):
    width = integer(body.get("width"), "Chiều rộng", source.width, 8192)
    height = integer(body.get("height"), "Chiều cao", source.height, 8192)
    max_pixels = int(os.environ.get("ATELIER_OUTPAINT_MAX_PIXELS", "16777216"))
    if width * height > max_pixels:
        raise ValueError(f"Canvas vượt giới hạn {max_pixels:,} pixel; hãy giảm kích thước")
    left = integer(body.get("left", 0), "Vị trí ngang", 0, width - source.width)
    top = integer(body.get("top", 0), "Vị trí dọc", 0, height - source.height)
    right, bottom = width - source.width - left, height - source.height - top
    if not any((left, top, right, bottom)):
        raise ValueError("Hãy mở rộng ít nhất một cạnh ảnh")
    requested_overlap = integer(body.get("overlap", 32), "Dải hòa trộn", 0, 128)
    overlap = min(requested_overlap, source.width // 4 if left or right else 128,
                  source.height // 4 if top or bottom else 128)
    preserve = body.get("preserveOriginal", True)
    if not isinstance(preserve, bool):
        raise ValueError("Chế độ giữ ảnh gốc không hợp lệ")
    rgb = source.convert("RGB")
    canvas = Image.fromarray(np.pad(np.asarray(rgb), ((top, bottom), (left, right), (0, 0)), mode="edge"))
    box = (left, top, left + source.width, top + source.height)
    mask = Image.new("L", (width, height), 255)
    # Strict preservation also applies to conditioning. Regenerating source
    # hair/objects in an overlap and then pasting the original back makes an
    # otherwise coherent prediction break exactly at the source boundary.
    # Keep overlap for outward colour matching, separate from the model mask.
    conditioning_overlap = 0 if preserve else overlap
    # Only overlap edges that actually have newly generated space beside them.
    inner = (left + (min(conditioning_overlap, source.width // 2) if left else 0),
             top + (min(conditioning_overlap, source.height // 2) if top else 0),
             box[2] - (min(conditioning_overlap, source.width // 2) if right else 0),
             box[3] - (min(conditioning_overlap, source.height // 2) if bottom else 0))
    mask.paste(0, inner)
    geometry = dict(width=width, height=height, left=left, top=top, right=right, bottom=bottom,
                    sourceWidth=source.width, sourceHeight=source.height,
                    overlap=overlap, requestedOverlap=requested_overlap, preserveOriginal=preserve,
                    conditioningOverlap=conditioning_overlap)
    return canvas, mask, geometry


def prepare_inference(canvas, mask, max_side, rectangular=True):
    """Spend a square-equivalent pixel budget on the actual aspect ratio."""
    side = max(64, round(max_side / 64) * 64)
    if rectangular:
        scale = min(side / np.sqrt(canvas.width * canvas.height), side * 1.5 / max(canvas.size))
        while True:
            width, height = [max(1, round(value * scale)) for value in canvas.size]
            model_width, model_height = [max(64, int(np.ceil(value / 64)) * 64) for value in (width, height)]
            if model_width * model_height <= side * side:
                break
            scale *= .98
    else:
        scale = side / max(canvas.size)
        width, height = [max(1, min(side, round(value * scale))) for value in canvas.size]
        model_width = model_height = side
    left, top = (model_width - width) // 2, (model_height - height) // 2
    image = canvas.resize((width, height), Image.Resampling.LANCZOS)
    padded = Image.fromarray(np.pad(np.asarray(image), ((top, model_height-height-top), (left, model_width-width-left), (0, 0)), mode='edge'))
    padded_mask = Image.new('L', (model_width, model_height), 255)
    padded_mask.paste(mask.resize((width, height), Image.Resampling.NEAREST), (left, top))
    return padded, padded_mask, (left, top, left+width, top+height)


def detail_regions(mask, max_side, include_generated=False):
    """Overlapping native-resolution crops along the source boundary.

    The overview supplies global composition. Refinement needs some protected
    context in every crop, so fully masked windows are left to the overview.
    """
    if max(mask.size) <= max_side:
        return [(0, 0, *mask.size)] if include_generated and mask.getbbox() else []
    side = int(max_side)
    def positions(length):
        end = max(0, length - side)
        intervals=max(1,int(np.ceil(end/max(1,side*3//4))))
        return sorted(set(round(index*end/intervals) for index in range(intervals+1)))
    regions = []
    for top in positions(mask.height):
        for left in positions(mask.width):
            box = (left, top, min(left + side, mask.width), min(top + side, mask.height))
            values = np.asarray(mask.crop(box))
            fraction = np.count_nonzero(values) / values.size
            if fraction > 0 and (include_generated or fraction < .95):
                regions.append(box)
    return regions


class PatchAccumulator:
    """Normalize all overlapping predictions against one immutable input."""
    def __init__(self, base):
        self.base = base.convert('RGB').copy()
        self.total = np.zeros((base.height, base.width, 3), dtype=np.float32)
        self.weights = np.zeros((base.height, base.width), dtype=np.float32)
        self.texture = self.texture_weight = self.texture_key = None

    def add(self, patch, box, mask, preserve_texture=False):
        left, top, right, bottom = box
        width, height = right-left, bottom-top
        yy, xx = np.ogrid[:height, :width]
        weight = np.ones((height,width), dtype=np.float32)
        feather = max(1,min(64,width//8,height//8))
        for enabled, distance in [(left>0,xx),(top>0,yy),
                                  (right<self.base.width,width-1-xx),(bottom<self.base.height,height-1-yy)]:
            if enabled:
                weight = np.minimum(weight,np.clip((distance+.5)/feather,0,1))
        local_mask = mask if mask.size == (width, height) else mask.crop(box)
        weight *= np.asarray(local_mask,dtype=np.float32)/255
        values = np.asarray(patch.convert('RGB').resize((width,height),Image.Resampling.LANCZOS),dtype=np.float32)
        self.total[top:bottom,left:right] += values*weight[...,None]
        self.weights[top:bottom,left:right] += weight
        if preserve_texture:
            import cv2
            if self.texture is None:
                self.texture=np.zeros_like(self.total)
                self.texture_weight=np.zeros_like(self.weights)
                self.texture_key=np.full(self.weights.shape,np.iinfo(np.int64).max,dtype=np.int64)
            # Pick one detail donor, rather than averaging misaligned motifs.
            detail=values-cv2.GaussianBlur(values,(0,0),3)
            key=((top*self.base.width+left)*self.base.height+bottom)*self.base.width+right
            old_weight=self.texture_weight[top:bottom,left:right]
            old_key=self.texture_key[top:bottom,left:right]
            selected=(weight>0)&((weight>old_weight)|((weight==old_weight)&(key<old_key)))
            self.texture[top:bottom,left:right][selected]=detail[selected]
            old_weight[selected]=weight[selected];old_key[selected]=key

    def finish(self):
        predicted = self.total/np.maximum(self.weights[...,None],1e-8)
        alpha = np.minimum(self.weights,1)[...,None]
        values = np.asarray(self.base,dtype=np.float32)*(1-alpha)+predicted*alpha
        if self.texture is not None:
            import cv2
            selected=self.texture_weight>0
            low=cv2.GaussianBlur(values,(0,0),3)
            values[selected]=(low+self.texture)[selected]
        return Image.fromarray(np.uint8(np.clip(np.rint(values),0,255)))


def seam_band(geometry, width):
    """Symmetric strip only along edges that actually have new canvas."""
    yy,xx = np.ogrid[:geometry['height'],:geometry['width']]
    x,y = geometry['left'],geometry['top']
    right,bottom = x+geometry['sourceWidth'],y+geometry['sourceHeight']
    band = np.zeros((geometry['height'],geometry['width']),dtype=bool)
    if x: band |= (np.abs(xx-x)<width)&(yy>=y-width)&(yy<bottom+width)
    if geometry['right']: band |= (np.abs(xx-(right-1))<width)&(yy>=y-width)&(yy<bottom+width)
    if y: band |= (np.abs(yy-y)<width)&(xx>=x-width)&(xx<right+width)
    if geometry['bottom']: band |= (np.abs(yy-(bottom-1))<width)&(xx>=x-width)&(xx<right+width)
    if geometry['preserveOriginal']:
        band[y:bottom,x:right] = False
    return Image.fromarray(np.uint8(band)*255)


def semantic_seam_masks(geometry, width, foreground, garment, protected):
    """Project source labels a short distance outward; leave uncertain pixels alone."""
    padding=((geometry['top'],geometry['bottom']),(geometry['left'],geometry['right']))
    fg=np.pad(np.asarray(foreground.convert('L')),padding,mode='edge')
    cloth=np.pad(np.asarray(garment.convert('L')),padding,mode='edge')
    protection=np.pad(np.asarray(protected.convert('L')),padding,mode='edge')>0
    band=np.asarray(seam_band(geometry,width))>0
    background=band&(fg<32)&~protection
    clothing=band&(fg>223)&(cloth>127)&~protection
    return {'background':Image.fromarray(np.uint8(background)*255),
            'garment':Image.fromarray(np.uint8(clothing)*255)}


def background_reference_mask(geometry, foreground, protected):
    """Readable labels include the original; write permissions stay separate."""
    padding = ((geometry['top'], geometry['bottom']), (geometry['left'], geometry['right']))
    background = np.pad(np.asarray(foreground) < 32, padding, mode='edge')
    locked = np.pad(np.asarray(protected) > 0, padding, mode='edge')
    return Image.fromarray(np.uint8(background & ~locked) * 255)


def repair_regions(mask, max_side):
    if not mask.getbbox(): return []
    if max(mask.size)<=max_side: return [(0,0,*mask.size)]
    return detail_regions(mask,max_side)


def multiband_background(base, candidate, mask):
    """Blend low and high frequencies separately, bounded by the supplied mask."""
    import cv2
    a=np.asarray(base.convert('RGB'),dtype=np.float32)
    b=np.asarray(candidate.convert('RGB'),dtype=np.float32)
    m=np.asarray(mask.convert('L'),dtype=np.float32)/255
    if not np.any(m): return candidate
    ga,gb,gm=[a],[b],[m]
    for _ in range(4):
        if min(ga[-1].shape[:2])<8: break
        ga.append(cv2.pyrDown(ga[-1]));gb.append(cv2.pyrDown(gb[-1]));gm.append(cv2.pyrDown(gm[-1]))
    mixed=ga[-1]*(1-gm[-1][...,None])+gb[-1]*gm[-1][...,None]
    for index in range(len(ga)-2,-1,-1):
        size=(ga[index].shape[1],ga[index].shape[0])
        la=ga[index]-cv2.pyrUp(ga[index+1],dstsize=size)
        lb=gb[index]-cv2.pyrUp(gb[index+1],dstsize=size)
        mixed=cv2.pyrUp(mixed,dstsize=size)+la*(1-gm[index][...,None])+lb*gm[index][...,None]
    # Never spill the pyramid blend into clothing, protected areas or the core.
    output=np.asarray(candidate.convert('RGB')).copy()
    selected=m>0
    output[selected]=np.uint8(np.clip(mixed[selected],0,255))
    return Image.fromarray(output)


def restore_source_core(source, candidate, geometry, editable, protected, width):
    """Allow only a feathered semantic seam strip inside the source rectangle."""
    x,y=geometry['left'],geometry['top']
    box=(x,y,x+source.width,y+source.height)
    alpha=np.asarray(editable.crop(box),dtype=np.float32)/255
    yy,xx=np.ogrid[:source.height,:source.width]
    distance=np.full((source.height,source.width),float(width))
    for enabled,d in [(x,xx),(geometry['right'],source.width-1-xx),
                      (y,yy),(geometry['bottom'],source.height-1-yy)]:
        if enabled: distance=np.minimum(distance,d)
    alpha*=np.clip(1-distance/max(1,width),0,1)
    alpha[np.asarray(protected)>0]=0
    if geometry['preserveOriginal']: alpha[:]=0
    result=candidate.copy()
    result.paste(Image.composite(candidate.crop(box),source.convert('RGB'),Image.fromarray(np.uint8(alpha*255))),(x,y))
    return result


def feather_seam_result(base, candidate, editable, width=24):
    """Taper the repair boundary so it cannot introduce a new hard cut outside."""
    import cv2
    distance=cv2.distanceTransform((np.asarray(editable)>0).astype(np.uint8),cv2.DIST_L2,5)
    alpha=np.clip((distance-1)/max(1,width),0,1)
    alpha=alpha*alpha*(3-2*alpha)
    return Image.composite(candidate.convert('RGB'),base.convert('RGB'),Image.fromarray(np.uint8(alpha*255)))


def preserve_fabric_texture(source, baseline, candidate, geometry, garment, protected):
    """Keep available fabric frequencies while retaining repaired low-frequency colour.

    Source-side detail comes from the original. Outside it, select one existing
    donor by local detail energy. This cannot recover texture absent from both.
    """
    import cv2
    current=np.asarray(candidate.convert('RGB'),dtype=np.float32)
    reference=np.asarray(baseline.convert('RGB'),dtype=np.float32)
    x,y=geometry['left'],geometry['top']
    high_current=current-cv2.GaussianBlur(current,(0,0),3)
    high_reference=reference-cv2.GaussianBlur(reference,(0,0),3)
    energy_current=cv2.GaussianBlur(np.mean(high_current**2,axis=2),(0,0),5)
    energy_reference=cv2.GaussianBlur(np.mean(high_reference**2,axis=2),(0,0),5)
    donor=high_current.copy()
    use_reference=energy_reference>energy_current*1.05
    donor[use_reference]=high_reference[use_reference]
    # Filter the source on its own canvas to avoid a false high-frequency seam.
    original=np.asarray(source.convert('RGB'),dtype=np.float32)
    original_high=original-cv2.GaussianBlur(original,(0,0),3)
    donor[y:y+source.height,x:x+source.width]=original_high
    active=np.asarray(garment)>0
    guard=np.zeros(active.shape,dtype=bool)
    guard[y:y+source.height,x:x+source.width]=np.asarray(protected)>0
    active &= ~guard
    if geometry['preserveOriginal']: active[y:y+source.height,x:x+source.width]=False
    distance=cv2.distanceTransform(active.astype(np.uint8),cv2.DIST_L2,5)
    alpha=np.clip((distance-1)/3,0,1)
    restored=cv2.GaussianBlur(current,(0,0),3)+donor
    values=current*(1-alpha[...,None])+restored*alpha[...,None]
    output=np.asarray(candidate.convert('RGB')).copy()
    output[active]=np.uint8(np.clip(np.rint(values[active]),0,255))
    return Image.fromarray(output)


def equalize_background_seams(candidate, geometry, background, width=40, reference=None):
    """Bridge broad colour bands only within confidently labelled background.

    Endpoints must both be background; never bridge across a subject silhouette.
    Keep fine residual detail, correcting the low-frequency band only.
    """
    import cv2
    values=np.asarray(candidate.convert('RGB'),dtype=np.float32)
    output=values.copy()
    allowed=np.asarray(background)>0
    readable=np.asarray(reference if reference is not None else background)>0
    x,y=geometry['left'],geometry['top']
    for enabled,axis,edge in [(x,1,x),(geometry['right'],1,x+geometry['sourceWidth']),
                              (y,0,y),(geometry['bottom'],0,y+geometry['sourceHeight'])]:
        if not enabled: continue
        a=max(0,edge-width);b=min(values.shape[axis]-1,edge+width)
        if b-a<4: continue
        # Smooth along the seam, not across it: a cross-seam blur turns the
        # very band we are removing into a high-frequency ringing residual.
        low=cv2.GaussianBlur(values,(1,13) if axis==1 else (13,1),2)
        continuous = readable[:,a:b+1].all(axis=1) if axis==1 else readable[a:b+1].all(axis=0)
        for position in range(a,b+1):
            t=(position-a)/(b-a)
            taper=min(1,(position-a)/8,(b-position)/8)
            if axis==1:
                valid=allowed[:,position]&continuous
                target=low[:,a]*(1-t)+low[:,b]*t
                output[valid,position]+=(target-low[:,position])[valid]*taper
            else:
                valid=allowed[position]&continuous
                target=low[a]*(1-t)+low[b]*t
                output[position,valid]+=(target-low[position])[valid]*taper
        if geometry['preserveOriginal']:
            # A Gaussian residual next to a dark band can create a bright rim.
            # Anchor the generated side back to readable source pixels only.
            negative_side = (axis == 1 and edge == x) or (axis == 0 and edge == y)
            source_pos, outside_pos = (edge, edge-1) if negative_side else (edge-1, edge)
            direction = -1 if negative_side else 1
            delta = (values[:,source_pos]-output[:,outside_pos]) if axis==1 else (values[source_pos]-output[outside_pos])
            delta = np.clip(delta,-32,32)
            for distance in range(width):
                position=outside_pos+direction*distance
                if not 0 <= position < values.shape[axis]: break
                adjustment=delta*(1-distance/max(1,width))**2
                if axis==1:
                    valid=allowed[:,position]&continuous
                    output[valid,position]+=adjustment[valid]
                else:
                    valid=allowed[position]&continuous
                    output[position,valid]+=adjustment[valid]
    if geometry['preserveOriginal']:
        output[y:y+geometry['sourceHeight'],x:x+geometry['sourceWidth']]=values[y:y+geometry['sourceHeight'],x:x+geometry['sourceWidth']]
    return Image.fromarray(np.uint8(np.clip(np.rint(output),0,255)))


def seam_metrics(source, result, geometry, protected=None, editable=None):
    """Diagnostics, not a perceptual quality score: boundary jumps and preservation."""
    values=np.asarray(result.convert('RGB'),dtype=np.float32)
    original=np.asarray(source.convert('RGB'),dtype=np.float32)
    x,y=geometry['left'],geometry['top'];h,w=original.shape[:2]
    jumps=[]
    if x: jumps.append(np.abs(values[y:y+h,x]-values[y:y+h,x-1]).mean())
    if geometry['right']: jumps.append(np.abs(values[y:y+h,x+w]-values[y:y+h,x+w-1]).mean())
    if y: jumps.append(np.abs(values[y,x:x+w]-values[y-1,x:x+w]).mean())
    if geometry['bottom']: jumps.append(np.abs(values[y+h,x:x+w]-values[y+h-1,x:x+w]).mean())
    difference=np.abs(values[y:y+h,x:x+w]-original)
    selected=np.asarray(protected)>0 if protected is not None else np.ones((h,w),dtype=bool)
    core=np.asarray(editable.crop((x,y,x+w,y+h)))==0 if editable is not None else None
    return {'boundaryJumpMean':round(float(np.mean(jumps)),4) if jumps else 0,
            'protectedMAE':round(float(difference[selected].mean()),6) if np.any(selected) else 0,
            'sourceCoreMAE':round(float(difference[core].mean()),6) if core is not None and np.any(core) else None,
            'note':'Boundary jump measures pixel discontinuity only, not semantic or aesthetic quality.'}


def material_detail_masks(geometry, foreground, garment, protected):
    """Use labels from the generated image, never stretch source silhouettes."""
    fg=np.asarray(foreground)
    locked=np.asarray(protected)>0
    cloth=(fg>223)&(np.asarray(garment)>127)&~locked
    background=(fg<32)&~locked
    x,y=geometry['left'],geometry['top']
    for selected in (cloth,background):
        selected[y:y+geometry['sourceHeight'],x:x+geometry['sourceWidth']]=False
    return {'garment':Image.fromarray(np.uint8(cloth)*255),
            'background':Image.fromarray(np.uint8(background)*255)}


def finish_materials(candidate, foreground, garment, protected, geometry, enhance_source=False):
    """Bounded luminance detail on fabric and mild edge-aware background denoising.

    No generative changes to the source. Identity, uncertain labels and source
    pixels in preservation mode remain byte-identical to the supplied candidate.
    """
    import cv2
    rgb=np.asarray(candidate.convert('RGB'),dtype=np.float32)
    locked=np.asarray(protected)>0
    cloth=(np.asarray(garment)>127)&(np.asarray(foreground)>223)&~locked
    background=(np.asarray(foreground)<32)&~locked
    x,y=geometry['left'],geometry['top']
    if not enhance_source or geometry['preserveOriginal']:
        for selected in (cloth,background):
            selected[y:y+geometry['sourceHeight'],x:x+geometry['sourceWidth']]=False
    luminance=rgb@np.array([.2126,.7152,.0722],dtype=np.float32)
    high=luminance-cv2.GaussianBlur(luminance,(0,0),1)
    # Threshold tiny variations so compression noise is not sharpened.
    detail=np.clip(np.sign(high)*np.maximum(np.abs(high)-1.5,0)*.3,-6,6)
    smooth=cv2.bilateralFilter(rgb,5,8,3)
    output=rgb.copy()
    for selected,change in ((cloth,np.repeat(detail[...,None],3,axis=2)),
                            (background,(smooth-rgb)*.2)):
        distance=cv2.distanceTransform(selected.astype(np.uint8),cv2.DIST_L2,5)
        alpha=np.clip((distance-1)/3,0,1)
        output+=change*alpha[...,None]
    return Image.fromarray(np.uint8(np.clip(np.rint(output),0,255)))


def merge_detail(canvas, patch, box, mask):
    """Feather crop borders only, never copy stretched source-edge pixels."""
    left, top, right, bottom = box
    width, height = right-left, bottom-top
    yy, xx = np.ogrid[:height, :width]
    weight = np.ones((height, width), dtype=np.float32)
    feather = max(1, min(64, width // 8, height // 8))
    for enabled, distance in [(left > 0, xx), (top > 0, yy),
                              (right < canvas.width, width-1-xx),
                              (bottom < canvas.height, height-1-yy)]:
        if enabled:
            weight = np.minimum(weight, np.clip(distance / feather, 0, 1))
    weight *= np.asarray(mask.crop(box), dtype=np.float32) / 255
    alpha = Image.fromarray(np.uint8(weight * 255))
    canvas.paste(Image.composite(patch.resize((width, height), Image.Resampling.LANCZOS).convert('RGB'),
                                 canvas.crop(box), alpha), (left, top))
    return canvas


def match_boundary_colours(source, generated, geometry):
    """Correct low-frequency edge colour without stretching source textures."""
    band = geometry['overlap']
    if not band:
        return generated
    pixels = np.asarray(generated, dtype=np.float32).copy()
    original = np.asarray(source.convert('RGB'), dtype=np.float32)
    x, y = geometry['left'], geometry['top']
    width, height = source.size
    def smooth(values):
        radius = min(15, max(0, (len(values)-1)//2))
        if not radius:
            return np.clip(values, -32, 32)
        padded = np.pad(values, ((radius,radius),(0,0)), mode='edge')
        kernel = np.ones(2*radius+1)/(2*radius+1)
        return np.clip(np.stack([np.convolve(padded[:,c], kernel, mode='valid') for c in range(3)],axis=1), -32, 32)
    # Each correction is additive and decays outwards. Generated texture remains.
    for enabled, axis, edge, reference, start, length, direction in [
        (x, 1, x-1, original[:,0], y, height, -1),
        (geometry['right'], 1, x+width, original[:,-1], y, height, 1),
        (y, 0, y-1, original[0], x, width, -1),
        (geometry['bottom'], 0, y+height, original[-1], x, width, 1),
    ]:
        if not enabled:
            continue
        sample = pixels[start:start+length,edge] if axis==1 else pixels[edge,start:start+length]
        correction = smooth(reference-sample)
        full_length = generated.height if axis==1 else generated.width
        correction = np.pad(correction, ((start,full_length-start-length),(0,0)), mode='edge')
        for distance in range(min(band, int(enabled))):
            position = edge + direction*distance
            adjustment = correction * (1-distance/band)**2
            if axis==1:
                pixels[:,position] += adjustment
            else:
                pixels[position] += adjustment
    return Image.fromarray(np.uint8(np.clip(pixels,0,255)))


def composite_canvas(source, generated, geometry):
    size = (geometry["width"], geometry["height"])
    generated = generated.convert("RGB").resize(size, Image.Resampling.LANCZOS)
    x, y = geometry["left"], geometry["top"]
    box = (x, y, x + source.width, y + source.height)
    if geometry['preserveOriginal']:
        generated = match_boundary_colours(source, generated, geometry)
    if geometry["preserveOriginal"] or geometry["overlap"] == 0:
        generated.paste(source.convert("RGB"), (x, y))
        return generated
    # Blend only inside the source rectangle. Untouched edges have no blend band.
    yy, xx = np.ogrid[:source.height, :source.width]
    distance = np.full((source.height, source.width), float(geometry["overlap"]), dtype=np.float32)
    for enabled, edge in [(x, xx), (geometry["right"], source.width - 1 - xx),
                          (y, yy), (geometry["bottom"], source.height - 1 - yy)]:
        if enabled:
            distance = np.minimum(distance, edge)
    alpha = Image.fromarray(np.uint8(np.clip(distance / geometry["overlap"], 0, 1) * 255))
    generated.paste(Image.composite(source.convert("RGB"), generated.crop(box), alpha), (x, y))
    return generated


def continue_background_texture(source, candidate, geometry, source_foreground, candidate_foreground):
    """Match a narrow, entirely background strip using a separate source donor.

    Coarse layout remains generated. Only colour profiles and fine texture come
    from the source; no reflected people or repeated mirrored texture is used.
    This is opt-in and abstains unless both context and donor are clear of the
    foreground, with comparable texture energy. Original pixels never change.
    """
    import cv2
    info={'applied':False,'method':'source-background-detail-donor-v1','requiresVisualReview':True}
    sides=[(name,turns,geometry[name]) for name,turns in [('left',0),('top',1),('right',2),('bottom',3)] if geometry[name]]
    if len(sides)!=1 or not geometry['preserveOriginal']:
        return candidate,{**info,'reason':'requires-one-side-and-preserved-source'}
    side,turns,extent=sides[0]
    if not 16<=extent<=128 or source_foreground is None or candidate_foreground is None:
        return candidate,{**info,'reason':'unsupported-width-or-missing-labels'}
    s=np.rot90(np.asarray(source.convert('RGB'),dtype=np.float32),turns)
    g=np.rot90(np.asarray(candidate.convert('RGB'),dtype=np.float32),turns).copy()
    sf=np.rot90(np.asarray(source_foreground),turns);gf=np.rot90(np.asarray(candidate_foreground),turns)
    reference_width=min(64,s.shape[1]//4)
    if reference_width<24 or s.shape[1]<extent*3:
        return candidate,{**info,'reason':'insufficient-background-context'}
    if np.any(sf[:,:reference_width]>=16) or np.any(sf[:,-extent-24:]>=16) or np.any(gf[:,:extent]>=16):
        return candidate,{**info,'reason':'foreground-or-uncertain-donor'}
    detail=s-cv2.GaussianBlur(s,(0,0),8)
    donor=detail[:,-extent:]
    source_energy=float(np.abs(detail[:,:reference_width]).mean())
    donor_energy=float(np.abs(donor).mean())
    if source_energy<.5 or not .5<=donor_energy/max(source_energy,.001)<=2:
        return candidate,{**info,'reason':'incompatible-texture'}
    # A colour offset constant along the normal retains the generated coarse
    # shapes. The source donor supplies 2-D detail, not a stretched edge column.
    delta=s[:,:reference_width].mean(axis=1)-g[:,:extent].mean(axis=1)
    delta=cv2.GaussianBlur(delta[:,None,:],(1,0),sigmaX=0,sigmaY=24)[:,0]
    if float(np.percentile(np.abs(delta),95))>64:
        return candidate,{**info,'reason':'colour-change-too-large'}
    # Bound the proposed colour change before the independent regression gate.
    # Large mismatches are only partially corrected; never force a new palette.
    delta*=min(1.,12/max(.001,float(np.abs(delta).mean())))
    g[:,:extent]+=np.clip(delta,-64,64)[:,None,:]
    low=cv2.GaussianBlur(g,(0,0),8)
    g[:,:extent]=low[:,:extent]+donor
    edge_delta=np.clip(s[:,0]-g[:,extent-1],-32,32)
    for distance in range(min(12,extent)):
        g[:,extent-1-distance]+=edge_delta*(1-distance/12)**2
    # Float conversion/rounding must not change the protected source.
    output=np.rot90(np.uint8(np.clip(np.rint(g),0,255)),-turns).copy()
    output[geometry['top']:geometry['top']+source.height,geometry['left']:geometry['left']+source.width]=np.asarray(source.convert('RGB'))
    info.update(applied=True,side=side,width=extent,sourceTextureEnergy=round(source_energy,3),donorTextureEnergy=round(donor_energy,3))
    return Image.fromarray(output),info

