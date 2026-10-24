"""Exercise compatibility without importing GPU services or loading model weights."""
import ast
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / "ai_service.py"
tree = ast.parse(source.read_text(encoding="utf-8-sig"))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"lora_family", "lora_matches", "apply_active_loras"}]
namespace = {}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), namespace)


class CompatibilityTests(unittest.TestCase):
    def test_families(self):
        matches = namespace["lora_matches"]
        for family, base in [("sd15", "sd_1.5"), ("sdxl", "sdxl_base_v1-0"), ("sd35-large", "stable-diffusion-3.5-large"), ("sd35-medium", "stable-diffusion-3.5-medium"), ("flux", "flux")]:
            self.assertTrue(matches({"baseModel": base}, {"id": "model", "family": family}))
        self.assertFalse(matches({"baseModel": "stable-diffusion-3.5-medium"}, {"id": "model", "family": "sd35-large"}))
        self.assertFalse(matches({"baseModel": "unknown"}, {"id": "model", "family": "sdxl"}))

    def test_explicit_model_restriction(self):
        self.assertFalse(namespace["lora_matches"]({"baseModel": "sdxl", "compatibleModelIds": ["pony"]}, {"id": "sdxl-base", "family": "sdxl"}))

    def test_switch_excludes_other_model_adapters(self):
        class Pipe:
            _atelier_model_path = "model-b"
            def unload_lora_weights(self):
                self.loaded = []
            def load_lora_weights(self, path, adapter_name):
                self.loaded.append(adapter_name)
            def set_adapters(self, ids, adapter_weights):
                self.ids = ids
        pipe = Pipe()
        namespace.update(inpaint_pipe=pipe, active_loras=[{"id": "a", "modelPath": "model-a", "path": "a", "weight": 0.5}, {"id": "b", "modelPath": "model-b", "path": "b", "weight": 0.6}])
        namespace["apply_active_loras"]()
        self.assertEqual(pipe.loaded, ["b"])


if __name__ == "__main__":
    unittest.main()
