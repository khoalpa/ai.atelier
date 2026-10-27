'use strict';
const fs=require('node:fs'),path=require('node:path');
const {renderHtml}=require('../../scripts/render-html');

const root=path.resolve(__dirname,'../..');
const webRoot=path.join(root,'apps/web');

module.exports=()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(webRoot,'manifest.json'),'utf8'));
 const scripts=manifest.browserScripts.map(file=>`  <script src="/${file}"></script>`).join('\n');
 return renderHtml(path.join(webRoot,'index.html'),webRoot).replace('  <!-- @scripts -->',scripts);
};
