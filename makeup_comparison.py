"""Bounded, sequential makeup previews sharing an immutable source and masks."""
import copy
import hashlib
import json
import time

import makeup
import image_enhancement as enhancement

SETTING_KEYS=('style','description','plannedDescription','prompt','intensity','renderer','lip','eyeshadow','blush','brow',
              'eyeliner','finish','parts','preserveFeatures','skinSmooth','strengths')


def validate(body, root):
    styles=body.get('comparisonStyles')
    if not isinstance(styles,list) or not 2<=len(styles)<=4:raise ValueError('Chọn từ 2 đến 4 phong cách để so sánh.')
    seen=set();entries=[]
    for style in styles:
        if not isinstance(style,dict):raise ValueError('Phong cách so sánh không hợp lệ.')
        key,name=style.get('id'),style.get('name')
        if not isinstance(key,str) or not key or len(key)>100 or key in seen:raise ValueError('Phong cách bị trùng hoặc không hợp lệ.')
        if not isinstance(name,str) or not name.strip() or len(name)>160:raise ValueError('Tên phong cách không hợp lệ.')
        seen.add(key)
        settings=style.get('settings')
        if not isinstance(settings,dict):raise ValueError('Thiếu thiết lập phong cách.')
        # A saved style cannot replace source identity, masks or preview mode.
        clean={k:copy.deepcopy(settings[k]) for k in SETTING_KEYS if k in settings}
        options=makeup.options({**clean,'styleName':name,'faceIndex':body.get('faceIndex'),'seed':42,'preview':True,'limitSelection':True},root)
        options['plannedDescription']=options['description']
        entries.append(dict(id=key,name=name.strip(),settings=options,status='queued',progress=0))
    return entries


def run(body, env):
    started=time.perf_counter();entries=validate(body,env['ROOT'])
    job=str(body.get('jobId',''))[:80]
    if not job:raise ValueError('Thiếu mã lượt so sánh.')
    active=lambda:env['ensure_job_active'](job)
    active()
    path=env['safe_sample'](str(body.get('sampleId','')))
    sha=hashlib.sha256(path.read_bytes()).hexdigest()
    if body.get('sourceSha256')!=sha:raise ValueError('Ảnh nguồn đã đổi. Hãy nhận diện lại trước khi so sánh.')
    source,_=enhancement.load_source(path)
    # Validate both masks before starting any work. The red mask is mandatory.
    selected=enhancement.read_mask(body.get('editableMask'),source.size)
    enhancement.read_mask(body.get('protectedDetailMask'),source.size)
    if not selected.getbbox():raise ValueError('Tô vùng đỏ cần trang điểm trước khi so sánh.')
    points=env.get('makeup_landmarks',makeup.landmarks)(source,env['ROOT'])
    if body['faceIndex']>=len(points):raise ValueError('Khuôn mặt đã đổi. Hãy nhận diện lại.')
    makeup.region_masks(points[body['faceIndex']],source.size)
    common={k:body.get(k) for k in ('sampleId','sourceSha256','faceIndex','editableMask','protectedDetailMask')}
    common.update(preview=True,limitSelection=True,seed=42,jobId=job)
    results=[];status='running';current=-1
    def publish(**extra):
        env['update_job'](job,taskType='makeup',comparison=True,comparisonEntries=copy.deepcopy(entries),results=list(results),
            sourceId=body['sampleId'],totalVariants=len(entries),totalWorkSteps=len(entries)*100,
            completedSteps=sum(e['progress'] if e['status']=='running' else 100 if e['status'] in ('completed','failed') else 0 for e in entries),**extra)
    env['persist_job_request'](job,'makeup',body)
    publish(status='running',stage='makeup-comparing',error=None)
    try:
        for current,entry in enumerate(entries):
            active();entry['status']='running';publish(status='running',stage='makeup-comparing')
            def update(_job,**changes):
                # Child completion is never parent completion. Only this wrapper
                # publishes a fully saved candidate, so failed candidates vanish.
                n=changes.get('totalWorkSteps',1)
                value=round(95*changes.get('completedSteps',0)/max(1,n))
                entry['progress']=max(entry['progress'],min(95,value))
                publish(stage='makeup-comparing')
            local={**env,'update_job':update,'persist_job_request':lambda *a:None,'makeup_landmarks':lambda *a:points}
            try:
                candidate=env.get('makeup_compare_render',makeup.run)({**entry['settings'],**common},local,variant_count=1)
                item={**candidate['results'][0],'comparisonId':entry['id'],'comparisonName':entry['name'],'label':entry['name']}
                # Retain the same labels when results are reopened from disk.
                metadata=env['ROOT']/candidate['directory']/'metadata.json'
                candidate.update(comparison=True);candidate['results']=[item]
                metadata.write_text(json.dumps(candidate,ensure_ascii=False,indent=2),encoding='utf-8')
                results.append(item);entry.update(status='completed',progress=100)
                publish(stage='makeup-comparing')
            except Exception as error:
                active()  # Cancellation ends the batch; ordinary errors do not.
                entry.update(status='failed',progress=100,error=str(error)[:500]);publish(stage='makeup-comparing')
        active();status='completed' if results else 'failed'
    except Exception as error:
        # Keep all candidates already published if cancellation interrupts a later one.
        if 'hủy' not in str(error).lower():raise
        status='cancelled'
        for entry in entries:
            if entry['status'] in ('running','queued'):entry.update(status='cancelled',progress=0)
    publish(status=status,stage='done' if status=='completed' else status,
            error='Không tạo được phương án nào. Xem lỗi từng phong cách.' if status=='failed' else None,
            durationSeconds=round(time.perf_counter()-started,3))
    return dict(ok=True,jobId=job,taskType='makeup',comparison=True,status=status,comparisonEntries=entries,results=results,
                sourceSha256=sha,durationSeconds=round(time.perf_counter()-started,3))
