"""Hard gates, repairs, unknown pose, and target coverage regressions."""
import ast
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tryon_quality import candidate_key, gate_reasons, pose_consistency, repair_is_better
from tryon_geometry import target_coverage, target_attributes, inward_blend

thresholds=dict(minimumQuality=75,minimumSimilarity=.55,minimumSeam=65,minimumAnatomy=90)
passed=dict(qualityScore=80,referenceSimilarity=.7,seamScore=80,preservationScore=100,
            colorMaterial={'accepted':True,'colorMaterialScore':80},geometry={'accepted':True,'geometryScore':70},
            poseConsistency={'accepted':True},bodyAudit={'passed':True},rankingScore=70)
failed={**passed,'rankingScore':99,'colorMaterial':{'accepted':False}}
assert max([failed,passed],key=lambda x:candidate_key(x,thresholds)) is passed
assert 'reference' in gate_reasons({**passed,'referenceSimilarity':float('nan')},thresholds)
assert not repair_is_better(passed,{**passed,'seamScore':90,'colorMaterial':{'accepted':False}},thresholds)
assert repair_is_better(passed,{**passed,'seamScore':90},thresholds)
assert not repair_is_better(passed,{**passed,'seamScore':90,'colorMaterial':{'accepted':True,'colorMaterialScore':65}},thresholds), 'Better seams cannot excuse degraded fabric even above the hard threshold'
assert not pose_consistency(None,[])['accepted']
points=[[0.,0.,0.] for _ in range(17)]
for i,p in {5:(60,50),6:(140,50),7:(40,100),8:(160,100),9:(25,150),10:(175,150),11:(75,150),12:(125,150),13:(75,220),14:(125,220),15:(75,290),16:(125,290)}.items():
    points[i]=[*p,1.]
person={'box':[10,0,190,310],'keypoints':points}
assert pose_consistency(person,[person])['accepted']
shifted={**person,'keypoints':[[x+60,y,c] for x,y,c in points]}
assert not pose_consistency(person,[shifted])['accepted']
mask=Image.new('L',(200,320));mask.paste(255,(65,50,135,155))
protected=Image.new('L',mask.size);protected.paste(255,(16,145,35,170))
long,expected,_,info=target_coverage(mask,protected,'upper_body',person,{'sleeveLength':'long'})
short,_,_,_=target_coverage(mask,protected,'upper_body',person,{'sleeveLength':'short'})
assert long.getpixel((35,130))>0 and short.getpixel((35,130))==0
assert not np.asarray(long)[np.asarray(protected)>0].any()
assert info['addedPixels']>0 and info['applied']
skirt,_,_,info=target_coverage(mask,protected,'overall',person,{'hemLength':'knee','silhouette':'a_line'})
assert skirt.getpixel((50,210))>0 and skirt.getpixel((100,300))==0
assert skirt.getpixel((100,200))>0, 'Left/right joint ordering must not create a crossed polygon'
unchanged,_,_,info=target_coverage(mask,protected,'upper_body',None,{'sleeveLength':'long'})
assert np.array_equal(unchanged,mask) and info['warnings']
empty,_,_,info=target_coverage(mask,protected,'upper_body',person,None)
assert np.array_equal(empty,mask) and not info['applied']
for invalid in ({'sleeveLength':'invalid'},{'unexpected':'x'},'long'):
    try:target_attributes(invalid,'upper_body')
    except ValueError:pass
    else:raise AssertionError('Invalid attributes accepted')
blend=inward_blend(long,5)
assert not np.asarray(blend)[np.asarray(long)==0].any()

# A uniform erroneous patch must be caught even if preservation is perfect.
tree=ast.parse((ROOT/'ai_service.py').read_text(encoding='utf-8'))
names={'catvton_geometry_consistency','color_material_consistency'}
ns=dict(np=np,cv2=cv2,Image=Image,ImageFilter=ImageFilter)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'<quality>', 'exec'),ns)
flat=Image.new('RGB',(200,320),(180,20,20))
geometry=ns['catvton_geometry_consistency'](flat,mask)
assert not geometry['accepted']
assert 'geometry' in gate_reasons({**passed,'geometry':geometry},thresholds)
print('OK: passing candidates win, repairs cannot regress gates, pose is measured, flat patches fail, target sleeves/hem and protection are respected.')
