const fs=require('fs');
const assert=require('assert');

const feature=fs.readFileSync('apps/web/features/character.js','utf8');
const navigation=fs.readFileSync('apps/web/core/navigation.js','utf8');
const workspace=fs.readFileSync('apps/web/features/studio-workspace.js','utf8');
const css=fs.readFileSync('apps/web/styles/character.css','utf8');

assert.match(workspace,/\['Khuôn mặt','Nhận diện và chọn người'[^\n]+\['Thay đổi','Nhanh, mô tả hoặc tham chiếu'[^\n]+\['Phạm vi & bảo toàn'[^\n]+\['Xem thử & áp dụng'/,'face journey follows the proposed five steps');
assert.match(feature,/data-character-source="quick"[\s\S]*data-character-source="description"[\s\S]*data-character-source="reference"/,'change sources are explicit branches');
assert.match(feature,/data-character-intensity="0\.35"[\s\S]*data-character-intensity="0\.6"[\s\S]*data-character-intensity="0\.9"/,'expression intensity is a direct three-button choice');
assert.match(feature,/if\(previewOnly\)\{request\.count=2/,'face preview produces two options');
assert.match(feature,/choose\.textContent='Chọn phương án này'/,'preview options can be selected');
assert.match(feature,/el\('characterSeed'\)\.value=item\.seed;previewReady=true/,'selected preview seed is retained for apply');
assert.match(feature,/run:\(\)=>[\s\S]*?run\(previewReady\?false:true,previewReady\)/,'shared action previews before applying the selected option');
assert.match(navigation,/\['character','body'\]\.includes\(studioMode\)\?window\.Character\.primaryLabel\(\)/,'command bar uses the contextual face action');
assert.match(css,/\.character-source-tabs/,'face source controls have dedicated styling');

console.log('OK: character face sources, scope, two-option preview and apply flow.');
