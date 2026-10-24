"""Measured edge behavior, selection boundaries, hints, preview and cancellation."""
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
import image_enhancement as enhancement
import skin_edge


def encode(image):
    buffer=io.BytesIO();image.save(buffer,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()


class EdgeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.path=self.root/'source.png'
        self.fg=np.array([202,151,125]);self.bg=np.array([90,141,175])
        self.x=np.arange(320);matte=1/(1+np.exp((self.x-159.5)/6))
        self.rgb=np.tile(np.rint(matte[:,None]*self.fg+(1-matte[:,None])*self.bg).astype(np.uint8),(240,1,1))
        Image.fromarray(self.rgb).save(self.path)
        self.mask=Image.new('L',(320,240));ImageDraw.Draw(self.mask).rectangle((110,20,210,219),fill=255)
        self.events=[]
        self.env=dict(ROOT=self.root,OUTPUTS=self.root/'outputs',JOBS_DIR=self.root/'jobs',safe_sample=lambda _:self.path,
            update_job=lambda *a,**kw:self.events.append(kw),ensure_job_active=Mock(),persist_job_request=Mock())
    def tearDown(self):self.temp.cleanup()
    def run_image(self,**extra):
        body=dict(sampleId='source.png',jobId='edge-test',method='skin-edge',scope='all',
            editableMask=encode(self.mask),edgeWidth=32,level='strong',edgeSoftness=20,edgeDecontam=0,
            edgeSkinPoint={'x':70,'y':100},edgeBackgroundPoint={'x':250,'y':100})
        body.update(extra);return enhancement.enhance(body,self.env)
    def result(self,report):return np.array(Image.open(self.root/report['results'][0]['file']))
    def alpha(self,rgb):return ((rgb-self.bg)*(self.fg-self.bg)).sum(axis=-1)/((self.fg-self.bg)**2).sum()
    def test_transition_narrows_without_moving_midpoint_or_halos(self):
        original_hash=hashlib.sha256(self.path.read_bytes()).hexdigest()
        report=self.run_image();result=self.result(report)
        before=self.alpha(self.rgb[100].astype(float));after=self.alpha(result[100].astype(float))
        width=lambda a:int(((a>.1)&(a<.9)).sum())
        self.assertLess(width(after),width(before)*.85)
        self.assertEqual(np.argmax(after<.5),np.argmax(before<.5))
        self.assertLessEqual(float(np.diff(after).max()),.015)
        self.assertTrue((result>=np.minimum(self.fg,self.bg)).all())
        self.assertTrue((result<=np.maximum(self.fg,self.bg)).all())
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),original_hash)
        self.assertFalse(report['metrics']['geometryResampled'])
    def test_outside_paint_band_and_protected_pixels_exact(self):
        protect=Image.new('L',self.mask.size);ImageDraw.Draw(protect).rectangle((140,70,180,110),fill=255)
        report=self.run_image(protectedDetailMask=encode(protect));result=self.result(report)
        band=np.array(Image.open(self.root/report['results'][0]['edgeBandFile']))>0
        keep=(np.array(self.mask)==0)|(np.array(protect)>0)|~band
        np.testing.assert_array_equal(result[keep],self.rgb[keep])
        self.assertEqual(report['metrics']['outsideMaskMaxError'],0)
    def test_alpha_preserved(self):
        image=Image.fromarray(self.rgb).convert('RGBA');alpha=Image.linear_gradient('L').resize(image.size)
        image.putalpha(alpha);image.save(self.path)
        np.testing.assert_array_equal(self.result(self.run_image())[:,:,3],np.array(alpha))
    def test_softness_and_level_have_measurable_effect(self):
        strong=self.result(self.run_image(edgeSoftness=0));soft=self.result(self.run_image(edgeSoftness=100))
        light=self.result(self.run_image(level='light',edgeSoftness=0))
        change=lambda image:np.abs(image.astype(float)-self.rgb).mean()
        self.assertGreater(change(strong),change(soft)*1.3)
        self.assertGreater(change(strong),change(light)*1.4)
    def test_spill_setting_targets_skin_side(self):
        plain=self.result(self.run_image(edgeDecontam=0));clean=self.result(self.run_image(edgeDecontam=100))
        self.assertTrue(np.any(plain[:,:150]!=clean[:,:150]))
        np.testing.assert_array_equal(plain[:,165:],clean[:,165:])
    def test_automatic_and_manual_work_for_different_skin_colors(self):
        auto=self.run_image(edgeSkinPoint=None,edgeBackgroundPoint=None)
        self.assertEqual(auto['metrics']['edgeRegions'][0]['sideSource'],'automatic-color')
        for fg,bg in [([70,45,30],[180,150,110]),([235,206,185],[35,60,80]),([125,80,60],[115,145,195])]:
            matte=1/(1+np.exp((self.x-159.5)/6))
            self.rgb=np.tile(np.rint(matte[:,None]*fg+(1-matte[:,None])*bg).astype(np.uint8),(240,1,1))
            Image.fromarray(self.rgb).save(self.path)
            result=self.result(self.run_image());self.assertTrue(np.any(result!=self.rgb))
            np.testing.assert_array_equal(result[:,10:80],self.rgb[:,10:80])
    def test_selection_required_even_if_scope_all(self):
        for mask in ('',encode(Image.new('L',self.mask.size))):
            with self.assertRaises(ValueError):self.run_image(editableMask=mask)
        self.assertFalse(self.env['OUTPUTS'].exists())
    def test_no_boundary_and_flat_color_rejected(self):
        interior=Image.new('L',self.mask.size);ImageDraw.Draw(interior).rectangle((5,10,35,230),fill=255)
        with self.assertRaises(ValueError):self.run_image(editableMask=encode(interior))
        Image.new('RGB',self.mask.size,(125,125,125)).save(self.path)
        with self.assertRaises(ValueError):self.run_image(edgeSkinPoint=None,edgeBackgroundPoint=None)
    def test_invalid_parameters_and_points_rejected(self):
        for extra in ({'edgeWidth':2},{'edgeWidth':49},{'edgeSoftness':float('nan')},{'edgeDecontam':True},
                      {'edgeKeepShape':False},{'edgeSkinPoint':{'x':-1,'y':3}}, {'edgeBackgroundPoint':None},
                      {'edgeSkinPoint':{'x':320,'y':1}},{'edgeSkinPoint':{'x':'20','y':1}}):
            with self.subTest(extra=extra),self.assertRaises(ValueError):self.run_image(**extra)
        with self.assertRaises(ValueError):self.run_image(edgeBackgroundPoint={'x':71,'y':100})
    def test_wrong_mask_size_and_budget_rejected(self):
        with self.assertRaises(ValueError):self.run_image(editableMask=encode(Image.new('L',(2,2),255)))
        with patch.object(skin_edge,'MAX_REGION_PIXELS',100),self.assertRaisesRegex(ValueError,'quá lớn'):self.run_image()
    def test_preview_matches_full_and_overlay_dimensions(self):
        full=self.run_image();preview=self.run_image(preview=True)
        item=preview['results'][0];x,y,r,b=item['crop']
        np.testing.assert_array_equal(self.result(full)[y:b,x:r],self.result(preview))
        for name in ('edgeOverlayFile','edgeBandFile'):
            with Image.open(self.root/item[name]) as artifact:
                self.assertEqual(artifact.size,(item['width'],item['height']))
        self.assertTrue(item['previewOnly'])
        saved=json.loads((self.root/full['directory']/'metadata.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['settings']['edgeSkinPoint'],{'x':70,'y':100})
        self.assertEqual(saved['settings']['edgeVersion'],1)
    def test_curved_boundary_keeps_sides(self):
        y,x=np.mgrid[:240,:320];distance=np.sqrt((x-130)**2+(y-120)**2)-70
        matte=1/(1+np.exp(distance/4))
        self.rgb=np.rint(matte[:,:,None]*self.fg+(1-matte[:,:,None])*self.bg).astype(np.uint8)
        Image.fromarray(self.rgb).save(self.path);self.mask=Image.fromarray((np.abs(distance)<24).astype(np.uint8)*255)
        result=self.result(self.run_image(edgeSkinPoint={'x':130,'y':120},edgeBackgroundPoint={'x':280,'y':120}))
        a=self.alpha(self.rgb.astype(float));b=self.alpha(result.astype(float))
        near=(a>.15)&(a<.85)&(np.abs(a-.5)>.03)
        self.assertTrue(np.array_equal(a[near]>.5,b[near]>.5))
    def test_cancel_during_processing_or_save_does_not_publish(self):
        for when in ('processing','saving'):
            def active(*_):
                if (when=='processing' and any(e.get('stage')=='enhance-processing' for e in self.events)) or list(self.env['JOBS_DIR'].glob('enhance-*/edge_overlay.png')):
                    raise RuntimeError('Đã hủy')
            self.env['ensure_job_active'].side_effect=active
            with self.assertRaisesRegex(RuntimeError,'hủy'):self.run_image()
            self.assertFalse(self.env['OUTPUTS'].exists())
            self.assertFalse(any(e.get('status')=='completed' for e in self.events))


if __name__=='__main__':unittest.main()
