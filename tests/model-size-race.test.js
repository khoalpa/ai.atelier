const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../app/server.js'),'utf8');
const body=source.slice(source.indexOf('function directorySize('),source.indexOf('function verifyModelEntry('));
for(const code of ['ENOENT','ENOTDIR','EACCES']){
  const context={fs:{statSync(){throw Object.assign(new Error(code),{code});}},path};
  vm.createContext(context);vm.runInContext(body,context);
  if(code==='EACCES')assert.throws(()=>context.directorySize('model'),/EACCES/);
  else assert.equal(context.directorySize('model'),0);
}
console.log('OK: catalog scans tolerate files disappearing as downloads finish; other errors remain visible.');
