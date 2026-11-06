// Compatibility entry point; processing modes share the prompt catalog.
const {listModes,saveMode}=require('../domain/catalog/prompt-store');
module.exports={listModes,saveMode};
