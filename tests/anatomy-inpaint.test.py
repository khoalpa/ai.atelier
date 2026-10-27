import unittest
import sys
import json
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ai.tasks.anatomy_inpaint import PARTS, _part_mask, _protect_others, _settings


def pose(offset=0.0):
    points = np.zeros((17, 3), dtype=float)
    coordinates = {
        0: (.50, .12), 5: (.40, .30), 6: (.60, .30), 7: (.32, .48), 8: (.68, .48),
        9: (.27, .66), 10: (.73, .66), 11: (.44, .58), 12: (.56, .58), 13: (.42, .76),
        14: (.58, .76), 15: (.40, .94), 16: (.60, .94),
    }
    for index, (x, y) in coordinates.items():
        points[index] = (x + offset, y, 1.0)
    return points.tolist()


class AnatomyMaskTests(unittest.TestCase):
    def test_hand_mask_stays_on_selected_side(self):
        mask = _part_mask((1000, 1000), pose(), PARTS["right_hand"], "strict")
        ys, xs = np.where(mask > 0)
        self.assertGreater(len(xs), 100)
        self.assertGreater(float(xs.mean()), 600)
        self.assertLess(xs.max(), 900)

    def test_limb_mask_connects_all_requested_segments(self):
        mask = _part_mask((800, 1000), pose(), PARTS["left_leg"], "balanced")
        self.assertGreater(mask[580, 352], 0)
        self.assertGreater(mask[760, 336], 0)
        self.assertGreater(mask[930, 320], 0)

    def test_other_people_are_protected(self):
        people = [
            {"id": 0, "box": [.05, .1, .45, .9]},
            {"id": 1, "box": [.55, .1, .95, .9]},
        ]
        protected = _protect_others((100, 100), people, 0)
        self.assertEqual(int(protected[50, 75]), 255)
        self.assertEqual(int(protected[50, 25]), 0)

    def test_rejects_unknown_part_and_mode(self):
        with self.assertRaisesRegex(ValueError, "Bộ phận"):
            _settings({"bodyPart": "tail"})
        with self.assertRaisesRegex(ValueError, "Mức kiểm tra"):
            _settings({"bodyPart": "left_hand", "anatomyMode": "wild"})

    def test_reads_user_defined_part_catalog(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "workspace").mkdir()
            catalog = {"schemaVersion": 1, "items": [{
                "id": "center_detail", "label": "Vùng giữa", "kind": "region", "side": "center",
                "joints": [0], "segments": [], "mask": {"safe": .2, "balanced": .3, "strict": .4,
                "endpointScale": 1, "minimumRadius": 12}, "quality": {"safe": 60, "balanced": 70, "strict": 80}
            }]}
            (root / "workspace" / "prompts.json").write_text(json.dumps({"featurePresets": {"anatomy.parts": catalog}}), encoding="utf-8")
            part, spec, mode = _settings({"bodyPart": "center_detail", "anatomyMode": "balanced"}, root)
            self.assertEqual((part, spec["label"], mode), ("center_detail", "Vùng giữa", "balanced"))


if __name__ == "__main__":
    unittest.main()
