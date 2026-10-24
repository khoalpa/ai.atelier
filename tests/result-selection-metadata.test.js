const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
const code = source.slice(source.indexOf('async function selectResult('), source.indexOf('async function proxyToAi('));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-selection-'));
  const directory = path.join(root, 'workspace', 'outputs', 'demo');
  fs.mkdirSync(directory, {recursive: true});
  const metadataPath = path.join(directory, 'metadata.json');
  const metrics = {qualityScore: 45, rankingScore: 40, referenceSimilarity: .4, seamScore: 50, anatomyScore: 80, textureContinuity: 60};
  const metadata = {selectedSeed: 1, selectedMetrics: {qualityScore: 95}, selectedQualityScore: 95,
    bodyAudit: {passed: true}, qualityGate: {passed: true, minimumQuality: 75, minimumSimilarity: .55, minimumSeam: 65, minimumAnatomy: 90},
    results: [{seed: 2, file: 'retry_seed_2.png', ...metrics, bodyAudit: {passed: false}}]};
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  fs.writeFileSync(path.join(directory, 'retry_seed_2.png'), 'second image');
  let seed = 2, response;
  const context = {fs, path, ROOT: root, MASKS_DIR: path.join(root, 'workspace', 'masks'),
    safeJoin: (base, relative) => {const target = path.resolve(base, relative); return target.startsWith(base + path.sep) ? target : null;},
    parseJson: async () => ({directory: path.relative(root, directory), seed}),
    send: (_, status, body) => {response = {status, body: JSON.parse(body)};}};
  vm.createContext(context);
  vm.runInContext(code, context);
  try {
    await context.selectResult({}, {});
    assert.equal(response.status, 200);
    let saved = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(saved.selectedSeed, 2);
    assert.deepEqual(saved.selectedMetrics, metrics);
    assert.equal(saved.selectedQualityScore, 45);
    assert.equal(saved.qualityGate.passed, false);
    assert.equal(saved.bodyAudit.passed, false);
    assert.equal(fs.readFileSync(path.join(directory, 'selected.png'), 'utf8'), 'second image');
    // A v2 candidate cannot inherit another candidate's passing decision, even
    // when its old scalar metrics would have passed the legacy gate.
    saved.qualityVersion=2;
    saved.results[0]={...saved.results[0],qualityScore:99,referenceSimilarity:.99,seamScore:99,anatomyScore:100,
      qualityGate:{version:2,passed:false,reasons:['color-material'],requiresVisualReview:true}};
    fs.writeFileSync(metadataPath,JSON.stringify(saved));
    await context.selectResult({},{});
    saved=JSON.parse(fs.readFileSync(metadataPath,'utf8'));
    assert.equal(saved.qualityGate.passed,false);
    assert.deepEqual(saved.qualityGate.reasons,['color-material']);
    delete saved.results[0].qualityGate;
    fs.writeFileSync(metadataPath,JSON.stringify(saved));
    await context.selectResult({},{});
    saved=JSON.parse(fs.readFileSync(metadataPath,'utf8'));
    assert.equal(saved.qualityGate.passed,false);
    assert.deepEqual(saved.qualityGate.reasons,['missing-candidate-assessment']);
    // Legacy runs have no candidate scores. A different selection must not inherit them.
    delete saved.results;
    fs.writeFileSync(metadataPath, JSON.stringify(saved));
    seed = 3;
    fs.writeFileSync(path.join(directory, 'result_seed_3.png'), 'legacy image');
    await context.selectResult({}, {});
    assert.equal(response.status, 200);
    saved = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(saved.selectedMetrics, null);
    assert.equal(saved.selectedQualityScore, null);
    assert.equal(saved.qualityGate.passed, null);
    seed = 404;
    await context.selectResult({}, {});
    assert.equal(response.status, 400);
    assert.equal(fs.readFileSync(path.join(directory, 'selected.png'), 'utf8'), 'legacy image');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
  console.log('OK: candidate selection updates metrics, supports retries and clears unknown legacy scores.');
})().catch(error => {console.error(error); process.exitCode = 1;});
