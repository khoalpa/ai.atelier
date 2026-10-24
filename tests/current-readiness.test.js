const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const port = 17860;
const child = spawn(process.execPath, [path.join(root, 'app', 'server.js')], {
  cwd: root,
  env: { ...process.env, AI_IMAGE_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Máy chủ kiểm thử không khởi động');
}

(async () => {
  try {
    await waitForServer();
    const readiness = await (await fetch(`http://127.0.0.1:${port}/api/reference-readiness`)).json();
    assert.equal(readiness.total, 3);
    assert.equal(readiness.readyCount, readiness.items.filter(item=>item.ready).length);
    assert.equal(readiness.allReady, readiness.readyCount===readiness.total);
    assert.ok(readiness.items.every((item) => item.ready ? item.blockers.length===0 : item.blockers.length>0));

    const blocked = await fetch(`http://127.0.0.1:${port}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: '__unregistered__', garmentImage: 'data:image/png;base64,AAAA' }),
    });
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json();
    assert.match(blockedBody.error, /Benchmark bị chặn/);

    const acceptance = await (await fetch(`http://127.0.0.1:${port}/api/release-acceptance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    assert.equal(acceptance.referenceReady, readiness.allReady);
    assert.equal(acceptance.contentReady, readiness.allReady&&Object.values(acceptance.approvedByCategory).every(count=>count>=23));
    assert.equal(acceptance.technicalPassed, acceptance.checks.every(item=>item.passed));
    if(!readiness.allReady)assert.ok(acceptance.blockers.length>0);
    console.log(`OK: trạng thái thật đã được audit; ${acceptance.blockers.length} blocker được ghi nhận.`);
  } finally {
    child.kill();
  }
})().catch((error) => { child.kill(); console.error(error); process.exitCode = 1; });
