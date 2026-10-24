'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cache = new Map();

function read(root) {
  const file = path.join(root, 'samples', 'catalog.json');
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file), signature = `${stat.mtimeMs}:${stat.size}`;
  if (cache.get(file)?.signature === signature) return cache.get(file).value;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 2 || !Array.isArray(value.assets)) throw Error('Danh mục ảnh mẫu không hợp lệ.');
  const aliases = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'aliases.json'), 'utf8')).aliases;
  const byId = new Map(value.assets.map(asset => [asset.id, asset]));
  const byPath = new Map(value.assets.filter(a => a.storage !== 'archive').map(a => [a.path, a]));
  const result = {...value, aliases, byId, byPath};
  cache.set(file, {signature, value: result});
  return result;
}

function contained(base, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes(':')) return null;
  const target = path.resolve(base, relative);
  const within = candidate => candidate.startsWith(base + path.sep);
  if (!within(target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  const realBase = fs.realpathSync(base), real = fs.realpathSync(target);
  return real.startsWith(realBase + path.sep) ? target : null;
}

function resolve(root, id) {
  const normalized = String(id || '').replace(/\\/g, '/');
  if (!normalized || normalized.split('/').some(p => p === '..' || p === '.') || normalized.startsWith('/')) return null;
  const catalog = read(root);
  if (catalog) {
    const asset = catalog.byId.get(catalog.aliases[normalized] || normalized) || catalog.byPath.get(normalized);
    if (asset) {
      const base = asset.storage === 'archive' ? path.join(root, 'workspace', 'sample-archive', 'v1') : path.join(root, 'samples');
      return contained(base, asset.path);
    }
    // A catalog is an allow-list. Masks and unrelated local files are not assets.
    return null;
  }
  return contained(path.join(root, 'samples'), normalized);
}

function images(root, role = 'demo') {
  const catalog = read(root);
  if (!catalog) return null;
  return catalog.assets.filter(asset => asset.roles.includes(role) && resolve(root, asset.id)).map(asset => ({
    id: asset.id, name: asset.label, group: asset.group, sourceType: 'sample',
    url: `/samples/${asset.id.split('/').map(encodeURIComponent).join('/')}`,
    thumbnailUrl: asset.thumbnail ? `/sample-thumbnails/${path.basename(asset.thumbnail)}` : undefined,
    creditsUrl: `/sample-credits#${(asset.sha256 || '').slice(0,16)}`,
    tasks: asset.tasks || [], synthetic: asset.provenance?.synthetic === true,
    sampleRole: role, license: asset.provenance?.license || 'unverified',
  }));
}

module.exports = {read, resolve, images};
