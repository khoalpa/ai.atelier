const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
const source = require('./helpers/source').read(path.join(__dirname, '../app/server.js'), 'utf8');
const code = source.slice(source.indexOf('function parseJson('), source.indexOf('function decodePngDataUrl(')) +
  source.slice(source.indexOf('async function proxyToAi('), source.indexOf('function serveFile(')) +
  source.slice(source.indexOf('async function handleRequest('), source.indexOf('let webRestartPending'));
async function listen(server) {await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port;}
(async () => {
  const ai = http.createServer((req, res) => {
    let bytes = 0;
    req.on('data', chunk => bytes += chunk.length);
    req.on('end', () => res.end(JSON.stringify({ok: true, bytes, endpoint: req.url})));
  });
  const aiPort = await listen(ai);
  const context = {taskRoutes:null,taskCoordinator:null,URL, Buffer, http, HOST: '127.0.0.1', PORT: 0, AI_PORT: aiPort, webRestartPending:false, serviceManager:{busy:()=>false},
    send: (res, status, body) => {res.writeHead(status, {'Content-Type':'application/json'}); res.end(body);}};
  vm.createContext(context); vm.runInContext(code, context);
  const web = http.createServer((req, res) => context.handleRequest(req, res).catch(error => {res.statusCode = 500; res.end(error.message);}));
  try {
    const port = await listen(web);
    const payload = JSON.stringify({sampleId: 'characters/c001.png', editableMask: 'x'.repeat(3 * 1024 * 1024)});
    for (const endpoint of ['/inpaint', '/inpaint-prompts']) {
      const response = await fetch(`http://127.0.0.1:${port}/api${endpoint}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:payload});
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.endpoint, endpoint);
      assert.equal(result.bytes, Buffer.byteLength(payload));
    }
  } finally {
    await Promise.all([new Promise(resolve => web.close(resolve)), new Promise(resolve => ai.close(resolve))]);
  }
  console.log('OK: inpaint and prompt confirmation forward payloads larger than 2 MB intact.');
})().catch(error => {console.error(error); process.exitCode = 1;});
