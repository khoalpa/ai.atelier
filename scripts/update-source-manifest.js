'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),file=path.join(root,'version.json'),version=JSON.parse(fs.readFileSync(file,'utf8'));
const sources=fs.readdirSync(root).filter(n=>n.endsWith('.py'));
function walk(relative){for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const name=relative+'/'+item.name;if(item.isDirectory()&&item.name!=='__pycache__')walk(name);else if(item.isFile()&&item.name.endsWith('.py'))sources.push(name);}}
walk('services');
version.aiSources=[...new Set(['version.json',...sources,'packages/contracts/tasks.json',...version.aiSources.filter(n=>n.startsWith('vendor/'))])].sort();
fs.writeFileSync(file,JSON.stringify(version,null,2)+'\n');
console.log('Updated AI source manifest:',version.aiSources.length,'files.');
