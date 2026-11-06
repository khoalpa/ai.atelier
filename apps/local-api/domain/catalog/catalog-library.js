'use strict';
const fs=require('node:fs'),path=require('node:path');
const names={'makeup-styles.json':'makeup','character-presets.json':'character','export-presets.json':'export','manual/presets.json':'color'};
function locate(file){const absolute=path.resolve(file);for(const [suffix,key] of Object.entries(names)){const tail=path.join('workspace',suffix);if(absolute.endsWith(path.sep+tail))return {key,file:absolute.slice(0,-suffix.length)+'prompts.json'};}return null;}
function read(file,fallback){const target=locate(file);if(target&&fs.existsSync(target.file)){const catalog=JSON.parse(fs.readFileSync(target.file,'utf8'));if(Object.hasOwn(catalog.personalLibraries||{},target.key))return structuredClone(catalog.personalLibraries[target.key]);}try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function write(file,value){const target=locate(file);if(!target||!fs.existsSync(target.file))return false;require('./prompt-store').updateCatalog(catalog=>{catalog.personalLibraries||={};catalog.personalLibraries[target.key]=value;},target.file);return true;}
module.exports={locate,read,write};
