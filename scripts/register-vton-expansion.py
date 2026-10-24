"""Register supplied pilot data without inventing missing readiness metadata."""
import argparse
import importlib.util
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--pilot',type=Path,required=True)
    parser.add_argument('--expansion',type=Path,required=True)
    args=parser.parse_args()
    source=args.pilot.resolve();destination=args.expansion.resolve()
    if source==destination or destination.is_relative_to(source):
        raise ValueError('Expansion must be separate from the pilot')
    if (destination/'manifest.jsonl').exists():
        raise ValueError('Refusing to replace an existing expansion manifest')
    spec=importlib.util.spec_from_file_location('combined',ROOT/'scripts/prepare-vton-combined.py')
    combined=importlib.util.module_from_spec(spec);spec.loader.exec_module(combined)
    pairs,products=combined.collect_sources([source])
    destination.mkdir(parents=True,exist_ok=True)
    rows=[]
    for _,row in pairs:
        for field in ('productImage','personImage'):
            path=destination/row[field];path.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source/row[field],path)
        # Pilot visual acceptance does not establish the stricter capture criteria.
        rows.append({key:row[key] for key in ('id','split','category','productId','productImage','personImage','attributes','provenance')})
        rows[-1].update(personId=row.get('personIdentity'),quality={
            'frontView':None,'fullGarmentVisible':None,'severeOcclusion':None})
    (destination/'manifest.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
    plan_path=destination/'collection-plan.json'
    plan=json.loads(plan_path.read_text(encoding='utf-8')) if plan_path.exists() else {}
    plan.update(state='exploratory_data_received_identity_unverified',newPairsReceived=len(rows),
        newProductsReceived=len(products),newPilot=str(source),personIdTableProvided=False,
        newPilotSplits={s:sum(r['split']==s for r in rows) for s in ('train','validation','test')},
        newIndependentTestPairs=0,productionReady=False,
        note='Received counts are not readiness-qualified counts. Pilot splits are product-held-out only. No person IDs are inferred; existing validation is not a new independent test.')
    target=sum(plan.get('initialCollectionTarget',{}).values())
    if target:plan['additionalPairsToInitialCollectionTarget']=max(0,target-len(rows))
    plan_path.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'receivedPairs':len(rows),'products':len(products),'personIDsVerified':False}))


if __name__=='__main__':main()
