const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const store=require('../app/makeup-library-store'),{planMakeup,explicitOverrides}=require('../app/makeup-plan');
const base={...require('../app/makeup-styles.json').natural,style:'natural',brow:'#493332',parts:['lips','eyes','cheeks','brows'],strengths:{lips:80,eyes:60},description:'',plannedDescription:'',skinSmooth:0,preserveFeatures:true};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-makeup-')),file=path.join(root,'styles.json');
(async()=>{
 try{
  assert.deepEqual(store.read(file),[]);
  const item=store.save(file,{name:'Tông đào của tôi',settings:{...base,sampleId:'old',faceIndex:3,faceBox:[1,2,3,4],editableMask:'old',reference:'old'}});
  const loaded=store.read(file)[0];assert.equal(loaded.id,item.id);assert.equal(loaded.settings.lip,base.lip);
  for(const key of ['sampleId','faceIndex','faceBox','editableMask','reference'])assert(!Object.hasOwn(loaded.settings,key));
  store.save(file,{id:item.id,name:'Đổi tên',settings:{...base,lip:'#a02040'}});assert.equal(store.read(file).length,1);assert.equal(store.read(file)[0].settings.lip,'#a02040');
  assert.throws(()=>store.save(file,{id:'missing',name:'Oops',settings:base}));
  assert.throws(()=>store.save(file,{name:' ',settings:base}));assert.throws(()=>store.settings({...base,description:'Mới'}),/Đọc mô tả/);
  for(const value of [{eyes:NaN},{eyes:-1},{eyes:101},{eyes:true},{nose:20},[]])assert.throws(()=>store.settings({...base,strengths:value}));
  assert.throws(()=>store.settings({...base,brow:'red'}));assert.throws(()=>store.settings({...base,parts:['lips'],strengths:{lips:0}}));
  const changed=explicitOverrides({...base,lip:'#ff0000',strengths:{...base.strengths}},'Giữ màu son, giảm phấn mắt, má hồng nhẹ hơn.',base);
  assert.equal(changed.lip,base.lip);assert.equal(changed.blush,base.blush);assert.equal(changed.eyeshadow,base.eyeshadow);assert.equal(changed.strengths.eyes,39);assert.equal(changed.strengths.cheeks,65);
  let sent;const result=await planMakeup({style:'natural',description:'Giữ màu son, giảm phấn mắt.',baseSettings:base},async payload=>{sent=payload;return {message:{content:JSON.stringify(base)}}},'test');
  assert(sent.messages[1].content.includes(base.brow));assert.equal(result.lip,base.lip);assert.equal(result.strengths.eyes,39);
  fs.writeFileSync(file,'not json');assert.throws(()=>store.save(file,{name:'Keep',settings:base}));assert.equal(fs.readFileSync(file,'utf8'),'not json');
  console.log('PASS: style persistence/update, geometry excluded, validation, corruption preservation, refinement baseline.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
