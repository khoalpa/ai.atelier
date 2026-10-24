const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=require('./helpers/source').read(path.join(__dirname,'../app/public/app.js'),'utf8');
const nodes={resultsGrid:{children:[],innerHTML:''},resultsDialog:{open:false,classList:{remove(){}},showModal(){this.open=true}},comparePanel:{hidden:false},studioResultsFilmstrip:{children:[]},studioResultsTray:{hidden:true,scrollIntoView(){this.scrolled=true}}};
const context={$:id=>nodes[id],activateAppView(){},setMessage(){},escapeHtml:value=>String(value),outputUrl:file=>'/'+file.replace(/^workspace\//,'')};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function generationActionState('),source.indexOf('function presentStudioResults(')),context);
for(const status of ['cancelled','failed','completed']){
  assert.equal(context.generationActionState({status,cancelRequested:true,results:[{file:'result.png'}]}).disabled,false);
  assert.equal(context.generationActionState({status,results:[]}).disabled,true);
}
assert.equal(context.generationActionState({status:'running',cancelRequested:true}).disabled,true);
context.showGenerationResult({taskType:'inpaint',status:'cancelled',results:[{seed:0,file:'workspace/outputs/partial.png'}]});
assert(nodes.resultsDialog.open);
assert(nodes.resultsGrid.innerHTML.includes('/outputs/partial.png'));
assert(nodes.resultsGrid.innerHTML.includes('Seed 0'));
assert(nodes.comparePanel.hidden);
nodes.resultsGrid.children=[{}];nodes.studioResultsFilmstrip.children=[{}];
context.showGenerationResult({taskType:'inpaint',status:'completed',results:[{file:'result.png'}]});
assert.equal(nodes.studioResultsTray.hidden,false);
assert(nodes.studioResultsTray.scrolled);
assert(source.includes('primary.disabled=disabled;primary.dataset.command=done?'));
assert(source.includes("else if(command==='results'){showGenerationResult(activityState);}"));
console.log('OK: cancelled/failed results stay accessible, saved partial images open, completed tray reopens.');
