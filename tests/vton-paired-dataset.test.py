import importlib.util
import json
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "validate-vton-paired-dataset.py"
SPEC = importlib.util.spec_from_file_location("vton_paired_validator", SCRIPT)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def image(path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (40, 80, 120)).save(path)


with tempfile.TemporaryDirectory() as temporary:
    dataset = Path(temporary)
    image(dataset / "images/products/item.png", (768, 768))
    image(dataset / "images/people/worn.png", (768, 1024))
    base = {
        "id": "upper-001",
        "split": "train",
        "category": "upper_body",
        "productId": "product-001",
        "personId": "person-001",
        "productImage": "images/products/item.png",
        "personImage": "images/people/worn.png",
        "attributes": {"sleeveLength": "long", "neckline": "collared", "hemLength": "hip", "layering": "single"},
        "quality": {"frontView": True, "fullGarmentVisible": True, "severeOcclusion": False},
        "provenance": {"source": "owned-photo-session", "synthetic": False, "consentRecorded": True, "commercialUseAllowed": True},
    }
    (dataset / "manifest.jsonl").write_text(json.dumps(base) + "\n", encoding="utf-8")
    result = validator.validate(dataset, 1, 1)
    assert result["state"] == "needs_data"
    assert result["realPairedRecords"] == 1
    assert not any(issue["severity"] == "error" for issue in result["issues"])

    invalid = dict(base)
    invalid["id"] = "upper-002"
    invalid["split"] = "validation"
    invalid["provenance"] = dict(base["provenance"], synthetic=True)
    (dataset / "manifest.jsonl").write_text(json.dumps(base) + "\n" + json.dumps(invalid) + "\n", encoding="utf-8")
    result = validator.validate(dataset, 1, 1)
    codes = {issue["code"] for issue in result["issues"]}
    assert result["state"] == "invalid"
    assert "provenance.synthetic" in codes
    assert "split.leakage" in codes

    unknown = dict(base, personId=None)
    (dataset/'manifest.jsonl').write_text(json.dumps(unknown)+'\n',encoding='utf-8')
    result=validator.validate(dataset,1,1,categories=('upper_body',))
    assert result['receivedRecords']==1 and result['realPairedRecords']==0
    assert result['readyForFineTune'] is False
    assert any(issue['code']=='record.identity' for issue in result['issues'])

print("OK: paired VTON dataset readiness, provenance, labels, images, and split leakage.")
