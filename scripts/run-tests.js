'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const label = option('--label', 'verification').replace(/[^a-zA-Z0-9_-]/g,'');
const group = option('--group', 'all');
const report = path.join(root, 'workspace', 'diagnostics', 'refactor', label);
const stage = path.join(report, 'project');
fs.mkdirSync(stage, {recursive:true});
const tracked = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const name of new Set(tracked)) {
  const file=path.join(root,name);if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
  const target=path.join(stage,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
}
// These directories are read-only inputs to the regression suite. Mutable data
// is copied below; test servers never receive the user's queue or job files.
for(const name of ['.venv-sam2','.venv-ai','models','weights','vendor','samples','node_modules']) {
  const source=path.join(root,name),target=path.join(stage,name);
  if(fs.existsSync(source)&&!fs.existsSync(target))fs.symlinkSync(source,target,'junction');
}
for(const name of ['config.json','prompts.json','character-presets.json','makeup-styles.json','export-presets.json']) {
  const source=path.join(root,'workspace',name),target=path.join(stage,'workspace',name);
  if(fs.existsSync(source)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
}
for(const name of ['reference-profiles.json','golden-baseline.json']) {
  const source=path.join(root,'workspace','review',name),target=path.join(stage,'workspace','review',name);
  if(fs.existsSync(source)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
}
const pattern=option('--match','');
const files=fs.readdirSync(path.join(stage,'tests')).filter(n=>
  (group==='all'?/\.test\.(js|py)$/:group==='js'?/\.test\.js$/:/\.test\.py$/).test(n)&&(!pattern||new RegExp(pattern).test(n)));
const results=[];
async function run(name) {
  const started=Date.now(),python=path.join(root,'.venv-sam2','Scripts','python.exe');
  const command=name.endsWith('.py')?python:process.execPath;
  const output=fs.createWriteStream(path.join(report,name+'.log'));
  const fixture=option('--quality-fixture',path.join(root,'workspace/diagnostics/refactor/quality-fixture-v3/fixture'));
  const child=spawn(command,[path.join(stage,'tests',name)],{cwd:stage,windowsHide:true,env:{...process.env,QUALITY_FIXTURE_ROOT:fixture,PYTHONPATH:stage,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',ATELIER_TEST_WORKSPACE_ARTIFACTS:'0',ATELIER_DISABLE_BACKGROUND:'1'}});
  child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},180000);
  const code=await new Promise(resolve=>{child.once('error',error=>{output.write(String(error));resolve(-1);});child.once('exit',resolve);});
  clearTimeout(timer);output.end();
  const result={file:name,passed:code===0&&!timedOut,code,timedOut,ms:Date.now()-started};results.push(result);
  console.log(`${result.passed?'PASS':'FAIL'} ${name} (${result.ms} ms)`);
  fs.writeFileSync(path.join(report,'results.json'),JSON.stringify({label,stage,completed:results.length,total:files.length,passed:results.filter(r=>r.passed).length,results},null,2));
}
(async()=>{
  // Some older integration tests use fixed ports. Keep the suite sequential.
  for(const file of files)await run(file);
  console.log(JSON.stringify({report,total:files.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).map(r=>r.file)}));
  process.exitCode=results.some(r=>!r.passed)?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
