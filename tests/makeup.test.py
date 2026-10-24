import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import makeup as m


class MakeupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        (self.root/'app').mkdir();(self.root/'app/makeup-styles.json').write_bytes((ROOT/'app/makeup-styles.json').read_bytes())
        self.image=Image.open(ROOT/'samples/outpaint-benchmark/portrait-left/reference.png').convert('RGB')
        self.path=self.root/'source.png';self.image.save(self.path)
        self.points=np.array(json.loads((ROOT/'tests/fixtures/makeup-landmarks.json').read_text()),np.float32)
        self.events=[]
        self.env=dict(ROOT=self.root,OUTPUTS=self.root/'outputs',JOBS_DIR=self.root/'jobs',safe_sample=lambda _:self.path,
                      ensure_job_active=Mock(),update_job=lambda *a,**k:self.events.append(k),persist_job_request=Mock(),
                      makeup_landmarks=lambda *args:[self.points])
    def tearDown(self):self.temp.cleanup()
    def run_image(self,**extra):
        return m.run({**dict(sampleId='portrait.png',sourceSha256=hashlib.sha256(self.path.read_bytes()).hexdigest(),faceIndex=0,jobId='test'),**extra},self.env)
    def test_all_presets_defaults_and_smoothing_off(self):
        for style in m.styles(self.root):
            b=dict(faceIndex=0,style=style)
            if style=='custom':b.update(description='rose lips',plannedDescription='rose lips')
            result=m.options(b,self.root)
            self.assertEqual(result['skinSmooth'],0);self.assertTrue(result['preserveFeatures'])
    def test_each_preset_color_and_finish(self):
        masks,keep,_=m.region_masks(self.points,self.image.size)
        for style in m.styles(self.root):
            if style=='custom':continue
            settings=m.options(dict(faceIndex=0,style=style,renderer='color'),self.root)
            candidate=m.color_candidate(self.image,masks,settings,0)
            self.assertEqual(candidate.size,self.image.size)
            np.testing.assert_array_equal(np.asarray(candidate)[np.asarray(keep)>0],np.asarray(self.image)[np.asarray(keep)>0])
    def test_lip_finish_and_eyeliner_have_distinct_outputs(self):
        masks,_,_=m.region_masks(self.points,self.image.size)
        def render(**settings):return np.array(m.color_candidate(self.image,masks,m.options(dict(faceIndex=0,**settings),self.root),0))
        matte,satin,gloss=[render(parts=['lips'],finish=finish) for finish in ('matte','satin','gloss')]
        self.assertFalse(np.array_equal(matte,satin));self.assertFalse(np.array_equal(satin,gloss))
        no,thin,defined=[render(parts=['eyes'],eyeliner=line) for line in ('none','thin','defined')]
        self.assertFalse(np.array_equal(no,thin));self.assertFalse(np.array_equal(thin,defined))
    def test_invalid_input_rejected(self):
        for field,value in [('style','unknown'),('parts',[]),('parts',['nose']),('lip','red'),('faceIndex',True),('faceIndex',8),('intensity',[]),('preview','yes'),('skinSmooth',float('nan')),('seed',-1),('prompt','x '*60)]:
            with self.subTest(field=field),self.assertRaises(ValueError):self.run_image(**{field:value})
    def test_stale_description_rejected(self):
        with self.assertRaisesRegex(ValueError,'Đọc mô tả'):self.run_image(description='new',plannedDescription='old')
    def test_stale_source_rejected(self):
        with self.assertRaisesRegex(ValueError,'nguồn đã đổi'):m.run(dict(faceIndex=0,sampleId='portrait.png',sourceSha256='old'),self.env)
    def test_empty_face_rejected(self):
        self.env['makeup_landmarks']=lambda *a:[]
        with self.assertRaisesRegex(ValueError,'nhận diện'):m.analyze(dict(sampleId='source'),self.env)
    def test_regions_exclude_eyes_and_mouth(self):
        masks,keep,box=m.region_masks(self.points,self.image.size)
        for name in m.PARTS:self.assertFalse(np.any((np.asarray(masks[name])>0)&(np.asarray(keep)>0)))
        self.assertGreater(np.count_nonzero(masks['lips']),100)
    def test_exact_outside_protected_and_two_variants(self):
        protection=Image.new('L',self.image.size);ImageDraw.Draw(protection).rectangle((260,380,290,410),fill=255)
        before=self.path.read_bytes();report=self.run_image(style='peach',protectedDetailMask=m.encode(protection))
        folder=self.root/report['directory'];allowed=np.asarray(Image.open(folder/'applied_mask.png'))>0;original=np.asarray(self.image)
        self.assertEqual(len(report['results']),2)
        arrays=[]
        for item in report['results']:
            actual=np.asarray(Image.open(self.root/item['file']));arrays.append(actual)
            np.testing.assert_array_equal(actual[~allowed],original[~allowed]);self.assertTrue(np.any(actual[allowed]!=original[allowed]))
            np.testing.assert_array_equal(actual[np.asarray(protection)>0],original[np.asarray(protection)>0])
        self.assertFalse(np.array_equal(*arrays));self.assertEqual(before,self.path.read_bytes())
    def test_lips_only_preserves_every_other_region(self):
        report=self.run_image(parts=['lips'],preserveFeatures=False)
        masks,_,_=m.region_masks(self.points,self.image.size);outside=np.asarray(masks['lips'])==0
        actual=np.asarray(Image.open(self.root/report['results'][0]['file']))
        np.testing.assert_array_equal(actual[outside],np.asarray(self.image)[outside])
    def test_empty_manual_selection_rejected(self):
        with self.assertRaisesRegex(ValueError,'Không còn vùng'):self.run_image(limitSelection=True)
    def test_manual_selection_intersection(self):
        selected=Image.new('L',self.image.size);ImageDraw.Draw(selected).rectangle((260,380,285,405),fill=255)
        report=self.run_image(parts=['lips'],limitSelection=True,editableMask=m.encode(selected))
        actual=np.asarray(Image.open(self.root/report['results'][0]['file']))
        np.testing.assert_array_equal(actual[np.asarray(selected)==0],np.asarray(self.image)[np.asarray(selected)==0])
    def test_alpha_preserved(self):
        source=self.image.convert('RGBA');source.putalpha(Image.linear_gradient('L').resize(source.size));source.save(self.path)
        report=self.run_image();actual=np.asarray(Image.open(self.root/report['results'][0]['file']))
        np.testing.assert_array_equal(actual[:,:,3],np.asarray(source)[:,:,3])
    def test_preview_matches_full_and_full_masks_saved(self):
        full=self.run_image(style='classic');preview=self.run_image(style='classic',preview=True)
        for a,b in zip(full['results'],preview['results']):
            original=Image.open(self.root/a['file']).crop(b['crop'])
            np.testing.assert_array_equal(original,Image.open(self.root/b['file']))
        with Image.open(self.root/preview['directory']/'editable_mask.png') as saved:self.assertEqual(saved.size,self.image.size)
    def test_cancel_during_generation_never_publishes(self):
        def fake(*args):
            yield self.image
            raise ValueError('Đã hủy tác vụ')
        self.env['makeup_ai']=fake
        with self.assertRaisesRegex(ValueError,'hủy'):self.run_image(renderer='ai')
        self.assertFalse((self.root/'outputs').exists());self.assertEqual(list((self.root/'jobs').iterdir()),[])
    def test_ai_wrong_size_never_publishes(self):
        self.env['makeup_ai']=lambda *a:iter([self.image.resize((40,40))])
        with self.assertRaisesRegex(RuntimeError,'Kích thước'):self.run_image(renderer='ai')
        self.assertFalse((self.root/'outputs').exists())
    def test_faces_sorted_selection_and_unselected_untouched(self):
        other=self.points+np.array([400,0],np.float32)
        wider=Image.new('RGB',(1200,1024));wider.paste(self.image,(0,0));wider.save(self.path);self.image=wider
        self.env['makeup_landmarks']=lambda *a:[self.points,other]
        report=self.run_image(faceIndex=1,parts=['lips'])
        masks,_,_=m.region_masks(self.points,wider.size)
        actual=np.asarray(Image.open(self.root/report['results'][0]['file']))
        np.testing.assert_array_equal(actual[np.asarray(masks['lips'])>0],np.asarray(wider)[np.asarray(masks['lips'])>0])

if __name__=='__main__':unittest.main()
