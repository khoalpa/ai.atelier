const assert=require('assert'),fs=require('fs'),path=require('path');
const navigation=fs.readFileSync(path.join(__dirname,'../apps/web/core/navigation.js'),'utf8');
const regions=fs.readFileSync(path.join(__dirname,'../apps/web/features/shared-regions.js'),'utf8');

assert(navigation.includes("window.SharedRegions?.setStudioVisible(name==='create')"));
assert(regions.includes("panel.hidden=!visible"));
assert(regions.includes("if(!visible)panel.open=false"));
assert(regions.includes("setStudioVisible(globalThis.AtelierApp.currentAppView==='create')"));
assert(regions.includes('global.SharedRegions={load,setStudioVisible}'));

console.log('OK: shared regions are visible only in Studio and collapse when leaving it.');
