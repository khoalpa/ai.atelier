'use strict';
// Compatibility seam for existing isolated algorithm tests. Read CURRENT
// module bodies, exposing injected dependencies as the test's mock globals.
// The recipe stores declaration order/names only, never old implementations.
// Real module wiring is tested separately by modular-runtime.test.*.
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
const root=path.resolve(__dirname,'../..'),recipes=require('./source-order.json');
const parse=text=>acorn.parse(text,{ecmaVersion:'latest'});
const normalize=text=>text.replace(/\bdeps\./g,'').replace(/\bglobalThis\.AtelierApp\./g,'');
function projected(kind){
 const functions=new Map(),variables=new Map(),assignments=new Map(),steps=[];
 const files=kind==='web'?require('../../apps/web/manifest.json').modules.map(n=>'apps/web/core/'+n+'.js'):['apps/local-api/application.js',...require('../../apps/local-api/source-manifest.json').map(n=>'apps/local-api/'+n)];
 const moduleSteps={};
 for(const file of files){
  const text=fs.readFileSync(path.join(root,file),'utf8'),tree=parse(text);
  const factory=tree.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.left.object?.name==='module');
  const body=factory?.expression.right.body?.body||tree.body;
  for(const node of body){
   if(node.type==='FunctionDeclaration'){
    const entries=functions.get(node.id.name)||[];entries.push(normalize(text.slice(node.start,node.end)));functions.set(node.id.name,entries);
   }else if(node.type==='VariableDeclaration'){for(const d of node.declarations)if(d.id.name)variables.set(d.id.name,normalize(text.slice(node.start,node.end)));}
   else if(node.type==='ExpressionStatement'&&node.expression.type==='AssignmentExpression')assignments.set(node.expression.left.name||node.expression.left.property?.name,normalize(text.slice(node.start,node.end)));
  }
  if(kind==='web'){
   const ret=body.find(n=>n.type==='ReturnStatement');
   moduleSteps[path.basename(file,'.js')]=ret.argument.properties.find(p=>p.key.name==='steps').value.elements.map(fn=>normalize(text.slice(fn.body.start+1,fn.body.end-1)));
  }
 }
 if(kind==='web')for(const item of require('../../apps/web/manifest.json').steps)steps.push(moduleSteps[item.module][item.step]);
 let step=0;
 return recipes[kind].map(item=>{
  if(item.fn)return functions.get(item.fn)?.shift()||'';
  if(kind==='api')return item.assign?assignments.get(item.assign)||'':variables.get(item.variable)||'';
  const text=steps[step++];
  if(!item.declarations)return text;
  const nodes=parse(text).body;
  return item.kind+' '+item.declarations.map((prefix,i)=>prefix+text.slice(nodes[i].expression.right.start,nodes[i].expression.right.end)).join(',')+';';
 }).join('\n\n');
}
function read(file,encoding){
 const relative=path.relative(root,String(file)).replaceAll('\\','/');let text;
 if(relative==='app/server.js')text=projected('api');
 else if(relative==='app/public/app.js')text=projected('web');
 else if(relative==='ai_service.py')text=Object.values(require('../../services/ai/symbols.json')).filter((v,i,a)=>a.indexOf(v)===i).map(name=>fs.readFileSync(path.join(root,name.replaceAll('.','/')+'.py'),'utf8')).join('\n');
 else if(relative.startsWith('app/public/')&&relative.endsWith('.js'))text=normalize(fs.readFileSync(file,'utf8'));
 else return fs.readFileSync(file,encoding);
 return encoding?text:Buffer.from(text);
}
module.exports={read,projected,normalize};
