import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import makeup as m
import makeup_reference as reference


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        (self.root/'app').mkdir();(self.root/'app/makeup-styles.json').write_bytes((ROOT/'app/makeup-styles.json').read_bytes())
        self.source=Image.open(__import__('sample_catalog').resolve_sample(ROOT, 'outpaint-benchmark/portrait-left/reference.png')).convert('RGB')
        self.points=np.array(json.loads((ROOT/'tests/fixtures/makeup-landmarks.json').read_text()),np.float32)
        self.path=self.root/'reference.png';self.source.save(self.path)
        self.env=dict(ROOT=self.root,safe_sample=lambda _:self.path,makeup_landmarks=lambda *args:[self.points],
                      OUTPUTS=self.root/'outputs',JOBS_DIR=self.root/'jobs',update_job=Mock(),ensure_job_active=Mock(),persist_job_request=Mock())
    def tearDown(self):self.tmp.cleanup()
    def test_explicit_face_and_hash_required(self):
        listing=reference.analyze(dict(sampleId='ref'),self.env)
        self.assertNotIn('plan',listing);self.assertEqual(len(listing['faces']),1)
        self.assertNotIn('regions',listing['faces'][0])
        for index in [True,-1,8,'0']:
            with self.assertRaises(ValueError):reference.analyze(dict(sampleId='ref',faceIndex=index,sourceSha256=listing['sourceSha256']),self.env)
        with self.assertRaisesRegex(ValueError,'đã đổi'):reference.analyze(dict(sampleId='ref',faceIndex=0,sourceSha256='old'),self.env)
    def test_no_face_clear_error(self):
        self.env['makeup_landmarks']=lambda *a:[]
        with self.assertRaisesRegex(ValueError,'tham chiếu'):reference.analyze(dict(sampleId='ref'),self.env)
    def test_palette_and_no_geometry_in_plan(self):
        masks,_,_=m.region_masks(self.points,self.source.size)
        pixels=np.array(self.source);pixels[np.asarray(masks['lips'])>0]=(175,35,65)
        self.source=Image.fromarray(pixels);self.source.save(self.path);before=self.path.read_bytes()
        result=reference.analyze(dict(sampleId='ref',faceIndex=0,sourceSha256=hashlib.sha256(before).hexdigest()),self.env)
        self.assertEqual(result['plan']['lip'],'#af2341');self.assertEqual(set(result['plan']['parts']),{'lips','eyes','brows','cheeks'})
        self.assertNotIn('base',result['plan']['parts']);self.assertEqual(result['plan']['skinSmooth'],0)
        for key in ['faceIndex','box','faceBox','editableMask','sampleId','sourceSha256']:self.assertNotIn(key,result['plan'])
        self.assertEqual(self.path.read_bytes(),before);self.assertTrue(result['warnings'])
    def test_varied_complexion_lighting_and_rotation(self):
        matrix=cv2.getRotationMatrix2D((self.source.width/2,self.source.height/2),12,1)
        for gain,shift in [(.6,(0,0,0)),(1.05,(9,-6,-9)),(.9,(-5,0,12))]:
            rgb=np.clip(np.asarray(self.source)*gain+np.array(shift),0,255).astype(np.uint8)
            image=Image.fromarray(cv2.warpAffine(rgb,matrix,self.source.size,borderMode=cv2.BORDER_REFLECT))
            points=self.points@matrix[:,:2].T+matrix[:,2]
            plan,metrics,warnings,_=reference.extract(image,points,self.root)
            settings=m.options({**plan,'faceIndex':0},self.root)
            self.assertEqual(settings['renderer'],'color');self.assertEqual(len(metrics),4);self.assertTrue(warnings)
    def test_two_faces_choose_only_requested_palette(self):
        pixels=np.array(self.source);masks,_,_=m.region_masks(self.points,self.source.size)
        left=pixels.copy();right=pixels.copy();left[np.asarray(masks['lips'])>0]=(180,30,60);right[np.asarray(masks['lips'])>0]=(80,35,140)
        Image.fromarray(np.concatenate([left,right],axis=1)).save(self.path)
        self.env['makeup_landmarks']=lambda *a:[self.points,self.points+np.array([self.source.width,0])]
        listing=reference.analyze(dict(sampleId='ref'),self.env);self.assertEqual(len(listing['faces']),2)
        plans=[reference.analyze(dict(sampleId='ref',faceIndex=i,sourceSha256=listing['sourceSha256']),self.env)['plan'] for i in [0,1]]
        self.assertEqual(plans[0]['lip'],'#b41e3c');self.assertEqual(plans[1]['lip'],'#50238c')
    def test_strength_zero_and_protection_exact(self):
        protection=Image.new('L',self.source.size);ImageDraw.Draw(protection).rectangle((270,380,290,405),fill=255)
        settings=dict(style='classic',faceIndex=0,parts=['lips','eyes','brows'],strengths={'eyes':0,'lips':65},brow='#24171d')
        report=m.run(dict(**settings,sampleId='target',sourceSha256=hashlib.sha256(self.path.read_bytes()).hexdigest(),protectedDetailMask=m.encode(protection)),self.env)
        folder=self.root/report['directory'];mask=np.array(Image.open(folder/'applied_mask.png'))>0
        masks,_,_=m.region_masks(self.points,self.source.size)
        for item in report['results']:
            out=np.array(Image.open(self.root/item['file']));original=np.array(self.source)
            np.testing.assert_array_equal(out[~mask],original[~mask]);np.testing.assert_array_equal(out[np.asarray(masks['eyes'])>0],original[np.asarray(masks['eyes'])>0])
            np.testing.assert_array_equal(out[np.asarray(protection)>0],original[np.asarray(protection)>0])
    def test_strength_and_brow_validation(self):
        for value in [{'eyes':True},{'eyes':-1},{'eyes':101},{'eyes':float('nan')},{'nose':40},[],None]:
            with self.assertRaises(ValueError):m.options(dict(faceIndex=0,strengths=value),self.root)
        with self.assertRaises(ValueError):m.options(dict(faceIndex=0,brow='blue'),self.root)
        with self.assertRaises(ValueError):m.options(dict(faceIndex=0,parts=['lips'],strengths={'lips':0}),self.root)
    def test_lower_strength_reduces_change(self):
        masks,_,_=m.region_masks(self.points,self.source.size);source=np.asarray(self.source).astype(float)
        diffs=[]
        for strength in [0,40,100]:
            settings=m.options(dict(faceIndex=0,parts=['lips','brows'],strengths={'lips':strength,'brows':0}),self.root) if strength else {**m.options(dict(faceIndex=0),self.root),'parts':['lips'],'strengths':{'lips':0}}
            diffs.append(np.abs(np.array(m.color_candidate(self.source,masks,settings,0)).astype(float)-source).sum())
        self.assertEqual(diffs[0],0);self.assertLess(diffs[1],diffs[2])
    def test_ai_strength_blends_and_zero_region_remains_exact(self):
        self.env['makeup_ai']=lambda *args:iter([Image.new('RGB',self.source.size,'white') for _ in range(2)])
        report=m.run(dict(style='artistic',faceIndex=0,parts=['lips','eyes'],strengths={'lips':40,'eyes':0},preserveFeatures=False,
                          sampleId='target',sourceSha256=hashlib.sha256(self.path.read_bytes()).hexdigest()),self.env)
        masks,_,_=m.region_masks(self.points,self.source.size);before=np.asarray(self.source)
        output=np.asarray(Image.open(self.root/report['results'][0]['file']))
        np.testing.assert_array_equal(output[np.asarray(masks['eyes'])>0],before[np.asarray(masks['eyes'])>0])
        selected=np.asarray(masks['lips'])>0
        self.assertTrue(np.any(output[selected]!=before[selected]));self.assertTrue(np.all(output[selected]<=np.rint(before[selected]*.6+255*.4)+1))


if __name__=='__main__':unittest.main()
