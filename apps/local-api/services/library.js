'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: MASKS_DIR, OUTPUTS_DIR, REFERENCES_DIR, ROOT, SAMPLES_DIR, UPLOADS_DIR, crypto, decodePngDataUrl, fs, manualStore, parseJson, path, readRemoved, safeJoin, send
module.exports = function createLibrary(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
function resolveSamplePath(sampleId) {
  const normalized = String(sampleId || '').replace(/\\/g, '/');
  if (normalized.startsWith('uploads/')) return deps.safeJoin(deps.UPLOADS_DIR, normalized.slice('uploads/'.length));
  return require('../packages/samples/catalog').resolve(deps.ROOT, normalized);
}

function listImages(dir, prefix = '') {
  if (!prefix && deps.path.resolve(dir) === deps.path.resolve(deps.SAMPLES_DIR)) {
    const selected = require('../packages/samples/catalog').images(deps.ROOT);
    if (selected) return selected;
  }
  if (!deps.fs.existsSync(dir)) return [];
  return deps.fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = deps.path.posix.join(prefix, entry.name);
    const full = deps.path.join(dir, entry.name);
    if (entry.isDirectory()) return listImages(full, rel);
    if (!/\.(png|jpe?g|webp)$/i.test(entry.name)) return [];
    return [{ id: rel, name: entry.name, group: prefix || 'root', sourceType: 'sample', url: `/samples/${rel}` }];
  });
}

function listUploadedImages() {
  return listImages(deps.UPLOADS_DIR).map((item) => ({
    ...item,
    id: `uploads/${item.id}`,
    group: 'Ảnh của bạn',
    sourceType: 'user',
    url: `/uploads/${item.id}`,
  }));
}

async function listOutputAssets() {
  return require('./output-assets').listOutputAssets(deps.OUTPUTS_DIR,Infinity);
}

async function allLibraryAssets(){
  const sources=[...listUploadedImages(),...listImages(deps.SAMPLES_DIR)].map(item=>{const file=resolveSamplePath(item.id);const stat=deps.fs.statSync(file);return {...item,createdAt:stat.mtime.toISOString(),sizeBytes:stat.size,task:'source'};});
  const sessions=(await deps.manualStore.list()).map(p=>({id:'project:'+p.id,name:p.name,url:p.thumbnail,createdAt:p.updatedAt,projectId:p.id,revision:p.revision,sourceId:p.sourceId,sourceType:'project',task:'manual',group:'Phiên chỉnh sửa'}));
  const removed=new Set(deps.readRemoved(deps.path.join(deps.ROOT,'workspace','library-removed.json')));
  return {removedCount:removed.size,assets:[...await listOutputAssets(),...listReferenceAssets(),...sources,...sessions].filter(item=>!removed.has(item.id))};
}

function listReferenceAssets(){return listImages(deps.REFERENCES_DIR).map((item)=>{const full=deps.safeJoin(deps.REFERENCES_DIR,item.id),stat=deps.fs.statSync(full);return{...item,id:`reference:${item.id}`,group:'Tham chiếu',sourceType:'reference',url:`/references/${item.id}`,createdAt:stat.mtime.toISOString(),sizeBytes:stat.size,task:'reference'};});}

