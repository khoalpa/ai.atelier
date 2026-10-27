const assert=require('node:assert/strict'),catalog=require('../app/prompt-store').readCatalog(),{compile,conflicts}=require('../packages/prompting/compiler');
const modelId='flux-chroma1-hd';
const locked='A blue shirt. Keep  its exact wording!';
const result=compile(catalog,{modelId,components:{subject:'Changed identity',materials:'linen',color:'linen'},locked:{subject:locked}});
assert(result.prompt.includes(locked));assert.equal(result.components.subject,locked);assert.equal(result.prompt.match(/linen/g).length,1);
assert(conflicts(catalog,'a full-body close-up').length);assert(!conflicts(catalog,'A nightstand at noon').length);
assert(conflicts(catalog,'a red jacket','red jacket').length);
const klein=compile(catalog,{modelId:'flux-2-klein-4b',components:{subject:'A product'},negativePrompt:'blur'});assert.equal(klein.negativePrompt,'');assert(klein.warnings.length);
assert.throws(()=>compile(catalog,{modelId,components:{subject:'x'.repeat(16001)}}));
assert.throws(()=>compile(catalog,{modelId,locked:{unknown:'x'}}));assert.throws(()=>compile(catalog,{modelId:'unknown'}));
const store=require('../app/prompt-store');for(const change of [c=>c.promptQuality.order.pop(),c=>c.promptQuality.models[modelId].maxSequenceLength=0,c=>c.promptQuality.assembly.silentTruncation=true]){const c=structuredClone(catalog);change(c);assert.throws(()=>store.validate(c));}
console.log('OK: exact locked text, duplicate blocks, word boundaries, contradictions, model policy and validation.');
const preview=require('../app/catalog-inspector').preview,changed=structuredClone(catalog);
changed.library.find(item=>item.id==='builtin-product').text='A revised product description';
assert.equal(preview(changed,'newImage.product').prompt,'A revised product description');
changed.tasks['newImage.product'].positive.libraryIds=['missing'];assert.throws(()=>store.validate(changed));
const missingPolicy=structuredClone(catalog);delete missingPolicy.promptQuality;assert.throws(()=>store.previewImport(missingPolicy));
