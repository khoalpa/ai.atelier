"""Write the visual review and training decision for the nine-case benchmark."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = ROOT / "workspace" / "diagnostics" / "synthetic-vton-model-benchmark_20261021"


REVIEWS = {
    "idm-vton-dc": {
        "upper-body-09-p1": (True, True, True, False, "Gray shoulder caps and a soft mask halo remain visible."),
        "upper-body-09-p2": (False, False, False, False, "Large dark-gray side panels replace the garment sides."),
        "upper-body-09-p3": (True, True, True, False, "A dark vertical smear remains on the left side of the top."),
        "lower-body-09-p1": (True, True, None, False, "A translucent skirt-shaped layer remains beyond the hem and side edge."),
        "lower-body-09-p2": (True, True, None, False, "A gray translucent band remains below the skirt hem."),
        "lower-body-09-p3": (True, True, None, False, "A ghost border remains below and beside the skirt."),
        "overall-09-p1": (True, False, True, False, "Unwanted dark diagonal lines and a blocky neckline are prominent."),
        "overall-09-p2": (True, True, True, True, "Color, sweetheart neckline, short sleeves and hem are coherent."),
        "overall-09-p3": (True, True, True, False, "The neckline contains a blocky skin patch and residual smudge."),
    },
    "leffa-dc": {
        "upper-body-09-p1": (True, True, True, True, "The sleeveless top is coherent and clean."),
        "upper-body-09-p2": (True, True, True, True, "The sleeveless top preserves color and silhouette without visible seams."),
        "upper-body-09-p3": (True, True, True, True, "The top is consistent in color, neckline and hem."),
        "lower-body-09-p1": (True, True, None, False, "Large translucent panels remain behind and beside the skirt."),
        "lower-body-09-p2": (True, True, None, False, "A translucent layer remains behind the skirt and below its hem."),
        "lower-body-09-p3": (True, True, None, False, "A large white ghost panel remains at the right side and hem."),
        "overall-09-p1": (True, True, True, False, "A translucent duplicate hem is visible below the dress."),
        "overall-09-p2": (True, True, True, False, "A translucent duplicate hem is visible below the dress."),
        "overall-09-p3": (True, True, True, False, "A translucent duplicate hem is visible below the dress."),
    },
}


def main() -> None:
    reports = {
        name: json.loads((BENCHMARK / f"{name}-report.json").read_text(encoding="utf-8"))
        for name in REVIEWS
    }
    rows = []
    for model, model_reviews in REVIEWS.items():
        automatic = {item["id"]: item for item in reports[model]["cases"]}
        for case_id, (color, structure, sleeves, boundaries, note) in model_reviews.items():
            visual_passed = bool(color and structure and (sleeves is not False) and boundaries)
            rows.append({
                "model": model,
                "case": case_id,
                "colorAccepted": color,
                "structureAccepted": structure,
                "sleevesAccepted": sleeves,
                "boundaryAndAnatomyAccepted": boundaries,
                "visualPassed": visual_passed,
                "automaticPassed": bool(automatic[case_id]["automaticPassed"]),
                "note": note,
            })

    model_summary = {}
    for model in REVIEWS:
        selected = [item for item in rows if item["model"] == model]
        report = reports[model]
        completed = [item for item in report["cases"] if item["status"] == "completed"]
        model_summary[model] = {
            "automaticPassedCases": sum(item["automaticPassed"] for item in selected),
            "visualPassedCases": sum(item["visualPassed"] for item in selected),
            "completedCases": len(completed),
            "meanReferenceSimilarity": sum(item["metrics"]["referenceSimilarity"] for item in completed) / len(completed),
            "meanMaskedPSNR": sum(item["metrics"]["maskedPSNR"] for item in completed) / len(completed),
            "meanSeconds": sum(item["elapsedSeconds"] for item in completed) / len(completed),
        }

    decision = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "benchmark": BENCHMARK.relative_to(ROOT).as_posix(),
        "evaluationMode": "masked self-reconstruction on photorealistic synthetic validation images",
        "thresholdsChanged": False,
        "inputMasksAccepted": True,
        "protectedOverlapZero": True,
        "modelSummary": model_summary,
        "visualReview": rows,
        "decision": {
            "fineTuneSmokeRun": "not-started",
            "readyForSyntheticFineTune": False,
            "reason": "Neither model has a stable nine-case baseline under the unchanged quality gates.",
            "preferredNextExperiment": "Leffa boundary-mask refinement on two representative failures before any full rerun.",
            "representativeCases": ["lower-body-09-p1", "overall-09-p1"],
            "promotionRule": "Only rerun all nine cases after both representative cases lose the ghost boundary without regressing color, structure, sleeves or the existing thresholds.",
        },
        "limitations": [
            "The 90-pair dataset is photorealistic synthetic data, not a licensed real-photo dataset.",
            "Self-reconstruction isolates preprocessing and product fidelity but does not replace a true cross-garment try-on benchmark.",
        ],
    }
    (BENCHMARK / "final-decision.json").write_text(
        json.dumps(decision, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    idm = model_summary["idm-vton-dc"]
    leffa = model_summary["leffa-dc"]
    markdown = f"""# Synthetic VTON nine-case decision

## Outcome

The nine-case masked self-reconstruction benchmark completed for both official DressCode checkpoints without changing the quality thresholds.

| Model | Automatic pass | Visual pass | Mean reference similarity | Mean masked PSNR | Mean time |
|---|---:|---:|---:|---:|---:|
| IDM-VTON DC | {idm['automaticPassedCases']}/9 | {idm['visualPassedCases']}/9 | {idm['meanReferenceSimilarity']:.3f} | {idm['meanMaskedPSNR']:.2f} dB | {idm['meanSeconds']:.1f} s |
| Leffa DC | {leffa['automaticPassedCases']}/9 | {leffa['visualPassedCases']}/9 | {leffa['meanReferenceSimilarity']:.3f} | {leffa['meanMaskedPSNR']:.2f} dB | {leffa['meanSeconds']:.1f} s |

Fine-tuning was not started. Neither model produced a stable nine-case baseline under the unchanged gates.

## Visual findings

- IDM-VTON reproduces two overall-dress cases well enough for the automatic gate, but only one case is clean on visual review. Other cases show gray side panels, dark seams, ghost hems or blocky neckline regions.
- Leffa is visually clean on all three sleeveless-top cases and has higher mean reference similarity, but all skirt and dress cases retain a translucent duplicate layer around the side or hem. Its outside-mask changes also drive the anatomy score below the existing threshold.
- The solid-color garments expose a known strictness of the unchanged geometry/material gate: very smooth fabric regions can score as overly flat. The gate was deliberately left unchanged.

## Decision

Keep fine-tuning blocked. The next experiment should refine the Leffa boundary mask on `lower-body-09-p1` and `overall-09-p1`. A full nine-case rerun is justified only if both cases lose the ghost boundary while preserving color, structure, sleeves and every existing threshold.

This benchmark uses photorealistic synthetic validation images in self-reconstruction mode. It validates preprocessing and product reconstruction; it does not approve production use or replace a true cross-garment benchmark with licensed real photos.
"""
    (BENCHMARK / "FINAL-DECISION.md").write_text(markdown, encoding="utf-8")
    print(json.dumps({"modelSummary": model_summary, "fineTuneSmokeRun": "not-started"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
