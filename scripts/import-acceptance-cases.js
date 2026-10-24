'use strict';
// Import existing local evidence without replacing prior reviews or generating images.
const fs=require('node:fs/promises'),path=require('node:path');
const {createAcceptanceStore}=require('../app/acceptance-store');
(async()=>{const manifest=path.resolve(process.argv[2]),root=path.resolve(process.argv[3]||path.join(__dirname,'..'));const rows=JSON.parse(await fs.readFile(manifest,'utf8')),store=createAcceptanceStore(root);let added=0;const existing=(await store.state()).cases;for(const row of rows){if(existing.some(c=>c.task===row.task&&c.resultUrl===row.resultUrl))continue;await store.action({...row,action:'add'});added++;}console.log(JSON.stringify({added,...(await store.state()).summary}));})().catch(e=>{console.error(e.message);process.exitCode=1;});
