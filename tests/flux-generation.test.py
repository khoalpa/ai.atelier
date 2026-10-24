"""Integration routing and exact input regressions live in the shared generation suite."""
import runpy
from pathlib import Path
import unittest
scope=runpy.run_path(str(Path(__file__).with_name('new-image.test.py')))
suite=unittest.TestSuite(scope['NewImageTests'](name) for name in (
    'test_klein_controls_and_wrapper_budget','test_exact_long_text_and_empty_negative',
    'test_preflight_blocks_before_model_load','test_source_finishing_uses_saved_pixels_and_metadata'))
result=unittest.TextTestRunner().run(suite)
if not result.wasSuccessful():raise SystemExit(1)
