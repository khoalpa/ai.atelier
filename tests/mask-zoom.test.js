const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/public/app.js','utf8');
const controls={},handlers={};
const canvas={style:{},addEventListener:(name,fn)=>handlers[name]=fn,
  getBoundingClientRect:()=>({left:100,top:50,width:800,height:1200})};
const context={canvas,sourceImage:{naturalWidth:1000,naturalHeight:1500},drawing:false,
  maskCanvas:{width:1000,height:1500},render:()=>{},
  $:id=>controls[id]??(controls[id]={textContent:'',addEventListener(name,fn){this[name]=fn},
    setAttribute(name,value){this[name]=value},getBoundingClientRect:()=>({width:436,height:636})})};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('let editorZoom='),source.indexOf('function render()')),context);
context.fitCanvas();assert.equal(canvas.width,400);assert.equal(canvas.height,600);
context.setEditorZoom(2);assert.equal(canvas.width,800);assert.equal(canvas.style.width,'800px');
assert.equal(controls.editorZoomValue.textContent,'200%');
vm.runInContext(source.slice(source.indexOf('function canvasPoint('),source.indexOf('function paint(')),context);
assert.equal(context.canvasPoint({clientX:500,clientY:650}).x,500);
assert.equal(context.canvasPoint({clientX:500,clientY:650}).y,750);
context.setEditorZoom(99);assert.equal(controls.editorZoomValue.textContent,'800%');
assert.equal(canvas.width,1000); // Backing pixels stay bounded to original resolution.
vm.runInContext('editorPan={x:99999,y:-99999};updateEditorTransform()',context);
assert(!canvas.style.transform.includes('99999'));
controls.editorZoomFit.click();assert.equal(canvas.style.transform,'translate(0px, 0px)');
context.drawing=true;context.setEditorZoom(4);assert.equal(controls.editorZoomValue.textContent,'100%');
context.drawing=false;controls.editorPanToggle.click();assert.equal(canvas.style.cursor,'grab');
let prevented=false;handlers.wheel({deltaY:-10,preventDefault:()=>prevented=true});assert(prevented);
assert.equal(controls.editorZoomValue.textContent,'115%');
console.log('OK: zoom limits, source coordinates, pan bounds, fit reset and stroke zoom lock.');
