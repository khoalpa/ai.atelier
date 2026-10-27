"""Behavioral skin repair tests: selection, texture, preview, AI contract and cancellation."""
import base64
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import image_enhancement as enhancement
import skin_retouch as skin


def encode(image):
    stream = io.BytesIO(); image.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


class SkinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.path = self.root / 'source.png'
        y, x = np.mgrid[:180, :240]
        noise = np.random.default_rng(40).normal(0, 3, (180, 240, 1))
        self.clean = np.clip(np.array([181, 130, 105]) + (x / 30 + y / 40)[..., None] + noise, 0, 255).astype(np.uint8)
        self.before = self.clean.copy(); self.before[77:85, 94:102] = [45, 30, 25]
        Image.fromarray(self.before).save(self.path)
        self.mask = Image.new('L', (240, 180)); ImageDraw.Draw(self.mask).rectangle((91, 74, 105, 88), fill=255)
        self.events = []
        self.env = dict(ROOT=self.root, OUTPUTS=self.root/'outputs', JOBS_DIR=self.root/'jobs',
            safe_sample=lambda _: self.path, update_job=lambda *a, **kw: self.events.append(kw),
            persist_job_request=Mock(), ensure_job_active=Mock(), release_inpaint=Mock())
    def tearDown(self): self.temp.cleanup()
    def run_image(self, **body):
        return enhancement.enhance(dict(sampleId='source.png', jobId='test', method='skin-heal',
            editableMask=encode(self.mask), **body), self.env)
    def result(self, report): return np.array(Image.open(self.root / report['results'][0]['file']))
    def test_small_defect_removed_without_softening_entire_image(self):
        old = self.path.read_bytes()
        report = self.run_image()
        result = self.result(report); area = np.asarray(self.mask) > 0
        before_error = np.abs(self.before[77:85, 94:102].astype(float)-self.clean[77:85, 94:102]).mean()
        after_error = np.abs(result[77:85, 94:102].astype(float)-self.clean[77:85, 94:102]).mean()
        self.assertLess(after_error, before_error * .15)
        np.testing.assert_array_equal(result[~area], self.before[~area])
        self.assertEqual(self.path.read_bytes(), old)
        self.assertGreater(report['metrics']['textureDonors'], 0)
        self.assertEqual(report['settings']['scope'], 'selected')
    def test_explicit_selection_is_mandatory_even_with_all_scope(self):
        for method in skin.METHODS:
            for scope in ('all', 'selected'):
                with self.subTest(method=method, scope=scope), self.assertRaises(ValueError):
                    enhancement.enhance(dict(sampleId='source.png', method=method, scope=scope), self.env)
        self.assertFalse(self.env['OUTPUTS'].exists())
    def test_protection_wins_and_alpha_preserved_for_all_methods(self):
        rgba = Image.fromarray(self.before).convert('RGBA')
        alpha = Image.linear_gradient('L').resize(rgba.size); rgba.putalpha(alpha); rgba.save(self.path)
        protect = Image.new('L', rgba.size); ImageDraw.Draw(protect).rectangle((100, 70, 110, 100), fill=255)
        for method in skin.METHODS:
            body = dict(sampleId='source.png', method=method, editableMask=encode(self.mask), protectedDetailMask=encode(protect))
            with patch.object(skin, 'ai', return_value=(Image.new('RGB', rgba.size, (10, 20, 30)), {})):
                report = enhancement.enhance(body, self.env)
            result = self.result(report)
            keep = (np.asarray(self.mask) == 0) | (np.asarray(protect) > 0)
            np.testing.assert_array_equal(result[keep], np.asarray(rgba)[keep])
            np.testing.assert_array_equal(result[:, :, 3], np.asarray(alpha))
    def test_invalid_skin_settings_rejected(self):
        for extra in ({'skinSmooth':-1}, {'skinSmooth':101}, {'skinSmooth':float('nan')},
                      {'skinSmooth':True}, {'preserveTexture':'true'}):
            with self.subTest(extra=extra), self.assertRaises(ValueError): self.run_image(**extra)
        with self.assertRaises(ValueError): skin.options({'skinSmooth':0}, 'skin-smooth')
    def test_all_protected_and_wrong_sized_mask_rejected(self):
        with self.assertRaises(ValueError): self.run_image(protectedDetailMask=encode(Image.new('L', self.mask.size, 255)))
        with self.assertRaises(ValueError): self.run_image(protectedDetailMask=encode(Image.new('L', (2, 2))))
    def test_smoothing_retains_more_texture_when_enabled(self):
        source = Image.fromarray(self.clean)
        textured = np.asarray(skin.smooth(source, 90, True)).astype(float)
        softened = np.asarray(skin.smooth(source, 90, False)).astype(float)
        def detail(array): return (array - cv2.GaussianBlur(array, (0, 0), 1)).std()
        self.assertLess(detail(textured), detail(self.clean.astype(float)))
        self.assertGreater(detail(textured), detail(softened) * 1.3)
        self.assertLess(np.abs(textured.mean(axis=(0, 1))-self.clean.mean(axis=(0, 1))).max(), 1)
    def test_healing_preserves_varied_skin_tones(self):
        for tone in ([65, 40, 30], [130, 85, 60], [220, 170, 140], [245, 220, 190]):
            arr = np.full((90, 100, 3), tone, np.uint8); arr[40:46, 40:46] = 5
            mask = Image.new('L', (100, 90)); ImageDraw.Draw(mask).rectangle((37, 37, 49, 49), fill=255)
            result, _ = skin.heal(Image.fromarray(arr), mask, dict(level='light', preserveTexture=True))
            self.assertLess(np.abs(np.asarray(result)[40:46, 40:46].astype(float)-tone).mean(), 5)
    def test_large_healing_mask_rejected(self):
        self.mask = Image.new('L', self.mask.size); ImageDraw.Draw(self.mask).rectangle((40, 40, 180, 140), fill=255)
        with self.assertRaisesRegex(ValueError, 'quá rộng'): self.run_image()
    def test_multiple_spots_and_preview_matches_full_crop(self):
        source = Image.fromarray(self.before).resize((840, 630))
        source.save(self.path)
        self.mask = self.mask.resize(source.size, Image.Resampling.NEAREST)
        ImageDraw.Draw(self.mask).ellipse((710, 480, 720, 490), fill=255)
        full = self.run_image(); preview = self.run_image(preview=True, previewX=100, previewY=100)
        box = preview['results'][0]['crop']
        self.assertEqual((preview['width'], preview['height']), (256, 256))
        self.assertTrue(preview['previewOnly'])
        np.testing.assert_array_equal(self.result(preview), self.result(full)[box[1]:box[3], box[0]:box[2]])
        saved = json.loads((self.root/preview['directory']/'metadata.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['sourceSha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(saved['settings']['skinRetouchVersion'], 1)
    def test_cancel_processing_and_saving_never_publishes(self):
        for when in ('processing', 'saving'):
            def active(*_):
                if when == 'processing' or list(self.env['JOBS_DIR'].glob('enhance-*/metadata.json')):
                    raise RuntimeError('Đã hủy')
            self.env['ensure_job_active'].side_effect = active
            with self.assertRaisesRegex(RuntimeError, 'hủy'): self.run_image()
            self.assertFalse(self.env['OUTPUTS'].exists())
            self.assertFalse(any(e.get('status') == 'completed' for e in self.events))
    def fake_ai(self):
        self.pipe = Mock()
        self.env['load_inpaint_pipe'] = Mock(return_value=self.pipe)
        self.env['torch'] = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:False), float32='float32',
            inference_mode=contextlib.nullcontext, Generator=lambda _:SimpleNamespace(manual_seed=lambda seed:seed))
        def generate(pipe, **kwargs):
            kwargs['callback_on_step_end'](pipe, 0, 0, {})
            return SimpleNamespace(images=[kwargs['control_image']])
        self.env['traced_pipeline_call'] = Mock(side_effect=generate)
    def test_ai_contract_uses_local_model_and_isolates_adapters(self):
        self.fake_ai()
        with patch.object(skin, 'configuration', return_value={'modelReady':True}):
            report = enhancement.enhance(dict(sampleId='source.png', method='skin-ai', editableMask=encode(self.mask)), self.env)
        kwargs = self.env['traced_pipeline_call'].call_args.kwargs
        self.assertEqual(report['model'], skin.MODEL)
        self.assertEqual(self.env['load_inpaint_pipe'].call_args.args[1], self.root/skin.MODEL_DIR)
        self.pipe.unload_lora_weights.assert_called_once()
        self.assertEqual(kwargs['controlnet_conditioning_scale'], 1.0)
        self.assertEqual(kwargs['true_cfg_scale'], 4.0)
        self.assertIn('control_mask', kwargs)
        self.assertIn('skin', kwargs['prompt'])
        self.assertEqual(self.env['release_inpaint'].call_count, 2)
    def test_cancel_inside_ai_step_releases_model(self):
        self.fake_ai()
        def generate(pipe, **kwargs):
            self.env['ensure_job_active'].side_effect = RuntimeError('Đã hủy')
            kwargs['callback_on_step_end'](pipe, 0, 0, {})
        self.env['traced_pipeline_call'].side_effect = generate
        with patch.object(skin, 'configuration', return_value={'modelReady':True}), self.assertRaisesRegex(RuntimeError, 'hủy'):
            enhancement.enhance(dict(sampleId='source.png', method='skin-ai', editableMask=encode(self.mask)), self.env)
        self.assertEqual(self.env['release_inpaint'].call_count, 2)
        self.assertFalse(self.env['OUTPUTS'].exists())
    def test_missing_ai_model_fails_without_fallback(self):
        with self.assertRaisesRegex(ValueError, 'model sửa da AI'):
            enhancement.enhance(dict(sampleId='source.png', method='skin-ai', editableMask=encode(self.mask)), self.env)
        self.assertFalse(self.env['OUTPUTS'].exists())


if __name__ == '__main__': unittest.main()
