const path = require('path');
const fs = require('fs');
const readline = require('readline');
const {spawn} = require('child_process');

// A CPU-only worker watches persisted completions, independently of browser tabs
// and the GPU inference service. One SQLite claim also covers multiple web ports.
function createQualityService(root, options = {}) {
  let child = null, sequence = 0, stopped = false, restartTimer = null;
  const pending = new Map();
  const python = options.python || process.env.ATELIER_QUALITY_PYTHON ||
    path.join(root, '.venv-sam2', 'Scripts', 'python.exe');
  function start() {
    if (child || stopped) return;
    if (!fs.existsSync(python)) throw new Error('Không tìm thấy Python cho bộ kiểm tra chất lượng.');
    const processChild = spawn(python, ['-u', options.workerPath || path.join(root, 'quality_learning.py'), '--root', root], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, PYTHONIOENCODING: 'utf-8'},
    });
    child = processChild;
    const lines = readline.createInterface({input: processChild.stdout});
    lines.on('line', line => {
      let result; try { result = JSON.parse(line); } catch { return; }
      const waiter = pending.get(result.id); if (!waiter) return;
      pending.delete(result.id); clearTimeout(waiter.timer);
      if (result.ok) waiter.resolve(result); else waiter.reject(new Error(result.error || 'Không thể kiểm tra chất lượng.'));
    });
    processChild.stderr.on('data', data => console.error('[quality]', String(data).trim().slice(0, 500)));
    const failed = () => {
      if (child !== processChild) return;
      child = null;
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Bộ kiểm tra chất lượng đã dừng. Hãy thử lại.')); }
      pending.clear();
      if (!stopped) restartTimer = setTimeout(() => { try { start(); } catch {} }, 5000);
    };
    processChild.once('error', failed); processChild.once('exit', failed);
    processChild.stdin.on('error', () => {});
  }
  function call(method, params = {}) {
    start();
    if (!child) return Promise.reject(new Error('Bộ kiểm tra chất lượng chưa sẵn sàng.'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Kiểm tra chất lượng đang bận. Hãy thử lại.')); }, 15000);
      pending.set(id, {resolve, reject, timer});
      child.stdin.write(JSON.stringify({id, method, params}) + '\n');
    });
  }
  function stop() { stopped = true; clearTimeout(restartTimer); child?.stdin.end(); }
  return {start, call, stop};
}
module.exports = {createQualityService};
