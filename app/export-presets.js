'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,read}=require('./asset-catalog'),Core=require('./public/export-core');
function createExportPresets(root){const file=path.join(root,'workspace/export-presets.json');let tail=Promise.resolve();const defaults=[{id:'square',name:'Vuông 1080',spec:Core.validate({width:1080,height:1080,fit:'cover'})},{id:'portrait',name:'Dọc 4:5',spec:Core.validate({width:1080,height:1350,fit:'cover'})},{id:'story',name:'Dọc 9:16',spec:Core.validate({width:1080,height:1920,fit:'contain'})}];
 async function list(){return read(file,defaults);}
 async function save(body){const task=tail.then(async()=>{const items=await list();if(body.action==='remove'){await atomic(file,items.filter(i=>i.id!==body.id));return {removed:true};}const spec=Core.validate(body.spec);if(spec.logoUrl)await fs.access(path.join(root,'workspace/manual/assets',spec.logoUrl.split('/').at(-1)));const name=String(body.name||'').trim().slice(0,100);if(!name)throw Error('Nhập tên mẫu xuất.');const i=items.findIndex(x=>x.id===body.id);if(i<0&&items.length>=100)throw Error('Tối đa 100 mẫu xuất.');const item={id:i<0?crypto.randomUUID():body.id,name,spec};if(i<0)items.push(item);else items[i]=item;await atomic(file,items);return item;});tail=task.catch(()=>{});return task;}
 return {list,save};}
module.exports={createExportPresets};
