const fs=require('fs'),path=require('path'),assert=require('assert');
const baseUrl=process.argv[2]||'http://127.0.0.1:27866';
(async()=>{
 const baseline={...require('../app/makeup-styles.json').office,parts:['lips','eyes','cheeks','brows'],brow:'#493332',blush:'#b78871',strengths:{lips:100,eyes:80,cheeks:90,brows:100,base:100}};
 const description='Giữ màu son, giảm phấn mắt, má hồng nhẹ hơn.';
 const response=await fetch(baseUrl+'/api/makeup-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({style:'office',baseSettings:baseline,description})});
 const plan=await response.json();assert(response.ok&&plan.ok,JSON.stringify(plan));
 assert.equal(plan.lip,baseline.lip);assert.equal(plan.eyeshadow,baseline.eyeshadow);assert.equal(plan.blush,baseline.blush);assert.equal(plan.intensity,baseline.intensity);
 assert.equal(plan.strengths.eyes,52);assert.equal(plan.strengths.cheeks,59);assert.equal(plan.strengths.lips,100);
 const folder=path.join(__dirname,'../workspace/diagnostics/makeup-reference');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'language-verification.json'),JSON.stringify({passed:true,description,baseline,plan},null,2));
 console.log('PASS: real Vietnamese refinement keeps colors/global intensity and reduces only eye/cheek strength.');
})().catch(error=>{console.error(error);process.exitCode=1;});
