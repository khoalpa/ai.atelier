const fs=require('fs');
const assert=require('assert');

const html=fs.readFileSync('apps/web/index.html','utf8');
const outpaint=fs.readFileSync('apps/web/features/outpaint.js','utf8');
const navigation=fs.readFileSync('apps/web/core/navigation.js','utf8');
const workspace=fs.readFileSync('apps/web/features/studio-workspace.js','utf8');
const css=fs.readFileSync('apps/web/styles/outpaint.css','utf8');

assert.match(html,/outpaintRatio[\s\S]*?<option>9:16<\/option>/,'vertical frame ratio is available');
assert.match(html,/Bạn muốn xuất hiện gì trong phần mở rộng\?/,'prompt is framed as optional content guidance');
assert.match(outpaint,/data-outpaint-direction="even"[\s\S]*?data-outpaint-direction="bottom"/,'direction shortcuts are present');
assert.match(outpaint,/data-outpaint-align="center"[\s\S]*?data-outpaint-align="reset"/,'placement shortcuts are present');
assert.match(outpaint,/data-outpaint-quality="fast"[\s\S]*?data-outpaint-quality="balanced"[\s\S]*?data-outpaint-quality="detail"/,'three quality choices are present');
assert.match(outpaint,/name="outpaintRunMode" value="layout" checked/,'layout-first is the default generation mode');
assert.match(outpaint,/outpaintRun'\)\.hidden=true/,'the duplicate local create button is hidden');
assert.match(navigation,/`Tạo \$\{outpaintCount\} bố cục`:'Tạo ảnh mở rộng'/,'primary action reflects outpaint mode');
assert.match(workspace,/\['Khung mới','Chọn tỷ lệ và vị trí','outpaintWidth'\][\s\S]*?\['Tạo và so sánh','Chọn bố cục phù hợp','studioPrimaryAction'\]/,'journey uses the proposed four-step flow');
assert.match(css,/\.outpaint-main-section/,'new controls have dedicated responsive styling');

console.log('OK: outpaint main flow, shortcuts, quality, mode and primary action.');
