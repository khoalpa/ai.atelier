const fs=require('fs');
const assert=require('assert');

const feature=fs.readFileSync('apps/web/features/character.js','utf8');
const extra=fs.readFileSync('apps/web/features/character-extra.js','utf8');
const anatomy=fs.readFileSync('apps/web/features/anatomy-inpaint.js','utf8');
const navigation=fs.readFileSync('apps/web/core/navigation.js','utf8');
const workspace=fs.readFileSync('apps/web/features/studio-workspace.js','utf8');
const css=fs.readFileSync('apps/web/styles/character.css','utf8');

assert.match(workspace,/\['Nhân vật','Nhận diện và chọn người'[^\n]+\['Thay đổi cơ thể','Tư thế, bộ phận hoặc tương tác'[^\n]+\['Phạm vi & bảo toàn'[^\n]+\['Xem thử & áp dụng'/,'body journey follows the proposed five steps');
assert.match(feature,/data-body-change="pose"[\s\S]*data-body-change="anatomy"[\s\S]*data-body-change="interaction"/,'body change types are explicit');
assert.match(feature,/Mẫu có sẵn[\s\S]*Mô tả riêng[\s\S]*Ảnh tham chiếu[\s\S]*Chỉnh khung xương/,'pose sources are explicit branches');
assert.match(feature,/bodyScope\.append\(keepFace\)/,'face preservation is in the body scope step');
assert.match(extra,/className='expert-only body-secondary'/,'per-person, hand and batch tools are secondary expert workflows');
assert.match(anatomy,/primaryAction=\(\)=>ready\(\)\?run\(\):preview\(\)/,'anatomy branch uses one contextual primary action');
assert.match(navigation,/\['character','body'\]\.includes\(studioMode\)\?window\.Character\.primaryLabel\(\)/,'body command bar uses the contextual primary action');
assert.match(css,/\.body-change-types/,'body change controls have dedicated styling');

console.log('OK: body change types, pose sources, preservation and contextual action flow.');
