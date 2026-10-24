const fs = require('fs'), vm = require('vm'), http = require('http'), assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../app/server.js'), 'utf8');
const code = source.slice(source.indexOf('async function proxyToAi('), source.indexOf('function serveFile('));
(async () => {
  for (const interrupted of [false, true]) {
    const ai = http.createServer((req, res) => {
      req.resume();
      if (interrupted) {
        res.writeHead(200); res.write('{"ok":');
        setTimeout(() => res.destroy(), 20);
      } else res.end('{"ok":true}');
    });
    await new Promise(resolve => ai.listen(0, '127.0.0.1', resolve));
    const context = {http, Buffer, AI_PORT: ai.address().port, parseJson: async () => ({}), send: (res, status, data) => {res.writeHead(status); res.end(data);}};
    vm.createContext(context); vm.runInContext(code, context);
    const web = http.createServer((req, res) => context.proxyToAi(req, res));
    await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${web.address().port}`, {method:'POST'});
      const body = await response.json();
      assert.equal(response.status, interrupted ? 503 : 200);
      assert.equal(body.ok, !interrupted);
      if (interrupted) assert.match(body.error, /Mất kết nối/);
    } finally { await Promise.all([new Promise(resolve => web.close(resolve)), new Promise(resolve => ai.close(resolve))]); }
  }
  console.log('OK: AI responses and interrupted upstream connections return valid JSON.');
})().catch(error => {console.error(error); process.exitCode=1;});
