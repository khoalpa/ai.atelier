// @ts-check
'use strict';
const catalog=require('./tasks.json');
/** @typedef {'queued'|'running'|'cancelling'|'completed'|'failed'|'cancelled'|'interrupted'} JobStatus */
/** @typedef {{jobId:string,status:JobStatus,taskType:string,stage?:string,results?:unknown[],error?:string,resumable?:boolean}} JobState */
/** @param {unknown} value @returns {string} */
function jobId(value){if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(value))throw Error('Mã tác vụ không hợp lệ.');return value;}
/** @param {string} route */
function forRoute(route){return Object.entries(catalog.tasks).find(([,task])=>task.route===route);}
/** @param {unknown} value @returns {value is JobStatus} */
function isStatus(value){return typeof value==='string'&&['queued','running','cancelling','completed','failed','cancelled','interrupted'].includes(value);}
/** @param {unknown} status */
function terminal(status){return ['completed','failed','cancelled'].includes(String(status));}
module.exports={jobId,forRoute,isStatus,terminal,tasks:catalog.tasks};
