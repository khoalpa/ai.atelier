/* Local model acceptance checks. No portrait or user text leaves the machine. */
const fs=require('fs'),path=require('path'),assert=require('assert');
const {planMakeup}=require('../app/makeup-plan');
const model=process.argv[2]||'qwen3:4b';
const cases=[
 {description:'Chỉ tô son hồng đất, không trang điểm mắt, giữ tàn nhang.',check:p=>{assert.deepEqual(p.parts,['lips']);assert.equal(p.lip,'#a66b70');}},
 {description:'Trang điểm tự nhiên tông đào, son hồng đất, kẻ mắt mảnh, giữ lại tàn nhang và màu da hiện tại.',check:p=>{assert(p.parts.includes('eyes')&&p.parts.includes('lips'));assert.equal(p.eyeliner,'thin');assert.equal(p.intensity,'light');}},
 {description:'Phấn mắt tím có nhũ bạc, son đỏ rượu bóng.',check:p=>{assert.equal(p.renderer,'ai');assert(p.parts.includes('eyes')&&p.parts.includes('lips'));assert(/glitter|shimmer|sparkle/i.test(p.prompt));}},
 {description:'Phong cách nàng tiên rừng, mí mắt xanh lá, họa tiết lá nhỏ ở gò má, không sửa môi.',check:p=>{assert.equal(p.renderer,'ai');assert(!p.parts.includes('lips'));assert(p.parts.includes('eyes')&&p.parts.includes('cheeks'));assert(/leaf|leaves/i.test(p.prompt));}}
];
async function request(body){const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
(async()=>{
 const until=Date.now()+40*60*1000;
 while(true){const tags=await (await fetch('http://127.0.0.1:11434/api/tags')).json();if(tags.models.some(x=>x.name===model))break;if(Date.now()>until)throw Error('Model not installed before verification deadline');await new Promise(resolve=>setTimeout(resolve,15000));}
 const results=[];let failed=0;
 for(const item of cases){
  try{const plan=await planMakeup({style:'natural',description:item.description},request,model);let passed=true;try{item.check(plan);}catch(error){passed=false;failed++;}results.push({...plan,passed});console.log(JSON.stringify({description:item.description,passed,prompt:plan.prompt,renderer:plan.renderer,parts:plan.parts}));}
  catch(error){failed++;results.push({description:item.description,passed:false,error:error.message});console.error(error.message);}
 }
 const folder=path.join(__dirname,'../workspace/diagnostics/makeup');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'language-verification.json'),JSON.stringify({model,passed:!failed,cases:results},null,2));
 assert.equal(failed,0,`${failed} makeup interpretation checks failed`);
 console.log('PASS: Vietnamese descriptions preserve requested colors, effects, regions and exclusions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
