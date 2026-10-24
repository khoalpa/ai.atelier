const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '../app/public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../app/public/app.js'), 'utf8');

for (const id of [
  'studioFocusStatus',
  'studioChooseResult',
  'studioSelectionSummary',
  'studioConfirmResult',
  'studioSendToReview',
]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must be unique`);
}

assert.match(html, /id="studioConfirmResult"[^>]*disabled/);
assert.match(html, /id="studioSendToReview"[^>]*disabled/);
assert.match(script, /studioPendingResult/);
assert.match(script, /studioSelectedResult='';studioPendingResult='';studioViewingResult=''/);
assert.match(script, /studioSendToReview'\)\.disabled=!confirmed/);
assert.match(script, /await selectPrimary\(Number\(item\.seed\),original\)/);
assert.match(script, /Đã tạo xong các phương án/);

console.log('OK: viewing, pending selection and confirmed result are distinct UI states.');
