const assert=require('assert'),fs=require('fs'),vm=require('vm');
class Element{
 constructor(text='',value=''){this.textContent=text;this.value=value;this.children=[];this.dataset={};this.attributes={};this.disabled=false;}
 append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
 setAttribute(name,value){this.attributes[name]=value;}removeAttribute(name){delete this.attributes[name];}
 querySelectorAll(){return this.children.filter(c=>c instanceof Element);}querySelector(){return this.querySelectorAll()[0];}
}
const fields={},ids=['makeupReferenceStatus','makeupReferenceSelect','makeupReferenceUpload','makeupReferenceRefresh','makeupReferenceDetect','makeupReferenceApply','makeupReferenceFaces','makeupReferenceImage','makeupReferenceFile','makeupSavedStyle','makeupLoadStyle','makeupStyleName','makeupSaveStyle','makeupUpdateStyle','makeupLibraryStatus'];
for(const id of ids)fields[id]=new Element();
let initialize,locked=false,ready=true,loaded,fail=false,calls=[];
const plan={style:'natural',lip:'#b23b42',parts:['lips']};
const context={window:{Makeup:{isLocked:()=>locked,referenceReady:()=>ready,descriptionReady:()=>true,setExtensionBusy:v=>locked=v,loadStyle:v=>loaded=v,settings:()=>plan}},
 document:{getElementById:id=>fields[id],createElement:()=>new Element(),addEventListener:(_,fn)=>initialize=fn},Image:Element,Option:Element,setMessage(){},
 fetch:async(url,options)=>{const body=options?.body?JSON.parse(options.body):undefined;calls.push({url,body});
  let data=url==='/api/images'?{images:[{id:'reference',url:'/samples/reference.png',group:'Ảnh mẫu',name:'ref.png'}]}:
   url==='/api/makeup-library'?{ok:true,styles:[{id:'saved',name:'Đã lưu',settings:plan}]}:
   fail?{ok:false,error:'Chưa nhận diện được khuôn mặt'}:
   body.faceIndex===undefined?{ok:true,sourceSha256:'sha',faces:[{index:0,thumbnail:'face0'},{index:1,thumbnail:'face1'}]}:
   {ok:true,plan,warnings:['Màu là gợi ý']};
  return {ok:!fail||url!='/api/makeup-reference',json:async()=>data};
 }};
vm.createContext(context);vm.runInContext(fs.readFileSync('app/public/makeup-library.js','utf8'),context);
(async()=>{
 initialize();await new Promise(setImmediate);
 assert.equal(fields.makeupReferenceSelect.children.length,2,'Legacy image API has no ok field');
 fields.makeupReferenceSelect.value='reference';fields.makeupReferenceSelect.onchange();assert(!fields.makeupReferenceDetect.disabled);
 await fields.makeupReferenceDetect.onclick();assert.equal(fields.makeupReferenceFaces.children.length,2);assert(fields.makeupReferenceApply.disabled,'Two faces require an explicit choice');
 fields.makeupReferenceFaces.children[1].onclick();assert(!fields.makeupReferenceApply.disabled);
 await fields.makeupReferenceApply.onclick();assert.equal(loaded.lip,plan.lip);assert.equal(calls.at(-1).body.faceIndex,1);assert.equal(calls.at(-1).body.sourceSha256,'sha');
 assert(!Object.hasOwn(loaded,'faceIndex'));assert.equal(fields.makeupReferenceStatus.textContent,'Màu là gợi ý');
 locked=true;context.window.MakeupLibrary.sync();const count=calls.length;await fields.makeupReferenceApply.onclick();assert.equal(calls.length,count);assert(fields.makeupReferenceSelect.disabled);locked=false;
 fail=true;await fields.makeupReferenceDetect.onclick();assert.equal(fields.makeupReferenceFaces.children.length,0);assert(fields.makeupReferenceApply.disabled);assert(fields.makeupReferenceStatus.textContent.includes('khuôn mặt'));
 fields.makeupSavedStyle.value='saved';fields.makeupSavedStyle.onchange();fields.makeupLoadStyle.onclick();assert.equal(loaded.lip,plan.lip);assert.equal(fields.makeupStyleName.value,'Đã lưu');
 console.log('PASS: reference library compatibility, explicit multiple-face choice, selected-face request, busy guards, failed detection reset and saved-style loading.');
})().catch(error=>{console.error(error);process.exitCode=1;});
