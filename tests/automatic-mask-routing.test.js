const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../app/public/app.js'),'utf8');
const fn=source.slice(source.indexOf('async function segmentWithAi('),source.indexOf('function displayMask('));
const points=[{x:300,y:400,label:1},{x:320,y:600,label:0}];
let calls=[];
const context={current:{id:'characters/c001.png'},studioMode:'tryon',aiPoints:points,$:id=>({value:id==='garmentCategory'?'upper_body':'shirt'}),createAutomaticMask:async(category,hints)=>{calls.push(category);assert.strictEqual(hints,context.aiPoints);},fetch:()=>{throw Error('Clothing mask must not call generic object segmentation');}};
context.window={ATELIER_PROMPTS:require('../app/prompt-store').readCatalog()};
vm.createContext(context);vm.runInContext(fs.readFileSync('app/public/outfit-workflow.js','utf8'),context);vm.runInContext(fn,context);
(async()=>{await context.segmentWithAi();context.aiPoints=[];await context.segmentWithAi();context.studioMode='inpaint';await context.segmentWithAi();assert.deepEqual(calls,['','','upper_body']);console.log('OK: try-on and clothing removal share category/protection routing, with or without point hints.');})().catch(error=>{console.error(error);process.exitCode=1;});
