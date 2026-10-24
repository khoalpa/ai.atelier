const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const {createQualityService} = require('../app/quality-service');
const root = path.resolve(__dirname,'..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(),'atelier-quality-'));
const service = createQualityService(fixture, {python:path.join(root,'.venv-sam2/Scripts/python.exe'),workerPath:path.join(root,'quality_learning.py')});
(async () => {
  try {
    const [one,two] = await Promise.all([service.call('state'), service.call('state')]);
    assert.equal(one.settings.mode,'observe'); assert.equal(two.summary.results,0);
    const report = (await service.call('report')).report;
    assert.equal(report.tasks.length,4); assert.equal(report.total.recorded,0);
    assert.equal(report.total.preferImprovedRate,null);
    await service.call('configure',{mode:'auto',maxSeconds:4,revision:one.settings.revision});
    assert.equal((await service.call('state')).settings.mode,'auto');
    await assert.rejects(service.call('configure',{mode:'off',maxSeconds:4,revision:one.settings.revision}),/cửa sổ khác/);
    await assert.rejects(service.call('feedback',{resultId:'unknown',rating:'good'}),/Không tìm thấy/);
    await assert.rejects(service.call('shell'),/không hợp lệ/);
    console.log('OK: real worker IPC, concurrent requests, persistent settings, stale-write rejection and validation.');
  } finally { service.stop(); }
})().catch(error => { console.error(error); process.exitCode=1; });
