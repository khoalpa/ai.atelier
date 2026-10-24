/* Pure document geometry and colour operations, shared by the editor, worker and tests. */
(function(root){
  'use strict';
  const MAX_PIXELS=16777216,MAX_SIDE=8192;
  const defaults=()=>({brightness:0,contrast:0,highlights:0,shadows:0,saturation:0,temperature:0});
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function dimensions(w,h){if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>MAX_SIDE||h>MAX_SIDE||w*h>MAX_PIXELS)throw Error('Ảnh tối đa 16 triệu pixel và 8192 px mỗi chiều.');}
  function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
  function point(m,p){return {x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]};}
  function inverse(m){const d=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(d)||Math.abs(d)<1e-10)throw Error('Phép biến đổi không hợp lệ.');return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
  function create(source){dimensions(source.width,source.height);return {version:1,source,geometry:{width:source.width,height:source.height,matrix:[1,0,0,1,0,0],clips:[]},adjustments:defaults(),strokes:[],layers:[]};}
  function transform(doc,kind,arg){
    const g=doc.geometry,w=g.width,h=g.height;let m,width=w,height=h;
    if(kind==='crop'){const x=clamp(Math.round(arg.x),0,w-1),y=clamp(Math.round(arg.y),0,h-1);width=clamp(Math.round(arg.width),1,w-x);height=clamp(Math.round(arg.height),1,h-y);const map=inverse(g.matrix);(g.clips||=([])).push([{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}].map(p=>point(map,p)));m=[1,0,0,1,-x,-y];}
    else if(kind==='resize'){width=Math.round(arg.width);height=Math.round(arg.height);dimensions(width,height);m=[width/w,0,0,height/h,0,0];}
    else if(kind==='flipX')m=[-1,0,0,1,w,0];
    else if(kind==='flipY')m=[1,0,0,-1,0,h];
    else if(kind==='rotate'){
      const r=arg*Math.PI/180,c=Math.abs(Math.cos(r))<1e-10?0:Math.cos(r),s=Math.abs(Math.sin(r))<1e-10?0:Math.sin(r);
      width=Math.ceil(Math.abs(w*c)+Math.abs(h*s)-1e-8);height=Math.ceil(Math.abs(w*s)+Math.abs(h*c)-1e-8);
      m=[c,s,-s,c,width/2-c*w/2+s*h/2,height/2-s*w/2-c*h/2];
    }else throw Error('Phép biến đổi chưa được hỗ trợ.');
    dimensions(width,height);g.matrix=multiply(m,g.matrix);g.width=width;g.height=height;return doc;
  }
  function adjustPixels(data,a){
    const b=a.brightness*1.28,c=Math.pow(2,a.contrast/100),sat=1+a.saturation/100,t=a.temperature*.35;
    for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const l=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2],tone=a.shadows*.8*Math.pow(1-l/255,2)+a.highlights*.8*Math.pow(l/255,2);
      for(let k=0;k<3;k++){const color=l+(data[i+k]-l)*sat;data[i+k]=clamp((color-127.5)*c+127.5+b+tone+(k===0?t:k===2?-t:0),0,255);}
    }return data;
  }
  function strokeBounds(s,w,h){const r=s.size/2+3,x=s.points.map(p=>p.x),y=s.points.map(p=>p.y);const x0=clamp(Math.floor(Math.min(...x)-r),0,w),y0=clamp(Math.floor(Math.min(...y)-r),0,h);return {x:x0,y:y0,width:clamp(Math.ceil(Math.max(...x)+r),x0,w)-x0,height:clamp(Math.ceil(Math.max(...y)+r),y0,h)-y0};}
  function cleanEdgeColors(data,matte,w,h,amount=0){
    dimensions(w,h);if(data.length!==w*h*4||matte.length!==data.length)throw Error('Kích thước vùng mép không khớp.');
    amount=clamp(Number(amount)||0,0,100)/100;if(!amount)return data;
    // Find reliable foreground two pixels inside the matte. Colour propagation
    // is bounded to eight pixels; thin isolated strands without a donor stay as-is.
    const n=w*h,dist=new Uint8Array(n),donor=new Int32Array(n);dist.fill(9);donor.fill(-1);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x;if(matte[p*4+3]<250||data[p*4+3]<250)continue;
      let solid=true;for(let dy=-2;dy<=2&&solid;dy++)for(let dx=-2;dx<=2;dx++){
        const yy=y+dy,xx=x+dx;if(yy>=0&&yy<h&&xx>=0&&xx<w&&(matte[(yy*w+xx)*4+3]<250||data[(yy*w+xx)*4+3]<250)){solid=false;break;}
      }if(solid){dist[p]=0;donor[p]=p;}
    }
    function from(p,q){if(dist[q]+1<dist[p]){dist[p]=dist[q]+1;donor[p]=donor[q];}}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(x)from(p,p-1);if(y)from(p,p-w);}
    for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const p=y*w+x;if(x<w-1)from(p,p+1);if(y<h-1)from(p,p+w);}
    for(let p=0;p<n;p++){
      const i=p*4,a=matte[i+3]/255;if(!a||!data[i+3]||!dist[p]||donor[p]<0||dist[p]>8)continue;
      // Interior colour and alpha are immutable. Reduce opaque fringe mildly;
      // soft edge pixels receive stronger replacement from the same subject.
      const mix=amount*Math.min(1,(1-a)+.65)*Math.min(1,(9-dist[p])/3),d=donor[p]*4;
      for(let k=0;k<3;k++)data[i+k]=data[i+k]+(data[d+k]-data[i+k])*mix;
    }return data;
  }
  class History{
    constructor(limit=80,budget=12*1024*1024){this.undo=[];this.redo=[];this.limit=limit;this.budget=budget;}
    push(doc,label){this.undo.push({doc:structuredClone(doc),label});this.redo=[];while(this.undo.length>this.limit||this.undo.length>1&&JSON.stringify(this.undo).length>this.budget)this.undo.shift();}
    back(doc){const entry=this.undo.pop();if(!entry)return null;this.redo.push({doc:structuredClone(doc),label:entry.label});return entry.doc;}
    forward(doc){const entry=this.redo.pop();if(!entry)return null;this.undo.push({doc:structuredClone(doc),label:entry.label});return entry.doc;}
  }
  const api={MAX_PIXELS,MAX_SIDE,defaults,clamp,dimensions,multiply,point,inverse,create,transform,adjustPixels,strokeBounds,cleanEdgeColors,History};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ManualCore=api;
})(typeof self!=='undefined'?self:globalThis);
