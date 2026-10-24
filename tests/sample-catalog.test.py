import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sample_catalog import resolve_sample, collection_path, sample_ids


class Samples(unittest.TestCase):
    def test_demo_only_install_has_benchmark_people(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'samples').mkdir()
            (root/'samples/catalog.json').write_text(json.dumps({'schemaVersion':2,'assets':[]}))
            aliases={'demo/people/one.png':'person','demo/garments/one.png':'garment'}
            alias_file=root/'samples/aliases.json'
            alias_file.write_text(json.dumps({'aliases':aliases}))
            self.assertEqual(sample_ids(root,('characters/',),fallback_prefixes=('demo/people/',)),['demo/people/one.png'])
            aliases['characters/c001.png']='legacy-person'
            alias_file.write_text(json.dumps({'aliases':aliases}))
            self.assertEqual(sample_ids(root,('characters/',),fallback_prefixes=('demo/people/',)),['characters/c001.png'])

    def test_stable_id_archive_and_boundary(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name in ('samples/demo/person.png','workspace/sample-archive/v1/old.jpg'):
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'original')
            (root/'samples/catalog.json').write_text(json.dumps({'schemaVersion':2,'assets':[
                {'id':'person','path':'demo/person.png'},
                {'id':'private','path':'old.jpg','storage':'archive'},
                {'id':'bad','path':'../../outside.png'}]}))
            (root/'samples/aliases.json').write_text(json.dumps({'aliases':{'legacy/name.jpg':'private','duplicate.jpg':'private'}}))
            self.assertEqual(resolve_sample(root,'legacy/name.jpg'),resolve_sample(root,'duplicate.jpg'))
            self.assertEqual(resolve_sample(root,'person').read_bytes(),b'original')
            self.assertEqual(sample_ids(root,('legacy/',)),['legacy/name.jpg'])
            self.assertEqual(collection_path(root,'characters'),root/'samples/testing/regression-v1/characters')
            for value in ('../outside.png','C:/outside.png','bad','catalog.json','missing'):
                with self.assertRaises(ValueError):resolve_sample(root,value)


if __name__=='__main__':unittest.main()
