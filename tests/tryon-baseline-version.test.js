const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const source=fs.readFileSync('app/server.js','utf8');
const code=source.slice(source.indexOf('async function compareGoldenBaseline('),source.indexOf('async function cleanupJobs('));
let version=1,category='upper_body',response;
const metrics={qualityScore:90,referenceSimilarity:.8,seamScore:90,anatomyScore:100,textureContinuity:90};
const context={path,ROOT:process.cwd(),REVIEW_DIR:path.join(process.cwd(),'workspace/review'),
 fs:{existsSync:()=>true,readFileSync:()=>JSON.stringify({cases:[{sampleId:'a',selected:'a.png',category,qualityVersion:version,metrics}]}),mkdirSync(){},writeFileSync(){}},
 parseJson:async()=>({}),latestOutputBySource:()=>new Map([['a',{selectedPath:path.join(process.cwd(),'b.png'),metadata:{qualityVersion:2,category:'upper_body',selectedMetrics:metrics}}]]),
 send:(_,status,body)=>{assert.equal(status,200);response=JSON.parse(body);}};
vm.createContext(context);vm.runInContext(code,context);
(async()=>{
 await context.compareGoldenBaseline({},{});assert.equal(response.missing,1);assert.equal(response.passed,0);assert.deepEqual(response.cases[0].deltas,{});
 version=2;await context.compareGoldenBaseline({},{});assert.equal(response.passed,1);
 category='lower_body';await context.compareGoldenBaseline({},{});assert.equal(response.missing,1);
 console.log('OK: regression comparisons require matching metric version and garment category.');
})().catch(error=>{console.error(error);process.exitCode=1;});
