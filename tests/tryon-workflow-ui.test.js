const fs=require('fs');
const assert=require('assert');

const html=require('./helpers/web-html')();
const navigation=fs.readFileSync('apps/web/core/navigation.js','utf8');
const workflow=fs.readFileSync('apps/web/features/outfit-workflow.js','utf8');
const workspace=fs.readFileSync('apps/web/features/studio-workspace.js','utf8');
const css=fs.readFileSync('apps/web/styles/views/application.css','utf8');

assert.match(navigation,/data-tryon-input-mode="reference">Dùng ảnh mẫu/,'reference mode is a direct choice');
assert.match(navigation,/data-tryon-input-mode="description">Mô tả trang phục/,'description mode is a direct choice');
assert.match(workspace,/\['Trang phục mới',[\s\S]*?\['Người & vùng thay',[\s\S]*?\['Chất lượng',[\s\S]*?\['Tạo và so sánh'/,'journey follows garment-before-region order');
assert.match(navigation,/data-tryon-quality="fast"[\s\S]*?data-tryon-quality="balanced"[\s\S]*?data-tryon-quality="quality"/,'quality has three direct choices');
assert.match(navigation,/qualityPreset" hidden>[\s\S]*?value="balanced" selected/,'balanced is the visible workflow default');
assert.match(navigation,/`Tạo \$\{tryonCount\} phương án`/,'primary action reflects variant count');
assert.match(html,/id="autoMaskButton">Tạo vùng tự động/,'automatic region action uses user-facing language');
assert.match(html,/Chi tiết cần giữ <small>Không bắt buộc<\/small>/,'reference details are explicitly optional');
assert.match(html,/Bạn muốn nhân vật mặc gì\?/,'description mode asks one direct question');
assert.match(workflow,/data-tryon-input-mode/,'mode buttons stay synchronized with the underlying workflow');
assert.match(css,/\.tryon-method-main/,'try-on workflow controls have dedicated styling');

console.log('OK: try-on garment, region, quality and create flow.');
