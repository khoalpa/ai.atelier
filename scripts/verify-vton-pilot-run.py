"""Check experiment artifacts and comparisons before reporting completion."""
import argparse
import json
import math
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from vton_pilot import file_hash, load_dataset, masked_mae


def require(condition,message):
    if not condition:raise ValueError(message)


def verify(run,installed_attention):
    report=json.loads((run/'run.json').read_text(encoding='utf-8'))
    require(report['status']=='completed','Training has not completed')
    require(report.get('attentionChanged') is True and report.get('frozenParameterCheck')=='passed',
        'Training parameter checks did not pass')
    require(report.get('automaticPromotion') is False and report.get('installedWeightsChanged') is False,
        'This verification requires an unpromoted experimental checkpoint')
    for relative,digest in report.get('sourceSha256',{}).items():
        require(file_hash(run/'source-snapshot'/relative)==digest,'Source snapshot changed')
    data=Path(report['config']['dataset']).resolve()
    rows=load_dataset(data);validation=[r for r in rows if r['split']=='validation']
    require(file_hash(data/'manifest.jsonl')==report['datasetManifestSha256'],'Dataset changed during the experiment')
    require(report['counts']=={'train':sum(r['split']=='train' for r in rows),'validation':len(validation),
        'products':len({r['productId'] for r in rows})},'Reported dataset counts disagree')
    require(file_hash(installed_attention)==report['baseAttentionSha256'],'Installed attention weights changed')
    require(file_hash(run/'attention/model.safetensors')==report['attentionSha256'],'Saved checkpoint hash disagrees')
    checkpoint=json.loads((run/'checkpoint-verification.json').read_text(encoding='utf-8'))
    require(checkpoint.get('verified') is True and checkpoint.get('sha256')==report['attentionSha256'],
        'Actual checkpoint loader verification is missing or stale')
    losses=[json.loads(line) for line in (run/'training.jsonl').read_text(encoding='utf-8').splitlines()]
    require([r['step'] for r in losses]==list(range(1,report['config']['steps']+1)),'Training steps are missing or duplicated')
    require(all(math.isfinite(r[k]) for r in losses for k in ('loss','gradNorm')),'Training contains non-finite values')
    size=tuple(report['method']['resolution']);renders=0
    for stage in ('baseline','adapted'):
        metrics=json.loads((run/stage/'metrics.json').read_text(encoding='utf-8'))
        require(metrics==report[stage],'Stage metrics and final report disagree')
        require([r['id'] for r in metrics['records']]==[r['id'] for r in validation],'Validation ordering changed')
        scores=[];cohorts={}
        for row,record in zip(validation,metrics['records']):
            with Image.open(data/row['personImage']) as target, Image.open(data/row['maskImage']) as mask:
                for mode in ('paired','transfer'):
                    with Image.open(run/stage/f'{row["id"]}-{mode}.png') as image:
                        require(image.size==size,'Render geometry disagrees with the run')
                        image.load();renders+=1
                        if mode=='paired':score=masked_mae(target,image,mask)
            require(abs(score-record['pairedEditRegionMAE'])<1e-8,'MAE does not match saved pixels')
            scores.append(score);cohorts.setdefault(row.get('cohort','unspecified'),[]).append(score)
            require(record['transferProductId']!=row['productId'],'Transfer target is the original garment')
            require(record['transferProductId']==report['baseline']['records'][len(scores)-1]['transferProductId'],
                'Transfer target changed between model versions')
            require(file_hash(run/'baseline'/f'{row["id"]}-transfer-mask.png')==
                file_hash(run/'adapted'/f'{row["id"]}-transfer-mask.png'),'Transfer masks differ between model versions')
        require(abs(sum(scores)/len(scores)-metrics['meanPairedEditRegionMAE'])<1e-8,'Mean score disagrees')
        for cohort,values in cohorts.items():
            expected=metrics['cohorts'][cohort]
            require(expected['count']==len(values) and abs(expected['meanPairedEditRegionMAE']-sum(values)/len(values))<1e-8,
                'Cohort metrics disagree')
    review=json.loads((run/'visual-review.json').read_text(encoding='utf-8'))
    expected={(r['id'],mode) for r in validation for mode in ('paired','transfer')}
    found=Counter((r['id'],r['mode']) for r in review.get('records',[]))
    require(set(found)==expected and all(n==1 for n in found.values()),'Visual review is incomplete or duplicated')
    require(all(r.get('baselineIssuesVi') and r.get('adaptedIssuesVi') for r in review['records']),
        'Both versions need explicit visual review notes')
    class Links(HTMLParser):
        def __init__(self):super().__init__();self.links=[]
        def handle_starttag(self,tag,attrs):
            self.links.extend(v for k,v in attrs if k in ('href','src'))
    parser=Links();parser.feed((run/'review.html').read_text(encoding='utf-8'))
    for link in parser.links:
        url=urlsplit(link)
        require(not url.scheme and not url.netloc,'Report should use local artifact links')
        require((run/unquote(url.path)).is_file(),'Broken report link: '+link)
    return {'verified':True,'renders':renders,'validationPairs':len(validation),'trainingSteps':len(losses),
        'sameTransferMasks':True,'scoresRecomputedFromImages':True,'reportLinksChecked':len(parser.links),
        'checkpointLoaderVerified':True,'installedWeightsUnchanged':True,'datasetUnchanged':True,
        'identityDisjoint':report.get('identityDisjoint'),'productionReady':False}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',type=Path,required=True)
    parser.add_argument('--installed-attention',type=Path,
        default=ROOT/'models/tryon/CatVTON/mix-48k-1024/attention/model.safetensors')
    args=parser.parse_args();run=args.run.resolve()
    result=verify(run,args.installed_attention)
    (run/'artifact-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
