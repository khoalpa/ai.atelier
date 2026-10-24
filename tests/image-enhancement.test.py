"""Behavioral protection, validation, preview and cancellation tests; no model required."""
import base64
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import image_enhancement as ie


def encoded(image):
    stream=io.BytesIO();image.save(stream,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()


class EnhancementTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'source.png'
        rng=np.random.default_rng(12)
        self.array=rng.integers(25,230,(96,128,3),dtype=np.uint8)
        Image.fromarray(self.array).save(self.source)
        self.events=[]
        self.ai=Mock(side_effect=lambda source,*_:source.resize((source.width*2,source.height*2)).filter(__import__('PIL.ImageFilter',fromlist=['ImageFilter']).GaussianBlur(.7)))
        self.env=dict(ROOT=self.root,OUTPUTS=self.root/'outputs',JOBS_DIR=self.root/'jobs',
            safe_sample=lambda _:self.source,ensure_job_active=Mock(),persist_job_request=Mock(),
            update_job=lambda *a,**k:self.events.append(k),enhancement_ai=self.ai,
            release_inpaint=Mock(),release_tryon=Mock(),release_text_to_image=Mock())
    def tearDown(self):self.temp.cleanup()
    def run_image(self,**body):return ie.enhance(dict(sampleId='sample.png',jobId='test',**body),self.env)
    def result(self,report):return np.asarray(Image.open(self.root/report['results'][0]['file']))
    def mask(self):
        mask=Image.new('L',(128,96));ImageDraw.Draw(mask).rectangle((20,15,105,80),fill=255);return mask
    def test_protected_and_outside_pixels_exact(self):
        selected=self.mask();protect=Image.new('L',selected.size)
        ImageDraw.Draw(protect).rectangle((45,20,65,50),fill=255)
        old=self.source.read_bytes()
        r=self.run_image(scope='selected',editableMask=encoded(selected),protectedDetailMask=encoded(protect),level='strong')
        result=self.result(r);outside=(np.asarray(selected)==0)|(np.asarray(protect)>0)
        np.testing.assert_array_equal(result[outside],self.array[outside])
        self.assertGreater(np.count_nonzero(result!=self.array),0)
        self.assertEqual(self.source.read_bytes(),old)
        self.assertEqual(r['metrics']['outsideMaskMaxError'],0)
        self.ai.assert_not_called()
    def test_ai_protection_uses_resampled_source(self):
        protect=self.mask()
        r=self.run_image(method='ai2x',protectedDetailMask=encoded(protect))
        result=self.result(r)
        self.assertEqual(result.shape,(192,256,3))
        baseline=np.asarray(Image.open(self.root/r['directory']/'comparison.png'))
        keep=np.asarray(protect.resize((256,192),Image.Resampling.NEAREST))>0
        np.testing.assert_array_equal(result[keep],baseline[keep])
        self.assertEqual(r['metrics']['preservationReference'],'lanczos-2x')
    def test_alpha_preserved(self):
        rgba=Image.fromarray(self.array).convert('RGBA');alpha=Image.linear_gradient('L').resize(rgba.size);rgba.putalpha(alpha);rgba.save(self.source)
        for method in ('light','ai2x'):
            result=self.result(self.run_image(method=method))
            np.testing.assert_array_equal(result[:,:,3],np.asarray(alpha.resize((result.shape[1],result.shape[0]),Image.Resampling.LANCZOS)))
    def test_reject_invalid_options(self):
        for body in ({'method':'x4'},{'profile':[]},{'level':3},{'scope':'none'},{'preview':'yes'},{'previewX':float('nan')},{'previewY':-1}):
            with self.subTest(body=body),self.assertRaises(ValueError):self.run_image(**body)
        self.ai.assert_not_called()
    def test_missing_or_mismatched_selection(self):
        for body in ({'scope':'selected'},{'protectedDetailMask':encoded(Image.new('L',(128,96),255))},
                     {'scope':'selected','editableMask':encoded(Image.new('L',(20,20),255))},
                     {'protectedDetailMask':'bad'}):
            with self.subTest(body=body),self.assertRaises(ValueError):self.run_image(**body)
        self.assertFalse(self.env['OUTPUTS'].exists())
    def test_budget_checked_before_model(self):
        with patch.object(ie,'MAX_PIXELS',128*96*2):
            with self.assertRaisesRegex(ValueError,'đầu ra'):self.run_image(method='ai2x')
        self.ai.assert_not_called();self.env['release_inpaint'].assert_not_called()
    def test_preview_crop_and_metadata(self):
        Image.new('RGB',(701,503),'gray').save(self.source)
        r=self.run_image(preview=True,previewX=100,previewY=100,method='ai2x')
        self.assertEqual((r['width'],r['height']),(512,512))
        self.assertEqual(r['results'][0]['crop'],(445,247,701,503))
        self.assertTrue(r['previewOnly']);self.assertTrue(r['enhancementApplied'])
        saved=json.loads((self.root/r['directory']/'metadata.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['sourceSha256'],hashlib.sha256(self.source.read_bytes()).hexdigest())
    def test_exif_orientation(self):
        image=Image.fromarray(self.array);exif=Image.Exif();exif[274]=6
        self.source=self.root/'rotated.jpg';image.save(self.source,exif=exif)
        r=self.run_image();self.assertEqual((r['width'],r['height']),(96,128))
    def test_cancel_before_processing(self):
        self.env['ensure_job_active'].side_effect=RuntimeError('Đã hủy')
        with self.assertRaisesRegex(RuntimeError,'hủy'):self.run_image()
        self.assertFalse(self.env['OUTPUTS'].exists())
    def test_cancel_while_saving_not_published(self):
        def active(*_):
            if list(self.env['JOBS_DIR'].glob('enhance-*/metadata.json')):raise RuntimeError('Đã hủy')
        self.env['ensure_job_active'].side_effect=active
        with self.assertRaisesRegex(RuntimeError,'hủy'):self.run_image()
        self.assertFalse(self.env['OUTPUTS'].exists())
        self.assertFalse(any(e.get('status')=='completed' for e in self.events))
    def test_wrong_inference_dimensions_not_published(self):
        self.ai.side_effect=lambda source,*_:source
        with self.assertRaisesRegex(RuntimeError,'Kích thước'):self.run_image(method='ai2x')
        self.assertFalse(self.env['OUTPUTS'].exists())
    def test_tiles_cover_edges_and_odd_dimensions(self):
        for width,height in [(1,1),(255,257),(1024,581),(226,230)]:
            covered=np.zeros((height,width),np.uint8)
            for x0,y0,x1,y1 in ie.tile_boxes(width,height):covered[y0:y1,x0:x1]=1
            self.assertTrue(covered.all())
    def test_profiles_limit_changes_and_no_new_clipping(self):
        for profile in ie.PROFILES:
            r=self.run_image(profile=profile,level='strong')
            result=self.result(r)
            self.assertTrue(((result>0)&(result<255)).all())
            self.assertLessEqual(np.abs(result.astype(int)-self.array).max(),16)
    def test_auto_quality_does_not_reprocess_enhancement(self):
        import quality_learning
        self.assertNotIn('enhance',quality_learning.TASKS)


if __name__=='__main__':unittest.main()
