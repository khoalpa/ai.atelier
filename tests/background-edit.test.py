import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from background_edit import cutout
class CutoutTests(unittest.TestCase):
    def test_source_bound_mask_and_alpha_applied_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); directory=root/'workspace/manual/assets'; directory.mkdir(parents=True)
            source='/manual-assets/'+('a'*64)+'.png'
            Image.new('RGBA',(32,24),(40,80,120,128)).save(directory/('a'*64+'.png'))
            result=cutout({'asset':source},root,lambda image:Image.new('L',image.size,255))
            with Image.open(directory/Path(result['maskUrl']).name) as mask:
                self.assertEqual(mask.size,(32,24)); self.assertEqual(mask.getpixel((5,5)),(255,255,255))
            with self.assertRaises(ValueError):cutout({'asset':'/manual-assets/../a.png'},root,lambda im:None)
            with self.assertRaises(ValueError):cutout({'asset':source},root,lambda im:None)
            with self.assertRaises(ValueError):cutout({'asset':source},root,lambda im:Image.new('L',im.size,0))
if __name__=='__main__':unittest.main()
