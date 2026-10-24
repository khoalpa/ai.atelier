const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../app/public/manual-core');
const source={url:'/manual-assets/'+'a'.repeat(64)+'.png',width:640,height:480,name:'source'};
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('crop, rotate, resize and inverse map editing back to the correct source pixels',()=>{
  const doc=C.create(source);C.transform(doc,'crop',{x:40,y:20,width:400,height:300});C.transform(doc,'rotate',90);C.transform(doc,'resize',{width:150,height:200});
  assert.equal(doc.geometry.width,150);assert.equal(doc.geometry.height,200);
  const p={x:240,y:170},output=C.point(doc.geometry.matrix,p);near(output.x,75);near(output.y,100);const restored=C.point(C.inverse(doc.geometry.matrix),output);near(restored.x,p.x);near(restored.y,p.y);
  assert.equal(doc.source.width,640);assert.equal(doc.source.height,480);
});
test('four quarter rotations and two flips preserve geometry',()=>{const doc=C.create(source);for(let i=0;i<4;i++)C.transform(doc,'rotate',90);C.transform(doc,'flipX');C.transform(doc,'flipX');doc.geometry.matrix.forEach((v,i)=>near(v,[1,0,0,1,0,0][i]));assert.equal(doc.geometry.width,640);});
test('size and invalid transforms are rejected before allocation',()=>{for(const [w,h]of [[0,40],[8193,10],[8192,8192],[NaN,2],[1.5,20]])assert.throws(()=>C.dimensions(w,h));assert.throws(()=>C.inverse([0,0,0,0,0,0]));assert.throws(()=>C.transform(C.create(source),'resize',{width:9000,height:10}));});
test('neutral colour leaves every pixel intact and all adjustments preserve alpha',()=>{const input=new Uint8ClampedArray([20,100,210,255,255,128,0,100,0,0,0,0]);assert.deepEqual(C.adjustPixels(input.slice(),C.defaults()),input);const result=C.adjustPixels(input.slice(),{brightness:20,contrast:30,highlights:-10,shadows:15,saturation:-40,temperature:20});assert.notDeepEqual(result,input);[3,7,11].forEach(i=>assert.equal(result[i],input[i]));});
test('undo/redo retains editable layers, branches correctly, and bounds history memory',()=>{const h=new C.History(2),a=C.create(source);h.push(a,'colour');a.adjustments.brightness=20;h.push(a,'layer');a.layers.push({id:'text',text:'One'});let undo=h.back(a);assert.equal(undo.layers.length,0);assert.equal(undo.adjustments.brightness,20);let redo=h.forward(undo);assert.equal(redo.layers[0].text,'One');h.back(redo);h.push(undo,'branch');assert.equal(h.redo.length,0);for(let i=0;i<5;i++)h.push(a,'x');assert.equal(h.undo.length,2);});
test('brush work stays within image bounds including edge strokes',()=>{assert.deepEqual(C.strokeBounds({size:10,points:[{x:0,y:0},{x:10,y:10}]},20,20),{x:0,y:0,width:18,height:18});assert.equal(C.strokeBounds({size:10,points:[{x:-100,y:-100}]},20,20).width,0);});
