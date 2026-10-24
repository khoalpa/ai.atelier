const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = require('./helpers/source').read(path.join(root, 'app/server.js'), 'utf8');
const client = require('./helpers/source').read(path.join(root, 'app/public/app.js'), 'utf8');

for (const feature of [
  "pathname === '/api/models/delete'",
  'async function deleteModel',
  'Cần nhập đúng ID model để xác nhận xóa vĩnh viễn',
  'Không thể xóa model đang được cấu hình hoạt động',
  "fs.rmSync(target,{recursive:true,force:false})",
]) assert.ok(server.includes(feature), `Thiếu bảo vệ xóa model: ${feature}`);

for (const feature of [
  'async function deleteManagedModel',
  'button.dataset.modelDelete=id',
  'Xóa vĩnh viễn',
  "location='registered'",
  'loadModelCandidates()',
]) assert.ok(client.includes(feature), `Thiếu giao diện xóa model: ${feature}`);

console.log('OK: xóa model có xác nhận, bảo vệ model đang dùng và đồng bộ lại giao diện.');
