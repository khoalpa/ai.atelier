'use strict';
// Demo files are selected by manifest; archived sources are never distributed.
const fs=require('node:fs'),path=require('node:path');
const catalog=require('../packages/samples/catalog');
function bundle(root,destination,{includeTests=false}={}){
 const source=catalog.read(root);if(!source)throw Error('Build a curated sample catalog first.');
 if(fs.existsSync(destination))throw Error('Sample bundle destination must be new.');
 fs.mkdirSync(destination,{recursive:true});
 const selected=source.assets.filter(a=>a.storage!=='archive'&&a.provenance?.redistributable&&
  (a.roles.includes('demo')||includeTests));
 const ids=new Set(selected.map(a=>a.id));
 const copy=relative=>{const from=path.resolve(root,'samples',relative),to=path.resolve(destination,relative);
  if(!from.startsWith(path.resolve(root,'samples')+path.sep)||!to.startsWith(path.resolve(destination)+path.sep))throw Error('Invalid sample bundle path');
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
 for(const a of selected){copy(a.path);if(a.thumbnail)copy(a.thumbnail);}
 function directory(relative){const full=path.join(root,'samples',relative);if(!fs.existsSync(full))return;for(const entry of fs.readdirSync(full,{withFileTypes:true})){const child=relative+'/'+entry.name;entry.isDirectory()?directory(child):copy(child);}}
 directory('licenses');
 if(includeTests){directory('testing/cases');for(const name of ['README.md','specs.json','manifest.jsonl','generation-prompts.md','dataset-status.json'])copy('datasets/synthetic-paired-vton/v1/'+name);copy('testing/regression-v1/object-removal/manifest.json');}
 const aliases=Object.fromEntries(Object.entries(source.aliases).filter(([,id])=>ids.has(id)));
 fs.writeFileSync(path.join(destination,'catalog.json'),JSON.stringify({schemaVersion:2,pack:includeTests?'demo-and-redistributable-tests':'demo',assets:selected},null,2));
 fs.writeFileSync(path.join(destination,'aliases.json'),JSON.stringify({schemaVersion:1,aliases},null,2));
 return {assets:selected.length,demo:selected.filter(a=>a.roles.includes('demo')).length,includeTests};
}
module.exports={bundle};
if(require.main===module){const destination=process.argv[2];if(!destination)throw Error('Usage: node scripts/bundle-samples.js DESTINATION [--include-tests]');console.log(JSON.stringify(bundle(path.resolve(__dirname,'..'),path.resolve(destination),{includeTests:process.argv.includes('--include-tests')})));}
