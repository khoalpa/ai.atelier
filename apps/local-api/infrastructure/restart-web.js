// Detached helper: wait for the old server to release its port before starting.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const parentPid = Number(process.argv[2]);
const root = path.resolve(__dirname, '..');
const deadline = Date.now() + 20000;
const timer = setInterval(() => {
  try {
    process.kill(parentPid, 0);
    if (Date.now() > deadline) process.exit(1);
    return;
  } catch (error) {
    if (error.code !== 'ESRCH') process.exit(1);
  }
  clearInterval(timer);
  const log = fs.openSync(path.join(root, 'workspace', 'web-server.log'), 'a');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
  });
  child.on('error', (error) => { fs.writeSync(log, `${error.stack}\n`); process.exitCode = 1; });
  child.unref();
  fs.closeSync(log);
}, 250);
