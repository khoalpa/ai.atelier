const assert=require('assert'),path=require('path');
const read=require('./helpers/source').read;
const html=read(path.join(__dirname,'../app/public/index.html'),'utf8');
const navigation=read(path.join(__dirname,'../app/public/app.js'),'utf8');
const workspace=read(path.join(__dirname,'../app/public/studio-workspace.js'),'utf8');
const guidance=read(path.join(__dirname,'../app/public/studio-guidance.js'),'utf8');

assert(html.includes('Sau khi xóa, bạn muốn thấy gì?'));
assert(html.includes('<option value="background" selected>Phục hồi nền</option>'));
assert(html.includes('Mô tả kết quả mong muốn <small>Không bắt buộc</small>'));
assert(navigation.includes('data-inpaint-quality="balanced" class="active"'));
assert(navigation.includes("quick.appendChild($('inpaintCount').closest('label'))"));
assert(navigation.includes("studioMode==='inpaint'?(inpaintCount===1?'Xóa vật thể':`Tạo ${inpaintCount} phương án`)"));
assert(workspace.includes("['Chọn vật thể','Tự động hoặc tô thủ công','aiTool']"));
assert(workspace.includes("byId('aiTool').textContent='Chọn tự động'"));
assert(workspace.includes("regionStatus.textContent='Vùng xóa được dùng trực tiếp khi tạo kết quả.'"));
assert(guidance.includes("preview.textContent='Kiểm tra vùng xóa'"));
console.log('OK: luồng Xóa vật thể ưu tiên chọn vùng, cách lấp, chất lượng và một CTA theo trạng thái.');
