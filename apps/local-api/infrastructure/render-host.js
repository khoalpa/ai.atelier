'use strict';
// IPC disconnect also fires when the web process dies unexpectedly.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const [browser,origin,profile,root]=process.argv.slice(2);
const runtime=path.resolve(root,'workspace/runtime');
if(path.dirname(path.resolve(profile))!==runtime||!/^render-[a-f0-9-]{36}$/.test(path.basename(profile)))process.exit(2);
const child=spawn(browser,['--edge-skip-compat-layer-relaunch','--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-component-update','--disable-sync','--disable-features=msEdgeSidebarV2','--user-data-dir='+profile,origin],{windowsHide:true,stdio:'ignore'});
let stopping=false;
function stop(){if(stopping)return;stopping=true;child.kill();setTimeout(()=>process.exit(0),5000).unref();}
async function finish(){await fs.rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:250}).catch(()=>{});process.exit(0);}
process.on('disconnect',stop);process.on('message',stop);child.once('exit',finish);child.once('error',finish);
