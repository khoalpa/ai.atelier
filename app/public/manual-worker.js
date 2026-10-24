'use strict';
importScripts('/manual-core.js');
importScripts('/export-core.js');
const C=ManualCore,cache=new Map();let base=null,baseUrl='',baseKeys=[];
const canvas=(w,h)=>new OffscreenCanvas(w,h);
const context=c=>c.getContext('2d',{willReadFrequently:true});
async function bitmap(url){
  if(!/^\/manual-assets\/[a-f0-9]{64}\.png$/.test(url))throw Error('Ảnh không thuộc phiên chỉnh sửa.');
  if(cache.has(url)){const item=cache.get(url);cache.delete(url);cache.set(url,item);return item;}
  const response=await fetch(url);if(!response.ok)throw Error('Không đọc được ảnh đã lưu.');const item=await createImageBitmap(await response.blob());C.dimensions(item.width,item.height);cache.set(url,item);
  while(cache.size>4){const key=cache.keys().next().value;cache.get(key).close();cache.delete(key);}return item;
}
function shapePath(ctx,s){
  const p=s.points;ctx.beginPath();
  if(s.type==='rect')ctx.rect(Math.min(p[0].x,p[1].x),Math.min(p[0].y,p[1].y),Math.abs(p[1].x-p[0].x),Math.abs(p[1].y-p[0].y));
  else if(s.type==='ellipse')ctx.ellipse((p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2,Math.abs(p[1].x-p[0].x)/2,Math.abs(p[1].y-p[0].y)/2,0,0,Math.PI*2);
  else {ctx.moveTo(p[0].x,p[0].y);p.slice(1).forEach(q=>ctx.lineTo(q.x,q.y));ctx.closePath();}
}
function selectionPixels(selection,bounds){
  if(!selection?.shapes.length&&!selection?.maskUrl)return null;const pad=Math.ceil(selection.feather*3),w=bounds.width,h=bounds.height,c=canvas(w+pad*2,h+pad*2),ctx=context(c);ctx.translate(pad-bounds.x,pad-bounds.y);
  if(selection.maskUrl){const mask=cache.get(selection.maskUrl);if(!mask)throw Error('Không đọc được vùng chọn.');ctx.drawImage(mask,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<pixels.data.length;i+=4){pixels.data[i+3]*=pixels.data[i]/255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;}ctx.putImageData(pixels,0,0);}
  for(const s of selection.shapes){if(s.mode==='replace')ctx.clearRect(bounds.x-pad,bounds.y-pad,w+pad*2,h+pad*2);ctx.globalCompositeOperation=s.mode==='subtract'?'destination-out':'source-over';shapePath(ctx,s);ctx.fillStyle='#fff';ctx.fill();}
  const clipped=canvas(w,h),out=context(clipped);if(selection.feather)out.filter=`blur(${selection.feather}px)`;out.drawImage(c,-pad,-pad);return out.getImageData(0,0,w,h).data;
}
function coverage(stroke,bounds){
  const {x,y,width:w,height:h}=bounds,r=stroke.size/2,soft=stroke.softness,result=new Float32Array(w*h);
  function stamp(p){const minX=Math.max(0,Math.floor(p.x-r-x)),maxX=Math.min(w-1,Math.ceil(p.x+r-x)),minY=Math.max(0,Math.floor(p.y-r-y)),maxY=Math.min(h-1,Math.ceil(p.y+r-y));
    for(let yy=minY;yy<=maxY;yy++)for(let xx=minX;xx<=maxX;xx++){const distance=Math.hypot(xx+x+.5-p.x,yy+y+.5-p.y)/r;if(distance>1)continue;const alpha=distance<=1-soft?1:(1-distance)/Math.max(soft,.001),i=yy*w+xx;result[i]=Math.max(result[i],alpha*stroke.opacity);}}
  stamp(stroke.points[0]);const spacing=Math.max(1,r*.3);let remaining=spacing;
  for(let i=1;i<stroke.points.length;i++){let a=stroke.points[i-1];const b=stroke.points[i];let distance=Math.hypot(b.x-a.x,b.y-a.y);while(distance>=remaining){const next={x:a.x+(b.x-a.x)*remaining/distance,y:a.y+(b.y-a.y)*remaining/distance};stamp(next);a=next;distance-=remaining;remaining=spacing;}remaining-=distance;}
  if(stroke.points.length>1)stamp(stroke.points.at(-1));
  return result;
}
function sampleRegion(ctx,x,y,w,h){const c=canvas(w,h),out=context(c);out.drawImage(ctx.canvas,-x,-y);return out.getImageData(0,0,w,h).data;}
function localBlur(ctx,bounds,radius){
  const pad=Math.ceil(radius*3),c=canvas(bounds.width+pad*2,bounds.height+pad*2),cx=context(c);cx.drawImage(ctx.canvas,pad-bounds.x,pad-bounds.y);
  const out=canvas(bounds.width,bounds.height),ox=context(out);ox.filter=`blur(${radius}px)`;ox.drawImage(c,-pad,-pad);return ox.getImageData(0,0,bounds.width,bounds.height).data;
}
function applyStroke(target,original,stroke){
  const ctx=context(target),bounds=C.strokeBounds(stroke,target.width,target.height);if(!bounds.width||!bounds.height)return;
  const {x,y,width:w,height:h}=bounds,pixels=ctx.getImageData(x,y,w,h),data=pixels.data,cover=coverage(stroke,bounds),selected=selectionPixels(stroke.selection,bounds);
  let sample,mean=[0,0,0],count=0;
  if(stroke.tool==='restore')sample=sampleRegion(context(original),x,y,w,h);
  if(['clone','heal'].includes(stroke.tool)){
    const first=stroke.points[0],dx=stroke.anchor.x-first.x,dy=stroke.anchor.y-first.y;
    sample=sampleRegion(ctx,Math.round(x+dx),Math.round(y+dy),w,h);
    if(stroke.tool==='heal'){for(let i=0;i<cover.length;i++)if(cover[i]&&sample[i*4+3]&&data[i*4+3]){for(let k=0;k<3;k++)mean[k]+=data[i*4+k]-sample[i*4+k];count++;}if(count)mean=mean.map(v=>v/count);}
  }
  if(['blur','sharpen'].includes(stroke.tool))sample=localBlur(ctx,bounds,stroke.tool==='sharpen'?1.5:Math.max(1,stroke.size/12));
  const paint=stroke.color.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16));
  for(let n=0;n<cover.length;n++){
    const i=n*4,a=cover[n]*(selected?selected[i+3]/255:1);if(!a)continue;
    if(stroke.tool==='erase'){data[i+3]*=1-a;continue;}
    let rgb,alpha=data[i+3];
    if(stroke.tool==='paint'){
      const originalAlpha=alpha/255,next=a+originalAlpha*(1-a);for(let k=0;k<3;k++)data[i+k]=next?(paint[k]*a+data[i+k]*originalAlpha*(1-a))/next:0;data[i+3]=next*255;continue;
    }
    if(['clone','heal'].includes(stroke.tool)&&!sample[i+3])continue;
    if(['restore','clone'].includes(stroke.tool)){rgb=[sample[i],sample[i+1],sample[i+2]];alpha=sample[i+3];}
    else if(stroke.tool==='heal')rgb=[0,1,2].map(k=>C.clamp(sample[i+k]+mean[k],0,255));
    else if(stroke.tool==='blur')rgb=[sample[i],sample[i+1],sample[i+2]];
    else if(stroke.tool==='sharpen')rgb=[0,1,2].map(k=>C.clamp(data[i+k]+(data[i+k]-sample[i+k])*1.5,0,255));
    else if(stroke.tool==='dodge')rgb=[0,1,2].map(k=>data[i+k]+(255-data[i+k])*.2);
    else if(stroke.tool==='burn')rgb=[0,1,2].map(k=>data[i+k]*.8);
    for(let k=0;k<3;k++)data[i+k]=data[i+k]*(1-a)+rgb[k]*a;data[i+3]=data[i+3]*(1-a)+alpha*a;
  }
  ctx.putImageData(pixels,x,y);
}
async function compose(doc,before=false){
  C.dimensions(doc.source.width,doc.source.height);C.dimensions(doc.geometry.width,doc.geometry.height);
  const original=await bitmap(doc.source.url),source=canvas(doc.source.width,doc.source.height);context(source).drawImage(original,0,0);
  const keys=doc.strokes.map(s=>JSON.stringify(s));
  if(!base||baseUrl!==doc.source.url||baseKeys.length>keys.length||baseKeys.some((k,i)=>keys[i]!==k)){base=canvas(doc.source.width,doc.source.height);context(base).drawImage(original,0,0);baseUrl=doc.source.url;baseKeys=[];}
  if(!before){for(let i=baseKeys.length;i<doc.strokes.length;i++){if(doc.strokes[i].selection?.maskUrl)await bitmap(doc.strokes[i].selection.maskUrl);applyStroke(base,source,doc.strokes[i]);}baseKeys=keys;}
  const scene=canvas(doc.source.width,doc.source.height),ctx=context(scene);ctx.drawImage(before?source:base,0,0);
  if(!before&&doc.background)await replaceBackground(scene,doc.background);
  if(!before)for(const layer of doc.layers){
    if(!layer.visible)continue;
    if(layer.type==='adjustment'){if(layer.selection?.maskUrl)await bitmap(layer.selection.maskUrl);const pixels=ctx.getImageData(0,0,scene.width,scene.height),original=pixels.data.slice(),selected=selectionPixels(layer.selection,{x:0,y:0,width:scene.width,height:scene.height});C.adjustPixels(pixels.data,layer.adjustments);for(let i=0;i<pixels.data.length;i+=4){const amount=layer.opacity*(selected?selected[i+3]/255:1);for(let k=0;k<3;k++)pixels.data[i+k]=original[i+k]+(pixels.data[i+k]-original[i+k])*amount;}ctx.putImageData(pixels,0,0);continue;}
    const image=layer.type==='image'?await bitmap(layer.url):null;
    const w=Math.max(1,Math.round(layer.width)),h=Math.max(1,Math.round(layer.height));C.dimensions(w,h);const content=canvas(w,h),lc=context(content);
    if(image)lc.drawImage(image,0,0,w,h);else{lc.fillStyle=layer.color;lc.font=`${layer.bold?'bold ':''}${layer.fontSize}px Arial`;lc.textBaseline='top';layer.text.split('\n').forEach((line,i)=>lc.fillText(line,0,i*layer.fontSize*1.2,w));}
    for(const mask of layer.mask)applyStroke(content,content,mask);
    ctx.save();ctx.globalAlpha=layer.opacity;ctx.translate(layer.x+w/2,layer.y+h/2);ctx.rotate(layer.rotation*Math.PI/180);ctx.drawImage(content,-w/2,-h/2);ctx.restore();
  }
  if(!before&&Object.values(doc.adjustments).some(Boolean)){const pixels=ctx.getImageData(0,0,scene.width,scene.height);C.adjustPixels(pixels.data,doc.adjustments);ctx.putImageData(pixels,0,0);}
  const result=canvas(doc.geometry.width,doc.geometry.height),out=context(result);out.setTransform(...doc.geometry.matrix);for(const clip of doc.geometry.clips||[]){shapePath(out,{type:'polygon',points:clip});out.clip();}out.drawImage(scene,0,0);return result;
}
async function replaceBackground(scene,b){
  const w=scene.width,h=scene.height,mask=canvas(w,h),mc=context(mask);mc.drawImage(await bitmap(b.maskUrl),0,0,w,h);const pixels=mc.getImageData(0,0,w,h);
  for(let i=0;i<pixels.data.length;i+=4){const a=pixels.data[i]*pixels.data[i+3]/255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;pixels.data[i+3]=a===0||a===255?a:C.clamp(a+b.threshold*1.8,0,255);}mc.putImageData(pixels,0,0);
  for(const s of b.strokes||[])applyStroke(mask,mask,{...s,color:'#ffffff',selection:null});
  const finalMask=canvas(w,h),fc=context(finalMask);fc.filter=b.feather?`blur(${b.feather}px)`:'none';fc.drawImage(mask,0,0);
  const subject=canvas(w,h),sc=context(subject);sc.drawImage(scene,0,0);
  if(b.decontaminate){const rgb=sc.getImageData(0,0,w,h);C.cleanEdgeColors(rgb.data,fc.getImageData(0,0,w,h).data,w,h,b.decontaminate);sc.putImageData(rgb,0,0);}
  sc.globalCompositeOperation='destination-in';sc.drawImage(finalMask,0,0);sc.globalCompositeOperation='source-over';
  const ctx=context(scene);ctx.clearRect(0,0,w,h);if(b.mode==='color'){ctx.fillStyle=b.color;ctx.fillRect(0,0,w,h);}else if(b.mode==='image'){const image=await bitmap(b.url),scale=Math.max(w/image.width,h/image.height);ctx.drawImage(image,(w-image.width*scale)/2,(h-image.height*scale)/2,image.width*scale,image.height*scale);}
  ctx.save();if(b.shadow?.opacity){ctx.shadowColor=`rgba(0,0,0,${b.shadow.opacity})`;ctx.shadowBlur=b.shadow.blur;ctx.shadowOffsetX=b.shadow.x;ctx.shadowOffsetY=b.shadow.y;}ctx.drawImage(subject,0,0);ctx.restore();
}
let work=Promise.resolve();
self.onmessage=event=>{const message=event.data;work=work.then(async()=>{
  try{
    if(message.action==='mask'){
      const d=message.document,s=message.selection||d.selection;if(s?.maskUrl)await bitmap(s.maskUrl);const pixels=selectionPixels(s,{x:0,y:0,width:d.source.width,height:d.source.height});if(!pixels)throw Error('Chọn vùng trước.');let result=canvas(d.source.width,d.source.height);context(result).putImageData(new ImageData(pixels,d.source.width,d.source.height),0,0);
      if(message.outputSpace){const out=canvas(d.geometry.width,d.geometry.height),ctx=context(out);ctx.setTransform(...d.geometry.matrix);for(const clip of d.geometry.clips||[]){shapePath(ctx,{type:'polygon',points:clip});ctx.clip();}ctx.drawImage(result,0,0);result=out;}
      self.postMessage({id:message.id,blob:await result.convertToBlob({type:'image/png'})});return;
    }
    const result=await compose(message.document,message.before);
    if(message.action==='export'){
      let output=result;
      if(message.spec){const spec=ExportCore.validate(message.spec),size=ExportCore.dimensions(result.width,result.height,spec);output=canvas(size.width,size.height);const ctx=context(output),ratio=(spec.fit==='cover'?Math.max:Math.min)(size.width/result.width,size.height/result.height);ctx.imageSmoothingQuality='high';ctx.drawImage(result,(size.width-result.width*ratio)/2,(size.height-result.height*ratio)/2,result.width*ratio,result.height*ratio);
        if(spec.logoUrl){const logo=await bitmap(spec.logoUrl),w=Math.min(size.width*spec.logoScale/100,size.width),h=w*logo.height/logo.width,scale=Math.min(1,size.height/h),lw=w*scale,lh=h*scale,m=Math.min(spec.margin,size.width/2,size.height/2);let x=spec.logoPosition.includes('left')?m:size.width-lw-m,y=spec.logoPosition.includes('top')?m:size.height-lh-m;if(spec.logoPosition==='center'){x=(size.width-lw)/2;y=(size.height-lh)/2;}x=C.clamp(x,0,size.width-lw);y=C.clamp(y,0,size.height-lh);ctx.globalAlpha=spec.logoOpacity;ctx.drawImage(logo,x,y,lw,lh);ctx.globalAlpha=1;}
        message.format=spec.format;message.quality=spec.quality;
      }
      if(message.format==='image/jpeg'){const flat=canvas(output.width,output.height),ctx=context(flat);ctx.fillStyle='#fff';ctx.fillRect(0,0,flat.width,flat.height);ctx.drawImage(output,0,0);output=flat;}
      const blob=await output.convertToBlob({type:message.format||'image/png',quality:message.quality??.92});if(blob.type!==(message.format||'image/png'))throw Error('Trình duyệt chưa hỗ trợ định dạng xuất này.');self.postMessage({id:message.id,blob});
    }else{const image=result.transferToImageBitmap();self.postMessage({id:message.id,bitmap:image},[image]);}
  }catch(error){self.postMessage({id:message.id,error:error.message});}
}).catch(()=>{});};
