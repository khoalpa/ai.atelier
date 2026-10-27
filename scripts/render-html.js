'use strict';
const fs=require('node:fs'),path=require('node:path');

const includePattern=/<!--\s*@include\s+([^\s]+)\s*-->/g;

function renderHtml(file,root,stack=[]){
 const includeRoot=path.resolve(root);
 const resolved=path.resolve(file);
 if(!resolved.startsWith(includeRoot+path.sep))throw Error(`HTML include nằm ngoài ${includeRoot}: ${file}`);
 if(stack.includes(resolved))throw Error(`HTML include tạo vòng lặp: ${[...stack,resolved].map(item=>path.relative(includeRoot,item)).join(' -> ')}`);
 const source=fs.readFileSync(resolved,'utf8');
 return source.replace(includePattern,(_match,request)=>{
  const included=path.resolve(path.dirname(resolved),request);
  if(!included.startsWith(includeRoot+path.sep))throw Error(`HTML include nằm ngoài ${includeRoot}: ${request}`);
  if(path.extname(included)!=='.html')throw Error(`HTML include phải là tệp .html: ${request}`);
  return renderHtml(included,includeRoot,[...stack,resolved]).trimEnd();
 });
}

module.exports={includePattern,renderHtml};
