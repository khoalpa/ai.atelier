"""Behavioral tests without diffusion weights: exact text, budgets and saved sources."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import new_image as ni


class Tokenizer:
    model_max_length = 512
    def __call__(self, text, **kwargs):
        return {'input_ids': list(range(len(text.split())+2))}
    def apply_chat_template(self, messages, **kwargs):
        return 'user ' + messages[0]['content'] + ' assistant'


class NewImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.model = self.root/'model'; self.model.mkdir()
        self.set_model('ChromaPipeline')
        self.tokenizer = patch.object(ni, 'preview_tokenizer', return_value=Tokenizer()); self.tokenizer.start()
        self.events = []
        self.infer = Mock(side_effect=lambda pipe, **kwargs: SimpleNamespace(images=[Image.new('RGB',(kwargs['width'],kwargs['height']),'navy')]))
        self.env = dict(ROOT=self.root, OUTPUTS=self.root/'outputs', JOBS_DIR=self.root/'jobs', CHROMA_ROOT=self.model,
            device='cpu', torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:False),Generator=Mock()),
            update_job=lambda *a,**k:self.events.append(k),ensure_job_active=Mock(),text_to_image_model_path=lambda _:self.model,
            load_text_to_image_pipe=Mock(return_value=object()),traced_pipeline_call=self.infer,prompt_history=lambda:[],
            save_diffusion_preview=Mock(return_value=False),release_text_to_image=Mock(),configure_vae_memory=Mock())
    def tearDown(self):
        self.tokenizer.stop();self.temp.cleanup()
    def set_model(self, name):
        (self.model/'model_index.json').write_text(json.dumps({'_class_name':name}))
    def plan(self, **body):
        return ni.plan({'prompt':'blue shirt','negativePrompt':'',**body},self.model,'model')
    def run_image(self, **body):
        return ni.generate({'prompt':'blue shirt','negativePrompt':'','size':256,'count':1,'livePreview':False,**body},self.env)
    def test_exact_long_text_and_empty_negative(self):
        prompt='fine garment '*60+'RED SHOES'
        negative='unwanted defect '*40+'logo'
        result=self.run_image(prompt=prompt,negativePrompt=negative)
        self.assertEqual(self.infer.call_args.kwargs['prompt'],[prompt])
        self.assertEqual(self.infer.call_args.kwargs['negative_prompt'],[negative])
        self.run_image(negativePrompt='')
        self.assertEqual(self.infer.call_args.kwargs['negative_prompt'],[''])
        self.assertGreater(len(result['prompt']),600)
    def test_clip_text_models_are_permanently_blocked_before_model_load(self):
        self.set_model('StableDiffusion3Pipeline')
        with self.assertRaisesRegex(ValueError,'CLIP.*loại vĩnh viễn'):
            self.run_image(prompt='word '*100)
        self.env['load_text_to_image_pipe'].assert_not_called()
    def test_framing_is_explicit_traced_and_not_duplicated_on_refine(self):
        self.set_model('Flux2KleinPipeline')
        original='Two adults, red jacket on the left, blue shirt on the right.'
        result=self.run_image(prompt=original,framing='full-body-hands')
        self.assertEqual(self.infer.call_args.kwargs['prompt'],[ni.FRAMING['full-body-hands']+original])
        item=result['results'][0]
        saved=json.loads((self.root/'outputs/chroma'/item['source']).with_suffix('.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['request']['prompt'],original)
        self.assertEqual(saved['settings']['framing'],'full-body-hands')
        again=ni.plan(saved['request'],self.model,'model')
        self.assertEqual(again['inputs']['prompt'],[ni.FRAMING['full-body-hands']+original])
        with self.assertRaises(ValueError):self.plan(framing='invalid')
    def test_legacy_clip_fields_do_not_change_t5_prompt(self):
        full='word '*100
        result=self.plan(prompt=full,clipPrompt='ignored legacy value',clipNegativePrompt='ignored')
        self.assertTrue(result['valid']);self.assertEqual(result['inputs']['prompt'],[full])
    def test_klein_controls_and_wrapper_budget(self):
        self.set_model('Flux2KleinPipeline')
        result=self.run_image(steps=45,guidance=7,negativePrompt='blur')
        self.assertFalse(result['negativePromptApplied'])
        self.assertNotIn('negative_prompt',self.infer.call_args.kwargs)
        self.assertEqual(result['steps'],4);self.assertEqual(result['guidance'],1)
        self.assertFalse(self.plan(prompt='word '*510)['valid'])
    def test_dimensions_and_no_silent_downgrade(self):
        self.assertEqual(self.plan(size=1024)['settings']['width'],1024)
        for ratio in ('1:1','4:5','2:3','3:2','16:9','9:16'):
            p=self.plan(size=1024,aspectRatio=ratio)['settings']
            self.assertEqual(p['width']%16,0);self.assertLessEqual(p['width']*p['height'],ni.MAX_PIXELS)
        for body in ({'size':2048},{'width':1025,'height':768},{'width':1536,'height':1536},{'steps':3},{'seed':-1},{'guidance':float('nan')},{'prompt':None}):
            with self.subTest(body=body),self.assertRaises(ValueError):self.plan(**body)
    def test_source_finishing_uses_saved_pixels_and_metadata(self):
        result=self.run_image(seed=42);item=result['results'][0];source=self.root/'outputs/chroma'/item['source']
        original=source.read_bytes()
        finished=ni.generate({'runMode':'refine','source':item['source'],'sourceSha':item['sha256'],'method':'upscale'},self.env)
        self.assertEqual(finished['width'],512);self.assertEqual(finished['height'],512)
        self.assertEqual(source.read_bytes(),original)
        self.assertEqual(self.infer.call_count,1)
        saved=json.loads((self.root/'outputs/chroma'/finished['results'][0]['source']).with_suffix('.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['parent']['sha256'],item['sha256']);self.assertEqual(saved['seed'],42)
    def test_tampering_and_traversal_rejected(self):
        item=self.run_image()['results'][0]
        for name,digest in (('../source.png',item['sha256']),(item['source'],'wrong'),('C:\\source.png',item['sha256'])):
            with self.assertRaises(ValueError):ni.source_result(self.env['OUTPUTS'],name,digest)
        path=self.env['OUTPUTS']/'chroma'/item['source'];path.write_bytes(b'changed')
        with self.assertRaises(ValueError):ni.source_result(self.env['OUTPUTS'],item['source'],item['sha256'])
    def test_partial_results_survive_cancellation(self):
        def stop(job):
            if any('_result' in event for event in self.events):raise RuntimeError('cancelled')
        self.env['ensure_job_active']=stop
        with self.assertRaisesRegex(RuntimeError,'cancelled'):self.run_image(count=2)
        self.assertEqual(len(list((self.env['OUTPUTS']/'chroma').glob('*.png'))),1)
        self.assertEqual(sum('_result' in event for event in self.events),1)
    def test_unique_default_seeds_and_timing(self):
        with patch.object(ni.secrets,'randbelow',side_effect=[7,8]):
            self.assertEqual(self.plan()['settings']['seed'],7);self.assertEqual(self.plan()['settings']['seed'],8)
        result=self.run_image(seed=ni.MAX_SEED,count=2)
        self.assertEqual([x['seed'] for x in result['results']],[ni.MAX_SEED,0])
        self.assertGreaterEqual(result['totalSeconds'],result['inferenceSeconds'])
        self.assertTrue((self.root/result['report']).is_file())


if __name__=='__main__':unittest.main()
