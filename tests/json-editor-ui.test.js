const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('node:assert/strict');
const {createStore}=require('../app/json-config-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-json-ui-')),project=path.resolve(__dirname,'..');
for(const file of createStore().list()){const target=path.join(root,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,file.path),target);}
const store=createStore(root,path.join(root,'workspace/prompts.json'));
class Node{
  constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.disabled=false;this.files=[];this.events={};this.open=false;}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(name,value){this[name]=value;}
  get options(){return this.children;}
  querySelectorAll(){return Object.values(elements);}
  showModal(){this.open=true;}close(){this.open=false;}click(){if(this.onclick)return this.onclick();if(this.events.click)return this.events.click();}remove(){}
}
const html=require('./helpers/source').read(path.join(project,'app/public/index.html'),'utf8'),elements={};
for(const match of html.matchAll(/id="(jsonEditor[^"]+)"/g))elements[match[1]]=new Node();
const window={events:{},confirm:()=>true,addEventListener(name,fn){this.events[name]=fn;}};
const document={getElementById:id=>elements[id],createElement:tag=>new Node(tag),body:new Node(),addEventListener(){}};
const context={window,document,Option:class extends Node{constructor(text,value){super('option');this.textContent=text;this.value=value;}},fetch:async(url,options)=>{
  try{
    if(url==='/api/catalog-preview'){const body=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,...require('../app/catalog-inspector').preview(body.catalog,body.taskId,body.variables)})};}
    const id=url.split('/').at(-1);let result;
    if(url==='/api/json-config')result={files:store.list()};
    else if(!options.method)result=store.read(id);
    else{const b=JSON.parse(options.body);result=b.action==='validate'?store.preview(id,b.data,b.revision):b.action==='save'?store.save(id,b.data,b.revision):store.restore(id,b.backup,b.revision);}
    return {ok:true,json:async()=>({ok:true,...result})};
  }catch(error){return {ok:false,json:async()=>({ok:false,error:error.message})};}
},URL:{createObjectURL:()=> 'blob:download',revokeObjectURL(){}},Blob:class{},setTimeout:fn=>fn()};
vm.runInNewContext(require('./helpers/source').read(path.join(project,'app/public/json-editor.js'),'utf8'),context);window.events.DOMContentLoaded();
(async()=>{
  await window.AtelierJsonEditor.open('prompts');assert(elements.jsonEditorDialog.open);assert.equal(elements.jsonEditorFile.options.length,7);
  elements.jsonEditorTask.value='skin.retouch';elements.jsonEditorVariables.value='{}';elements.jsonEditorTokenModel.value='';await elements.jsonEditorPreview.click();assert(elements.jsonEditorPreviewOutput.textContent.includes(store.read('prompts').data.components['skin.positive']));
  elements.jsonEditorTask.value='makeup.render';await elements.jsonEditorPreview.click();assert(elements.jsonEditorPreviewOutput.textContent.includes('prompt'));
  elements.jsonEditorGroup.value=JSON.stringify(['uiPlaceholders']);elements.jsonEditorGroup.onchange();
  elements.jsonEditorMode.value='raw';elements.jsonEditorMode.onchange();
  const before=store.read('prompts'),subset=JSON.parse(elements.jsonEditorRaw.value);subset.librarySearch='Full JSON editor import';
  elements.jsonEditorRaw.value=JSON.stringify(subset);elements.jsonEditorRaw.oninput();await elements.jsonEditorValidate.click();assert.equal(store.read('prompts').revision,before.revision);assert(elements.jsonEditorStatus.textContent.includes('1 vị trí'));
  await elements.jsonEditorSave.click();assert.equal(store.read('prompts').data.uiPlaceholders.librarySearch,subset.librarySearch);assert.equal(store.read('prompts').backups.length,1);
  assert.deepEqual(store.read('prompts').data.components,before.data.components);
  const saved=store.read('prompts');elements.jsonEditorRaw.value='{broken';elements.jsonEditorRaw.oninput();await elements.jsonEditorSave.click();assert.equal(store.read('prompts').revision,saved.revision);assert(elements.jsonEditorStatus.textContent.includes('JSON chưa hợp lệ'));
  elements.jsonEditorClose.click();await window.AtelierJsonEditor.open('prompts');assert.equal(elements.jsonEditorRaw.value,'{broken');
  elements.jsonEditorReload.click();await new Promise(r=>setImmediate(r));assert(!elements.jsonEditorDirty.textContent.includes('chưa lưu'));
  elements.jsonEditorBackup.value=saved.backups[0].id;await elements.jsonEditorRestore.click();assert.deepEqual(store.read('prompts').data,before.data);
  await window.AtelierJsonEditor.open('config');elements.jsonEditorGroup.value=JSON.stringify(['featureModels']);elements.jsonEditorGroup.onchange();
  const config=store.read('config').data;config.editorDraft='file import';elements.jsonEditorImport.files=[{size:100,text:async()=>JSON.stringify(config)}];await elements.jsonEditorImport.onchange();await elements.jsonEditorSave.click();assert.equal(store.read('config').data.editorDraft,'file import');
  console.log('OK: seven files, group edits, preview/save, invalid draft preservation, reload, backup restore and full-file import.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
