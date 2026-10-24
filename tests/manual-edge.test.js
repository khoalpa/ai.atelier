const test=require('node:test'),assert=require('node:assert/strict'),C=require('../app/public/manual-core');
test('edge cleanup reduces a coloured fringe, preserves alpha and interior, and is reversible',()=>{
 const w=32,h=20,data=new Uint8ClampedArray(w*h*4),mask=new Uint8ClampedArray(data.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;data.set(x<10?[210,170,60,255]:[30,40,50,255],i);mask[i+3]=x<8?0:x<10?128:255;}
 const original=data.slice();assert.deepEqual(C.cleanEdgeColors(data.slice(),mask,w,h,0),original);
 C.cleanEdgeColors(data,mask,w,h,100);const edge=(10*w+9)*4;assert(data[edge]<original[edge]-80);assert(data[edge+1]<original[edge+1]-50);
 for(let i=3;i<data.length;i+=4)assert.equal(data[i],original[i]);
 assert.deepEqual(data.slice((10*w+16)*4,(10*w+17)*4),original.slice((10*w+16)*4,(10*w+17)*4));
 assert.deepEqual(data.slice(0,4),original.slice(0,4));
 const empty=new Uint8ClampedArray(mask.length);assert.deepEqual(C.cleanEdgeColors(original.slice(),empty,w,h,100),original);
 const soft=new Uint8ClampedArray(mask.length).fill(128);assert.deepEqual(C.cleanEdgeColors(original.slice(),soft,w,h,100),original);
 assert.throws(()=>C.cleanEdgeColors(data,mask,1,1,80),/khớp/);
});
