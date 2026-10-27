from prompt_catalog import prompt_text, prompt_template, catalog_value, CatalogMap, read_catalog
"""Local IDM-VTON adapter. DensePose TorchScript avoids Detectron2 on Windows."""
import sys


def canvas_size(max_side):
    """Return IDM-VTON's fixed 3:4 training aspect at the requested budget."""
    height = max(512, min(1024, int(max_side)))
    height -= height % 8
    width = round(height * 0.75 / 8) * 8
    return width, height


def description_for(category, requested=None):
    defaults = CatalogMap("featurePresets", 'idm.descriptions')
    if requested is None:
        return defaults.get(category, prompt_text('idm.genericGarment'))
    if not isinstance(requested, str) or not requested.strip() or len(requested) > 400:
        raise ValueError("Mô tả trang phục phải là văn bản từ 1 đến 400 ký tự.")
    return requested.strip()


def negative_description_for(requested=None):
    if requested is None or requested == "":
        return ""
    if not isinstance(requested, str) or not requested.strip() or len(requested) > 400:
        raise ValueError("Mô tả loại trừ trang phục phải là văn bản từ 1 đến 400 ký tự.")
    return requested.strip()


def limit_denoising_residency(pipe):
    """Offload the previous denoising UNet before the next garment pass.

    Diffusers' linear offload chain handles encoder -> UNet, but a denoising
    loop also returns from UNet -> encoder. Without this edge both networks
    remain resident during the next encoder pass and can exhaust laptop VRAM.
    Keep the existing Accelerate hook so its image-encoder cleanup still runs.
    """
    if getattr(pipe, '_atelier_encoder_offload_handle', None) is not None:
        return True
    hook = next((h for h in getattr(pipe, '_all_hooks', ()) if getattr(h, 'model', None) is pipe.unet), None)
    if hook is None:
        return False
    def offload_previous_unet(module, inputs):
        parameter = next(pipe.unet.parameters(), None) if hasattr(pipe.unet, 'parameters') else None
        was_cuda = parameter is not None and parameter.device.type == 'cuda'
        hook.offload()
        if was_cuda:
            import torch
            torch.cuda.empty_cache()
    pipe._atelier_encoder_offload_handle = pipe.unet_encoder.register_forward_pre_hook(offload_previous_unet)
    return True


def load_pipeline(model_path, vendor_path, device, unet_model_path=None):
    import torch
    from transformers import CLIPVisionModelWithProjection, CLIPImageProcessor
    sys.path.insert(0, str(vendor_path)) if str(vendor_path) not in sys.path else None
    from src.tryon_pipeline import StableDiffusionXLInpaintPipeline
    from src.unet_hacked_tryon import UNet2DConditionModel
    from src.unet_hacked_garmnet import UNet2DConditionModel as GarmentEncoder
    dtype = torch.float16 if device == "cuda" else torch.float32
    options = dict(torch_dtype=dtype, local_files_only=True)
    unet_source = unet_model_path or model_path
    unet = UNet2DConditionModel.from_pretrained(str(unet_source), subfolder="unet", **options)
    encoder = GarmentEncoder.from_pretrained(str(model_path), subfolder="unet_encoder", **options)
    image_encoder = CLIPVisionModelWithProjection.from_pretrained(str(model_path), subfolder="image_encoder", **options)
    pipe = StableDiffusionXLInpaintPipeline.from_pretrained(
        str(model_path), unet=unet, unet_encoder=encoder, image_encoder=image_encoder,
        feature_extractor=CLIPImageProcessor(), **options,
    )
    pipe.unet_encoder = encoder.eval().requires_grad_(False)
    pipe.unet.requires_grad_(False)
    pipe.enable_vae_slicing()
    pipe.enable_vae_tiling()
    if device == "cuda":
        # The garment encoder is an extra component not registered by the
        # upstream pipeline, so include it in the offload chain explicitly.
        pipe.register_modules(unet_encoder=encoder)
        pipe.model_cpu_offload_seq = "text_encoder->text_encoder_2->image_encoder->unet_encoder->unet->vae"
        pipe.enable_model_cpu_offload()
        limit_denoising_residency(pipe)
    else:
        pipe.to(device)
    return pipe


