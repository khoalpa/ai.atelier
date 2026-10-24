const fs=require('fs'),vm=require('vm'),assert=require('assert');
function storage(values){const entries=new Map(Object.entries(values));return{get length(){return entries.size},key:i=>[...entries.keys()][i],removeItem:k=>entries.delete(k),entries};}
const localStorage=storage({'atelier.promptLibrary.v1':'draft','atelier.accessoryPresetPrompts.v1':'override','selectedImageId':'image','studioMode':'tryon','unrelated-app':'keep'});
const sessionStorage=storage({'atelier.session':'draft','unrelated-session':'keep'});
const window={localStorage,sessionStorage};
vm.runInNewContext(fs.readFileSync('app/public/browser-data.js','utf8'),{window});
window.AtelierBrowserData.clear();
assert.deepEqual([...localStorage.entries],[['unrelated-app','keep']]);
assert.deepEqual([...sessionStorage.entries],[['unrelated-session','keep']]);
window.AtelierBrowserData.clear();
const script=fs.readFileSync('app/public/app.js','utf8');
assert(script.includes("window.confirm('Xóa dữ liệu AI Atelier"));
assert(script.includes("data-clear-browser-data"));
console.log('OK: clear project local/session storage, preserve unrelated data, repeated clearing, confirmation UI.');
