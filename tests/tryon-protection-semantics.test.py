from helpers.ai_source import read_source
"""Confident fabric labels unlock collars without unlocking faces or hands."""
import ast
from pathlib import Path
import sys
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import character_quality

tree = ast.parse(read_source(ROOT/'ai_service.py', encoding='utf-8'))
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'automatic_protected_detail_mask')
env = dict(np=np, cv2=cv2, Image=Image, ROOT=ROOT)
exec(compile(ast.Module(body=[function], type_ignores=[]), '<production-protection>', 'exec'), env)
protect = env[function.name]
source = np.full((260,200,3), 45, np.uint8)
source[120:150,25:55] = source[120:150,145:175] = [190,130,90]
points = [[100,40,1] for _ in range(17)]
for i,p in {5:[60,90,1],6:[140,90,1],7:[45,110,1],8:[155,110,1],9:[40,130,1],10:[160,130,1]}.items():
    points[i]=p
source=Image.fromarray(source)
with patch.object(character_quality,'available',return_value=False):
    before=np.array(protect(source,[20,10,180,240],points))
labels=np.zeros(before.shape,np.uint8);labels[50:85,60:140]=4
confidence=np.ones(before.shape,bool);confidence[60:70,60:90]=False
with patch.object(character_quality,'available',return_value=True), patch.object(character_quality,'parse',return_value=(labels,confidence)):
    after=np.array(protect(source,[20,10,180,240],points))
removed=(before>0)&(after==0)
assert removed.any(), 'the old dark collar must not remain protected'
assert np.all((labels[removed]==4)&confidence[removed])
assert np.array_equal(after[:45],before[:45]), 'head core is preserved'
assert np.array_equal(after[120:150],before[120:150]), 'visible hand skin is preserved'
assert before[130,40] == after[130,40] == 255
assert np.array_equal(after[60:70,60:90],before[60:70,60:90]), 'uncertain parsing cannot unlock anything'
print('OK: confident collar exclusion, unchanged head/hands and conservative uncertainty fallback.')
