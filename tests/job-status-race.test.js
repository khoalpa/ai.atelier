const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = require('./helpers/source').read(require('path').join(__dirname, '../app/public/app.js'), 'utf8');
const apply = source.slice(source.indexOf('function applyJobState('), source.indexOf('async function resumeActiveJob('));
const rendered = [], messages = [];
const context = {
  activeJobId: 'outpaint-current',
  activityState: {jobId:'outpaint-current', taskType:'outpaint', status:'running', stage:'preparing'},
  renderActivity: state => rendered.push(state), setMessage: value => messages.push(value),
  $: () => ({}), jobPollTimer:null, jobEventSource:null,
  localStorage:{removeItem(){}},
};
vm.createContext(context);
vm.runInContext(apply, context);
context.applyJobState({ok:true, status:'unknown'});
assert.equal(rendered.length, 0, 'unregistered job must not replace the preparing state');
context.applyJobState({ok:true, jobId:'outpaint-previous', status:'completed'});
assert.equal(context.activeJobId, 'outpaint-current', 'late events must not clear the current job');
context.applyJobState({ok:true, jobId:'outpaint-current', status:'failed', stage:'failed', error:'Endpoint unavailable'});
assert.equal(rendered[0].taskType, 'outpaint', 'early errors retain the task type and inline error display');
assert.equal(rendered[0].error, 'Endpoint unavailable');
assert.equal(context.activeJobId, '');
console.log('OK: unknown and stale job states ignored; early errors retain task context.');
