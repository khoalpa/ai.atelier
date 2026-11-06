'use strict';
const {readCatalog,renderTemplate}=require('./prompt-store');
function value(...keys){return keys.reduce((v,key)=>v[key],readCatalog());}
function live(...keys){return new Proxy({}, {
  get:(_,key)=>value(...keys)[key],
  ownKeys:()=>Reflect.ownKeys(value(...keys)),
  getOwnPropertyDescriptor:(_,key)=>Object.hasOwn(value(...keys),key)?{enumerable:true,configurable:true}:undefined,
  has:(_,key)=>Object.hasOwn(value(...keys),key)
});}
function template(key,variables){return renderTemplate(value('templates',key),variables);}
module.exports={value,live,template};
