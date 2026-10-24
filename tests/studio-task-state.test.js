const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=require('./helpers/source').read(require('path').join(__dirname,'../app/public/app.js'),'utf8');
const fn=source.slice(source.indexOf('function switchTaskMask('),source.indexOf('async function loadTryonModelOptions('));
const context={};vm.createContext(context);
vm.runInContext(`
let studioMode='inpaint',studioTaskMasks={},current={id:'image-a'},sourceImage={},drawing=false,lastPoint=null;
let aiPoints=[{x:3,y:4}],history=['undo-a'];
const maskCanvas={width:20,height:30},protectCanvas={width:20,height:30};
function layer(value){return {value,getImageData(){return this.value},putImageData(data){this.value=data},clearRect(){this.value=null}}}
const maskCtx=layer('mask-a'),protectCtx=layer('protect-a');
const manualProtectCanvas={width:20,height:30},manualProtectCtx=layer('manual-a');
const controls={notes:{value:'note-a'},labelSelect:{value:'shirt'}};
const $=id=>controls[id];function render(){}
${fn}
switchTaskMask('tryon');
if(maskCtx.value!==null||protectCtx.value!==null||history.length||aiPoints.length)throw Error('New task inherited a mask');
studioMode='tryon';maskCtx.value='mask-b';history=['undo-b'];
switchTaskMask('inpaint');
if(maskCtx.value!=='mask-a'||protectCtx.value!=='protect-a'||history[0]!=='undo-a'||aiPoints[0].x!==3)throw Error('Original task not restored');
studioMode='inpaint';current={id:'image-b'};switchTaskMask('tryon');
if(maskCtx.value!==null)throw Error('Mask leaked between images');
`,context);
const html=require('./helpers/source').read(require('path').join(__dirname,'../app/public/index.html'),'utf8');
for(const id of ['inpaintModelSelect','tryonModelSelect'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
console.log('OK: task masks, protection, undo and AI points isolated; model selectors unique.');
