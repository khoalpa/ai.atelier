"""Build garment-shape-aware masks for the two fixed IDM-VTON gate cases."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT = ROOT / "workspace" / "diagnostics" / "idm-input-experiment"
OUTPUT = EXPERIMENT / "refined-masks"


def save_refined(category: str, name: str, polygons: list[list[tuple[int, int]]]) -> None:
    source = Image.open(EXPERIMENT / category / "candidate-mask.png").convert("L")
    binary = source.point(lambda value: 255 if value > 16 else 0)
    draw = ImageDraw.Draw(binary)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / name
    binary.save(target)
    coverage = float((np.asarray(binary, dtype=np.uint8) > 0).mean())
    print(f"{target.relative_to(ROOT)} coverage={coverage:.6f} bbox={binary.getbbox()}")


def main() -> None:
    # Extend the source short-sleeve region to the wrists while preserving hands.
    save_refined(
        "upper_body",
        "c002-long-sleeve.png",
        [
            [(285, 400), (345, 420), (375, 515), (389, 625), (405, 725),
             (393, 770), (355, 770), (326, 705), (307, 600), (292, 500)],
            [(620, 395), (674, 415), (682, 505), (693, 605), (713, 710),
             (706, 760), (671, 772), (649, 720), (637, 615), (628, 505)],
        ],
    )

    # Give the dress enough lateral room for a fitted waist and knee-length A-line skirt.
    # The original lower garment remains covered below the intended hem so the model can
    # reconstruct legs instead of compositing the brown trousers back into the result.
    save_refined(
        "overall",
        "c003-a-line-dress.png",
        [[(350, 520), (655, 520), (735, 850), (770, 1045),
          (720, 1120), (295, 1120), (245, 1045), (275, 850)]],
    )


if __name__ == "__main__":
    main()