def densepose_image(image, checkpoint):
    import cv2
    import numpy as np
    import torch
    import torchvision  # Registers torchvision::nms for the scripted model.
    from torch.nn import functional as F
    from PIL import Image
    # Match the demo's 384x512 DensePose input and fine-part colormap.
    rgb = np.asarray(image.convert("RGB").resize((384, 512)))
    # Detectron2's serialized model stores BGR pixel means
    # [103.53, 116.28, 123.675], matching IDM-VTON's demo input.
    tensor = torch.from_numpy(rgb[:, :, ::-1].copy()).permute(2, 0, 1)
    model = torch.jit.load(str(checkpoint), map_location="cpu").eval()
    with torch.inference_mode():
        boxes, coarse, fine, _, _ = model(tensor)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    canvas = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    if len(boxes) == 0:
        raise ValueError("DensePose không tìm thấy người trong ảnh IDM-VTON.")
    for index, box in enumerate(boxes):
        x0, y0, x1, y1 = box.tolist()
        x, y, w, h = int(x0), int(y0), max(int(x1-x0), 1), max(int(y1-y0), 1)
        coarse_labels = F.interpolate(coarse[index:index+1], (h, w), mode="bilinear", align_corners=False).argmax(1)
        labels = F.interpolate(fine[index:index+1], (h, w), mode="bilinear", align_corners=False).argmax(1)
        labels = (labels * (coarse_labels > 0)).squeeze(0).numpy().astype(np.uint8)
        # IDM-VTON's dp_segm visualizer uses PARULA at full opacity with
        # label values scaled over the 24 DensePose body parts.
        color = cv2.applyColorMap((labels * (255.0/24)).astype(np.uint8), cv2.COLORMAP_PARULA)
        left, top, right, bottom = max(x, 0), max(y, 0), min(x+w, 384), min(y+h, 512)
        if left >= right or top >= bottom:
            continue
        region = canvas[top:bottom, left:right]
        parts = labels[top-y:bottom-y, left-x:right-x] > 0
        colored = color[top-y:bottom-y, left-x:right-x]
        region[parts] = colored[parts]
    return Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))


def generate(pipe, source, garment, mask, pose, category, call, garment_description=None,
             garment_negative_description=None, **options):
    import torch
    import numpy as np
    from PIL import Image
    from tryon_geometry import fit_geometry, fit_image, restore_image
    width, height = options["width"], options["height"]
    geometry = fit_geometry(source.size, (width, height))
    model_source = fit_image(source, geometry)
    model_mask = fit_image(mask, geometry, mask=True)
    model_garment = fit_image(garment, fit_geometry(garment.size, (width, height)))
    dtype = pipe.unet.dtype
    device = pipe._execution_device
    def normalized(image):
        array = np.asarray(image.convert("RGB").resize((width, height))).copy()
        return (torch.from_numpy(array).permute(2, 0, 1).float()/127.5-1).unsqueeze(0).to(device=device, dtype=dtype)
    description = description_for(category, garment_description)
    negative = prompt_text('idm.negative')
    requested_negative = negative_description_for(garment_negative_description)
    if requested_negative:
        negative += ", " + requested_negative
    with torch.inference_mode():
        embeds, neg, pooled, neg_pooled = pipe.encode_prompt(
            prompt_template('idm.person', description=description), negative_prompt=negative,
            do_classifier_free_guidance=True, device=device,
        )
        cloth_embeds, _, _, _ = pipe.encode_prompt(
            prompt_template('idm.garment', description=description), do_classifier_free_guidance=False, device=device,
        )
        # Upstream calls this projection before unet.forward, outside the
        # Accelerate hook that normally moves UNet weights onto the GPU.
        pipe.unet.encoder_hid_proj.to(device)
        result = call(pipe, prompt_embeds=embeds, negative_prompt_embeds=neg,
                      pooled_prompt_embeds=pooled, negative_pooled_prompt_embeds=neg_pooled,
                      text_embeds_cloth=cloth_embeds, cloth=normalized(model_garment), pose_img=normalized(pose),
                      image=model_source, mask_image=model_mask,
                      ip_adapter_image=model_garment, strength=1.0, **options)
    images = result.images if hasattr(result, "images") else result[0]
    return restore_image(images[0], geometry)
