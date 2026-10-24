const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=require('./helpers/source').read('app/public/app.js','utf8');
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
const context={$:get,escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function promptAssistDiff('),source.indexOf('function renderPromptAssistFeedback(')),context);
const pairs=[['same','same'],['','new'],['old',''],['a red scarf.','a blue scarf.'],['Áo đỏ, giữ nền.','Áo xanh, giữ nền!'],['a  b','a b'],['<script>','<img>'],['a '.repeat(1100),'b '.repeat(1100)]];
for(const [a,b] of pairs){
  const chunks=context.promptAssistDiff(a,b);
  assert.equal(chunks.filter(x=>x.type!=='add').map(x=>x.text).join(''),a);
  assert.equal(chunks.filter(x=>x.type!=='remove').map(x=>x.text).join(''),b);
}
get('promptAssistOriginal').value='same';get('promptAssistDraft').value='same';context.renderPromptAssistDiff();assert(get('promptAssistDiffColumns').hidden);assert(get('promptAssistDiffStatus').textContent.includes('Không có thay đổi'));
get('promptAssistOriginal').value='old <script>';get('promptAssistDraft').value='new <img>';context.renderPromptAssistDiff();assert(!get('promptAssistDiffColumns').hidden);assert(get('promptAssistDiffOriginal').innerHTML.includes('<del>'));assert(get('promptAssistDiffDraft').innerHTML.includes('<ins>'));assert(!get('promptAssistDiffDraft').innerHTML.includes('<img>'));
console.log('OK: exact reconstruction, Vietnamese, whitespace, empty and identical drafts, large input, highlights and HTML escaping.');
