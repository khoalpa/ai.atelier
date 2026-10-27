const fs=require('fs');
const assert=require('assert');

const html=fs.readFileSync('apps/web/index.html','utf8');
const feature=fs.readFileSync('apps/web/features/image-enhancement.js','utf8');
const navigation=fs.readFileSync('apps/web/core/navigation.js','utf8');
const workspace=fs.readFileSync('apps/web/features/studio-workspace.js','utf8');
const css=fs.readFileSync('apps/web/styles/enhancement.css','utf8');

assert.match(workspace,/\['Mục tiêu','Chọn cách cải thiện'[\s\S]*?\['Phạm vi','Toàn ảnh hoặc vùng chọn'[\s\S]*?\['Xem thử','Kiểm tra trước và sau'[\s\S]*?\['Áp dụng & so sánh'/,'enhancement journey has five clear steps');
assert.match(feature,/data-enhance-method="light"[\s\S]*?data-enhance-method="skin-edge"/,'all enhancement goals are direct choices');
assert.match(feature,/data-enhance-level="light"[\s\S]*?data-enhance-level="balanced"[\s\S]*?data-enhance-level="strong"/,'level choices are direct buttons');
assert.match(feature,/data-enhance-scope="all"[\s\S]*?data-enhance-scope="selected"/,'scope choices are direct buttons');
assert.match(feature,/primaryRun:\(\)=>run\(!previewReady\)/,'primary action previews before applying');
assert.match(feature,/enhanceRun'\)\.classList\.remove\('primary'\)/,'apply-now remains a secondary action');
assert.match(navigation,/window\.ImageEnhancement\.primaryLabel\(\)/,'shared command bar uses contextual enhancement labels');
assert.match(html,/value="balanced" selected>Cân bằng/,'balanced is the default enhancement level');
assert.match(css,/\.enhance-choice-main/,'new enhancement controls have dedicated styling');

console.log('OK: enhancement goal, scope, preview-first and apply flow.');
