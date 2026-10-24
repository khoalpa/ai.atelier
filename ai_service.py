"""Stable entry point and compatibility imports for existing local tools."""
import importlib
import json
import sys
from types import ModuleType
from pathlib import Path
_symbols=json.loads((Path(__file__).parent/'services/ai/symbols.json').read_text(encoding='utf-8'))
def __getattr__(name):
    if name in _symbols:return getattr(importlib.import_module(_symbols[name]),name)
    raise AttributeError(name)

class _CompatibilityModule(ModuleType):
    def __setattr__(self, name, value):
        if name not in _symbols:
            return super().__setattr__(name, value)
        owner=importlib.import_module(_symbols[name])
        previous=getattr(owner,name)
        # Older diagnostic scripts temporarily replace a loader/tracer or device.
        # Keep those explicit overrides effective across already-imported modules.
        for module_name,module in tuple(sys.modules.items()):
            if module_name.startswith('services.ai.') and module is not None:
                if vars(module).get(name,object()) is previous:setattr(module,name,value)
        setattr(owner,name,value)

sys.modules[__name__].__class__=_CompatibilityModule
if __name__=='__main__':
    from services.ai.application import main
    main()
