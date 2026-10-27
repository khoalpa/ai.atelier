'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const testAsset=item=>item.sampleRole==='demo'?false:/(^|[ /_-])(benchmark|fixture|verification|synthetic|diagnostic|smoke|test)([ /_.-]|$)/i.test(`${item.id} ${item.name} ${item.sourceId||""}`)||/\/(mask|protected_mask|target_pose|editable_mask|clean)\.png$/i.test(item.url||'');
const searchText=value=>String(value||'').toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim();
const canonical=id=>!id?'':id.startsWith('output:')?'/outputs/'+id.slice(7):id.startsWith('reference:')?'/references/'+id.slice(10):id.startsWith('/')?id:id.startsWith('uploads/')?'/'+id:'/samples/'+id;
const metadata=require('../packages/storage/metadata');
async function read(file,fallback){if(require('./catalog-library').locate(file))return require('./catalog-library').read(file,fallback);return metadata.read(file,fallback);}
async function atomic(file,value){if(require('./catalog-library').write(file,value))return;return metadata.write(file,value);}
function createCatalog(root){
  const file=path.join(root,'workspace','asset-catalog.json');let tail=Promise.resolve();
  const serial=fn=>{const work=tail.then(()=>require('./process-lock').locked(file+'.lock',fn));tail=work.catch(()=>{});return work;};
  async function state(){return read(file,{version:1,assets:{},albums:[]});}
  async function update(body){return serial(async()=>{
    const data=await state();
    if(body.action==='album'){
      const name=String(body.name||'').trim().slice(0,80);if(!name)throw Error('Nhập tên album.');
      if(data.albums.length>=200)throw Error('Đã đủ 200 album.');
      if(!data.albums.includes(name))data.albums.push(name);
    }else{
      if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>1000||body.ids.some(id=>typeof id!=='string'||id.length>2048||id==='__proto__'||id==='constructor'))throw Error('Chọn từ 1 đến 1000 ảnh.');
      if(body.album!==undefined&&body.album&&!data.albums.includes(body.album))throw Error('Album không tồn tại.');
      for(const id of body.ids){const value=data.assets[id]||{};
        if(body.name!==undefined){const name=String(body.name).trim().slice(0,120);if(!name)throw Error('Nhập tên ảnh.');value.name=name;}
        if(body.favorite!==undefined)value.favorite=body.favorite===true;
        if(body.album!==undefined)value.album=body.album;
        if(body.testData!==undefined)value.testData=body.testData===true;
        if(body.review!==undefined){if(!['approved','needs-work','rejected','pending'].includes(body.review.status))throw Error('Trạng thái duyệt không hợp lệ.');const allowed=['blur','seam','residual','identity','garment','anatomy','prompt','color','other'];if(!Array.isArray(body.review.defects)||body.review.defects.some(x=>!allowed.includes(x)))throw Error('Nhãn lỗi không hợp lệ.');value.review={status:body.review.status,defects:[...new Set(body.review.defects)],updatedAt:new Date().toISOString()};}
        data.assets[id]=value;
      }
    }
    await atomic(file,data);return data;
  });}
  async function decorate(items){const data=await state();return items.map(item=>({...item,...data.assets[item.id],testData:data.assets[item.id]?.testData??testAsset(item)}));}
  async function query(items,params={}){
    const data=await state(),q=searchText(params.q),filter=params.filter||'all';
    let result=await decorate(items);
    result=result.filter(item=>(params.tests==='true'||filter==='tests'||!item.testData)&&(!q||searchText(`${item.name} ${item.id} ${item.task||''} ${item.album||''}`).includes(q))&&(!params.album||item.album===params.album));
    if(filter==='tests')result=result.filter(x=>x.testData);
    else if(filter==='favorite')result=result.filter(x=>x.favorite);
    else if(['approved','needs-work','rejected','pending-review'].includes(filter))result=result.filter(x=>x.sourceType==='result'&&(x.review?.status||'pending')===(filter==='pending-review'?'pending':filter));
    else if(['user','result','reference','sample','project'].includes(filter))result=result.filter(x=>x.sourceType===filter);
    result.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||a.id.localeCompare(b.id));
    if(filter==='recent')result=result.slice(0,100);
    const pageSize=Math.max(1,Math.min(100,Number(params.pageSize)||48)),pages=Math.max(1,Math.ceil(result.length/pageSize)),page=Math.max(1,Math.min(pages,Math.trunc(Number(params.page)||1)));
    return {assets:result.slice((page-1)*pageSize,page*pageSize),total:result.length,page,pageSize,pages,albums:data.albums};
  }
  async function projects(items,manual){
    const links=await read(path.join(root,'workspace','edit-history.json'),[]),parents=new Map();
    function find(v){if(!parents.has(v))parents.set(v,v);let p=parents.get(v);if(p!==v){p=find(p);parents.set(v,p);}return p;}
    function join(a,b){if(a&&b){const x=find(canonical(a)),y=find(canonical(b));if(x!==y)parents.set(y,x);}}
    for(const edge of links){join(edge.sourceId,edge.childId);join(edge.sourceId,edge.result);}
    for(const p of manual)join(p.sourceId,p.thumbnail);
    for(const item of items){if(item.sourceId)join(item.sourceId,item.url);if(item.projectId){const p=manual.find(x=>x.id===item.projectId);if(p)join(p.sourceId||p.thumbnail,item.url);}}
    const groups=new Map();
    for(const item of items){const key=find(canonical(item.url));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
    for(const p of manual){const key=find(canonical(p.sourceId||p.thumbnail));if(!groups.has(key))groups.set(key,[]);groups.get(key).push({id:'project:'+p.id,url:p.thumbnail,name:p.name,createdAt:p.updatedAt,sourceType:'project',task:'manual',projectId:p.id,revision:p.revision,sourceId:p.sourceId});}
    return [...groups.entries()].map(([key,assets])=>{assets.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));return {id:key,name:assets.find(a=>['user','sample'].includes(a.sourceType))?.name||assets[0].name,assets,thumbnail:assets.at(-1)?.url,updatedAt:assets.at(-1)?.createdAt};});
  }
  return {state,update,decorate,query,projects};
}
module.exports={createCatalog,testAsset,canonical,atomic,read};
