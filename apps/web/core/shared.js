'use strict';
// Owned state: $, SEED_MAX
// Dependencies: none
module.exports=function createShared(deps){
let $, SEED_MAX;
function createJobId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function randomSeed(){const values=new Uint32Array(1);globalThis.crypto?.getRandomValues?.(values);return Number((values[0]||Math.floor(Math.random()*SEED_MAX))%SEED_MAX);}

function setupSeedControl(id){
  const input=$(id),mode=$(`${id}Mode`),randomButton=$(`${id}Random`),resetButton=$(`${id}Reset`);if(!input||!mode)return;
  const defaultSeed=Number(input.dataset.defaultSeed),storageKey=`atelier.${id}.mode`,saved=localStorage.getItem(storageKey);
  if(['default','random','custom'].includes(saved))mode.value=saved;
  const sync=()=>{input.disabled=mode.value!=='custom';if(mode.value==='default')input.value=String(defaultSeed);input.title=mode.value==='random'?'Seed mới sẽ được tạo khi bắt đầu tác vụ.':'';localStorage.setItem(storageKey,mode.value);};
  mode.addEventListener('change',sync);
  input.addEventListener('input',()=>{mode.value='custom';sync();});
  randomButton?.addEventListener('click',()=>{mode.value='custom';input.value=String(randomSeed());sync();});
  resetButton?.addEventListener('click',()=>{mode.value='default';sync();});
  sync();
}

function seedForRun(id){
  const input=$(id),mode=$(`${id}Mode`);if(!input||!mode)throw new Error('Thiếu thiết lập seed');
  if(mode.value==='random')input.value=String(randomSeed());
  const seed=Number(input.value);if(!Number.isSafeInteger(seed)||seed<0||seed>SEED_MAX)throw new Error(`Seed phải là số nguyên từ 0 đến ${SEED_MAX}.`);
  return seed;
}

function setCustomSeed(id,seed){const input=$(id),mode=$(`${id}Mode`);input.value=String(seed);if(mode){mode.value='custom';mode.dispatchEvent(new Event('change'));}}

function setMessage(text, kind = '') {
  $('message').hidden = false;
  $('message').textContent = text+(kind==='error'&&window.StudioGuidance?' '+window.StudioGuidance.recovery(text):'');
  $('message').className = `message ${kind}`;
}
return {bindings:{get $(){return $;},set $(value){$=value;},
get createJobId(){return createJobId;},set createJobId(value){createJobId=value;},
get SEED_MAX(){return SEED_MAX;},set SEED_MAX(value){SEED_MAX=value;},
get randomSeed(){return randomSeed;},set randomSeed(value){randomSeed=value;},
get setupSeedControl(){return setupSeedControl;},set setupSeedControl(value){setupSeedControl=value;},
get seedForRun(){return seedForRun;},set seedForRun(value){seedForRun=value;},
get setCustomSeed(){return setCustomSeed;},set setCustomSeed(value){setCustomSeed=value;},
get setMessage(){return setMessage;},set setMessage(value){setMessage=value;}},steps:[
function initialize(){
($ = (id) => document.getElementById(id));
},
function initialize(){
(SEED_MAX = 2147483647);
}
]};
};
