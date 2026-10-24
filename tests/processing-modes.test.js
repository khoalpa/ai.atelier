const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {listModes,saveMode}=require('../app/processing-mode-store');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-modes-')),file=path.join(temp,'modes.json');
fs.copyFileSync(require('../app/prompt-store').FILE,file);
try{
 const original=listModes(file);assert.deepEqual(original.map(mode=>mode.id),['base_layer','reconstruct_body','background']);
 const prompt='Opaque clothing, "quotes"\nÁnh sáng phù hợp';
 saveMode(file,{id:'base_layer',prompt});assert.equal(listModes(file)[0].prompt,prompt);
 assert.equal(JSON.parse(fs.readFileSync(file)).processingModes.base_layer.prompt,prompt);
 saveMode(file,{id:'background',prompt:'Continuous beige studio backdrop'});
 assert.equal(listModes(file)[0].prompt,prompt);
 saveMode(file,{id:'base_layer',reset:true});assert.equal(listModes(file)[0].prompt,JSON.parse(fs.readFileSync(file)).defaults.processingModes.base_layer.prompt);
 assert.equal(listModes(file)[2].prompt,'Continuous beige studio backdrop');
 const before=fs.readFileSync(file,'utf8');
 for(const body of [{id:'unknown',prompt:'x'},{id:'background',prompt:''},{id:'background',prompt:'x'.repeat(16001)}])assert.throws(()=>saveMode(file,body));
 assert.equal(fs.readFileSync(file,'utf8'),before);assert(fs.readdirSync(path.join(temp,'backups/prompts')).length>0);
 console.log('OK: processing modes persist, restore independently and reject invalid updates.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