async function uploadSourceImage(req, res) {
  try {
    const body = await deps.parseJson(req, 32 * 1024 * 1024);
    const match = String(body.data || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn 20 MB');
    const signatures = {
      'image/png': bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      'image/jpeg': bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      'image/webp': bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
    };
    if (!signatures[match[1]]) throw new Error('Nội dung tệp không khớp định dạng ảnh');
    const extensions = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
    const original = deps.path.basename(String(body.name || 'image')).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
    const filename = `${original}-${deps.crypto.randomBytes(6).toString('hex')}${extensions[match[1]]}`;
    deps.fs.mkdirSync(deps.UPLOADS_DIR, { recursive: true });
    deps.fs.writeFileSync(deps.path.join(deps.UPLOADS_DIR, filename), bytes, { flag: 'wx' });
    return deps.send(res, 201, JSON.stringify({ ok: true, image: { id:`uploads/${filename}`, name:String(body.name || filename), group:'Ảnh của bạn', sourceType:'user', url:`/uploads/${filename}` } }));
  } catch (error) {
    return deps.send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}

async function saveMask(req, res) {
  try {
    const body = await deps.parseJson(req);
    const sampleId = String(body.sampleId || '').replace(/\\/g, '/');
    const validSample = resolveSamplePath(sampleId);
    if (!validSample || !deps.fs.existsSync(validSample)) throw new Error('Ảnh mẫu không tồn tại');

    const stem = deps.path.basename(sampleId, deps.path.extname(sampleId)).replace(/[^a-zA-Z0-9_-]/g, '_');
    const group = deps.path.dirname(sampleId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runId = `${group}_${stem}_${stamp}`;
    const runDir = deps.safeJoin(deps.MASKS_DIR, runId);
    deps.fs.mkdirSync(runDir, { recursive: true });

    deps.fs.writeFileSync(deps.path.join(runDir, 'editable_mask.png'), deps.decodePngDataUrl(body.editableMask));
    deps.fs.writeFileSync(deps.path.join(runDir, 'protected_mask.png'), deps.decodePngDataUrl(body.protectedMask));
    const metadata = {
      schemaVersion: 1,
      runId,
      createdAt: new Date().toISOString(),
      source: sampleId,
      imageWidth: Number(body.imageWidth),
      imageHeight: Number(body.imageHeight),
      label: String(body.label || 'garment'),
      notes: String(body.notes || ''),
      brushSize: Number(body.brushSize || 0),
      editor: 'manual-mask-poc',
    };
    deps.fs.writeFileSync(deps.path.join(runDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, runId, directory: deps.path.relative(deps.ROOT, runDir) }));
  } catch (error) {
    deps.send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}

async function selectResult(req, res) {
  try {
    const body = await deps.parseJson(req, 1024 * 1024);
    const directory = deps.safeJoin(deps.ROOT, String(body.directory || ''));
    if (!directory || !directory.startsWith(deps.MASKS_DIR + deps.path.sep) && !directory.startsWith(deps.path.join(deps.ROOT, 'workspace', 'outputs') + deps.path.sep)) {
      throw new Error('Thư mục kết quả không hợp lệ');
    }
    const seed = Number(body.seed);
    if (!Number.isSafeInteger(seed)) throw new Error('Seed không hợp lệ');
    const metadataPath = deps.path.join(directory, 'metadata.json');
    const metadata = JSON.parse(deps.fs.readFileSync(metadataPath, 'utf8'));
    const candidate = (metadata.results || []).find(item => item.seed === seed);
    let source = deps.path.join(directory, `result_seed_${seed}.png`);
    if (candidate?.file) {
      const filename = deps.path.basename(String(candidate.file).replace(/\\/g, '/'));
      if (!new RegExp(`^(result|retry)_seed_${seed}\\.png$`).test(filename)) throw new Error('Tệp phương án không hợp lệ');
      source = deps.path.join(directory, filename);
    } else if (!deps.fs.existsSync(source)) {
      source = deps.path.join(directory, `retry_seed_${seed}.png`);
    }
    const target = deps.path.join(directory, 'selected.png');
    if (!deps.fs.existsSync(source)) throw new Error('Không tìm thấy phương án');
    if (candidate && Number.isFinite(candidate.qualityScore)) {
      const keys = ['qualityScore', 'rankingScore', 'referenceSimilarity', 'seamScore', 'anatomyScore', 'textureContinuity', 'preservationScore'];
      metadata.selectedMetrics = Object.fromEntries(keys.filter(key => Number.isFinite(candidate[key])).map(key => [key, candidate[key]]));
      for(const key of ['colorMaterial','geometry','poseConsistency','metricSemantics'])if(candidate[key]!==undefined)metadata.selectedMetrics[key]=candidate[key];
      metadata.selectedQualityScore = candidate.qualityScore;
      metadata.bodyAudit = candidate.bodyAudit || null;
      if (metadata.qualityGate) {
        const gate = metadata.qualityGate;
        if (metadata.qualityVersion===2) {
          metadata.qualityGate=candidate.qualityGate?.version===2?{...candidate.qualityGate,requiresVisualReview:true}:{...gate,passed:false,reasons:['missing-candidate-assessment'],requiresVisualReview:true};
        } else gate.passed = candidate.bodyAudit?.passed !== false &&
          candidate.qualityScore >= gate.minimumQuality && candidate.referenceSimilarity >= gate.minimumSimilarity &&
          candidate.seamScore >= gate.minimumSeam && candidate.anatomyScore >= gate.minimumAnatomy;
      }
    } else if (metadata.selectedSeed !== seed) {
      // Older runs did not persist per-candidate scores; never reuse another image's metrics.
      metadata.selectedMetrics = null;
      metadata.selectedQualityScore = null;
      metadata.bodyAudit = null;
      if (metadata.qualityGate) metadata.qualityGate.passed = null;
    }
    deps.fs.copyFileSync(source, target);
    metadata.selectedSeed = seed;
    metadata.selectedAt = new Date().toISOString();
    deps.fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, selected: deps.path.relative(deps.ROOT, target) }));
  } catch (error) {
    deps.send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}
return {get resolveSamplePath(){return resolveSamplePath;},set resolveSamplePath(value){resolveSamplePath=value;},
get listImages(){return listImages;},set listImages(value){listImages=value;},
get listUploadedImages(){return listUploadedImages;},set listUploadedImages(value){listUploadedImages=value;},
get listOutputAssets(){return listOutputAssets;},set listOutputAssets(value){listOutputAssets=value;},
get allLibraryAssets(){return allLibraryAssets;},set allLibraryAssets(value){allLibraryAssets=value;},
get listReferenceAssets(){return listReferenceAssets;},set listReferenceAssets(value){listReferenceAssets=value;},
get uploadSourceImage(){return uploadSourceImage;},set uploadSourceImage(value){uploadSourceImage=value;},
get saveMask(){return saveMask;},set saveMask(value){saveMask=value;},
get selectResult(){return selectResult;},set selectResult(value){selectResult=value;}};
};
