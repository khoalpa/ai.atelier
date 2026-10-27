const fs=require('fs');
const assert=require('assert');

const html=fs.readFileSync('apps/web/index.html','utf8');
const feature=fs.readFileSync('apps/web/features/makeup.js','utf8');
const navigation=fs.readFileSync('apps/web/core/navigation.js','utf8');
const workspace=fs.readFileSync('apps/web/features/studio-workspace.js','utf8');
const css=fs.readFileSync('apps/web/styles/makeup.css','utf8');

assert.match(workspace,/\['Khuôn mặt','Nhận diện và chọn người'[\s\S]*?\['Phong cách','Mẫu, mô tả hoặc tham chiếu'[\s\S]*?\['Vùng & mức độ'[\s\S]*?\['Xem thử & áp dụng'/,'makeup journey follows the proposed five steps');
assert.match(feature,/data-makeup-source="preset"[\s\S]*?data-makeup-source="description"[\s\S]*?data-makeup-source="reference"[\s\S]*?data-makeup-source="saved"/,'style sources are explicit branches');
assert.match(feature,/data-makeup-intensity="light"[\s\S]*?data-makeup-intensity="medium"[\s\S]*?data-makeup-intensity="bold"/,'intensity is a direct three-button choice');
assert.match(feature,/choose\.textContent='Chọn phương án này'/,'each preview can be selected');
assert.match(feature,/runSeed=item\.seed;previewReady=true/,'selected preview is retained for apply');
assert.match(feature,/run:\(\)=>run\(!previewReady\)/,'shared primary action previews before apply');
assert.match(navigation,/window\.Makeup\.primaryLabel\(\)/,'command bar uses contextual makeup action');
assert.match(navigation,/studioMode==='makeup'&&next\[0\]!=='Ảnh'\?next\[0\]==='Khuôn mặt'\?'Nhận diện khuôn mặt'/,'readiness action names the missing makeup step without replacing image selection');
assert.match(html,/value="medium" selected>Tự nhiên/,'natural intensity is the default');
assert.match(css,/\.makeup-main-section/,'main makeup sections have dedicated styling');

console.log('OK: makeup face, style sources, regions, preview selection and apply flow.');
