'use strict';
const path=require('node:path'),fs=require('node:fs');
function python(root){
 const override=process.env.ATELIER_PYTHON;
 if(override)return path.resolve(override);
 const candidates=[path.join(root,'.venv-sam2','Scripts','python.exe'),path.join(root,'runtime','python','python.exe')];
 return candidates.find(file=>fs.existsSync(file))||candidates[0];
}
module.exports={python};
