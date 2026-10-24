"""Runtime profiles and task templates reload without loading model weights."""
import ast
import json
import sys
import tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
import prompt_catalog as catalog

source=ast.parse((root/'ai_service.py').read_text(encoding='utf-8'))
node=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='resolved_inpaint_profile')
scope={'read_catalog':catalog.read_catalog}
exec(compile(ast.Module(body=[node],type_ignores=[]),'<profile>','exec'),scope)
original=catalog._FILE
with tempfile.TemporaryDirectory() as directory:
    file=Path(directory)/'prompts.json'
    value=json.loads(original.read_text(encoding='utf-8'))
    catalog._FILE=file
    try:
        file.write_text(json.dumps(value),encoding='utf-8')
        resolve=scope['resolved_inpaint_profile']
        assert resolve(None,'unknown')['steps']==value['runtimePresets']['inpaintProfiles']['sdxl']['steps']
        value['runtimePresets']['inpaintProfiles']['sdxl']['guidance']=3.25
        value['runtimePresets']['modelInpaintProfiles']['test-model']={'guidance':6.75}
        file.write_text(json.dumps(value),encoding='utf-8')
        assert resolve(None,'sdxl')['guidance']==3.25
        assert resolve({'id':'test-model','contentStyle':'photo'},'sdxl')['guidance']==6.75
        assert resolve({'id':'other'},'sdxl')['guidance']==3.25
        for task,component in [('outpaint','outpaint.instruction'),('outpaint.detail','outpaint.detail'),('outpaint.material','outpaint.fabric'),('outpaint.seam.garment','outpaint.seam.garment'),('outpaint.seam.background','outpaint.seam.background')]:
            assert catalog.task_prompt(task)==value['components'][component]
            assert catalog.task_prompt(task,'negative')==value['components']['outpaint.negative']
        description='white linen shirt'
        expected='Replace the clothing or object inside the selected region with: white linen shirt. Fit the new item naturally to the person and perspective. Preserve identity, face, pose, anatomy, lighting, background and all protected details outside the selected region.'
        assert catalog.task_prompt('outfit-description',description=description)==expected
        value['templates']['outfitDescription']='Wear {description}.'
        file.write_text(json.dumps(value),encoding='utf-8')
        assert catalog.task_prompt('outfit-description',description=description)=='Wear white linen shirt.'
    finally:
        catalog._FILE=original
print('OK: profile fallback, model override, live reload, task references and lossless replacement template.')
