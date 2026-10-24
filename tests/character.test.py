import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import character as c
import character_geometry as g


def skeleton(offset=0):
    return np.array([[.3+offset,.2,.99],[.32+offset,.19,.99],[.28+offset,.19,.99],[.34+offset,.2,.9],[.26+offset,.2,.9],[.36+offset,.3,.99],[.24+offset,.3,.99],[.4+offset,.4,.99],[.2+offset,.4,.99],[.4+offset,.5,.99],[.2+offset,.5,.99],[.34+offset,.5,.99],[.26+offset,.5,.99],[.35+offset,.67,.99],[.25+offset,.67,.99],[.36+offset,.85,.99],[.24+offset,.85,.99]])


class CharacterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'source.png';self.source=Image.new('RGB',(400,400),(80,120,140));self.source.save(self.path)
        points=np.array(json.loads((ROOT/'tests/fixtures/makeup-landmarks.json').read_text()),np.float32)
        points=(points-points.min(axis=0))/np.maximum(1,points.max(axis=0)-points.min(axis=0))*[55,65]+[98,53];self.faces=[points,points+[160,0]]
        self.raw=[dict(box=[60,30,180,360],keypoints=(skeleton()*[400,400,1]).tolist()),dict(box=[220,30,340,360],keypoints=(skeleton(.4)*[400,400,1]).tolist())]
        self.events=[];self.cancel=False
        def active(_):
            if self.cancel:raise RuntimeError('Đã hủy')
        self.env=dict(ROOT=self.root,OUTPUTS=self.root/'outputs',JOBS_DIR=self.root/'jobs',safe_sample=lambda _:self.path,character_landmarks=lambda *a:self.faces,detect_people_pose=lambda _:self.raw,update_job=lambda *a,**k:self.events.append(k),ensure_job_active=active,persist_job_request=Mock(),character_configuration=lambda _:dict(faceReady=True,bodyReady=True))
        def generated(*args):
            for _ in range(args[2]['count']):yield Image.new('RGB',self.source.size,'white')
        self.env['character_face']=generated
        self.body=dict(sampleId='source',sourceSha256=hashlib.sha256(self.path.read_bytes()).hexdigest(),mode='face',expression='smile',personIds=[0],count=2,jobId='test')
    def tearDown(self):self.tmp.cleanup()
    def run_case(self,**changes):
        body={**self.body,**changes};plan=c.plan(body,self.env);body.update(planHash=plan['planHash'],targetPoses=plan['targetPoses']);return c.run(body,self.env)
    def test_selection_and_ranges(self):
        for change in [dict(personIds=[0,0]),dict(personIds=[[]]),dict(personIds=[True]),dict(personIds=[]),dict(mode='unknown'),dict(yaw=25),dict(gazeX=float('nan')),dict(seed=True),dict(count=5),dict(mode='interaction',pose='handshake',personIds=[0]),dict(mode='face',pose='handshake',personIds=[0,1])]:
            with self.subTest(change=change),self.assertRaises(ValueError):g.options({**self.body,**change})
    def test_stale_inputs_rejected(self):
        for changes in [dict(sourceSha256='old'),dict(description='mới',plannedDescription='cũ'),dict(personIds=[8])]:
            with self.assertRaises(ValueError):c.plan({**self.body,**changes},self.env)
    def test_plan_frozen_against_protection_change(self):
        b={**self.body};p=c.plan(b,self.env);b['planHash']=p['planHash'];mask=Image.new('L',self.source.size);ImageDraw.Draw(mask).rectangle((100,70,108,90),fill=255);b['protectedDetailMask']=c.makeup.encode(mask)
        with self.assertRaisesRegex(ValueError,'Thiết lập hoặc vùng bảo vệ'):c.run(b,self.env)
    def test_exact_pixels_unselected_person_alpha_and_atomic_results(self):
        rgba=self.source.convert('RGBA');rgba.putalpha(170);rgba.save(self.path);self.body['sourceSha256']=hashlib.sha256(self.path.read_bytes()).hexdigest()
        protection=Image.new('L',self.source.size);ImageDraw.Draw(protection).rectangle((110,70,120,85),fill=255)
        result=self.run_case(protectedDetailMask=c.makeup.encode(protection));self.assertEqual(len(result['results']),2);folder=self.root/result['directory'];allowed=np.array(Image.open(folder/'applied_mask.png'))>0
        for item in result['results']:
            pixels=np.array(Image.open(self.root/item['file']));np.testing.assert_array_equal(pixels[~allowed,:3],np.array(self.source)[~allowed]);self.assertTrue((pixels[:,:,3]==170).all());np.testing.assert_array_equal(pixels[30:360,220:340,:3],np.array(self.source)[30:360,220:340]);self.assertEqual(item['metrics']['outsideMaskMaxError'],0)
        self.assertEqual(sum('_result' in event for event in self.events),2)
        self.assertTrue((folder/'metadata.json').exists())
    def test_cancel_leaves_no_partial_published_output(self):
        def generator(*args):
            yield self.source.copy();self.cancel=True;yield self.source.copy()
        self.env['character_face']=generator
        with self.assertRaisesRegex(RuntimeError,'hủy'):self.run_case()
        self.assertFalse(list((self.root/'outputs').rglob('result*.png')));self.assertFalse(any('_result' in e for e in self.events))
    def test_model_error_leaves_no_output(self):
        self.env['character_configuration']=lambda _:dict(faceReady=False,bodyReady=True)
        with self.assertRaisesRegex(ValueError,'khuôn mặt'):self.run_case()
    def test_full_body_presets_and_missing_joint(self):
        for preset in g.POSES:
            if preset in g.INTERACTIONS:continue
            try:q=g.preset_joints(skeleton(),preset)
            except ValueError as error:self.fail(f'{preset}: {error}')
            self.assertEqual(q.shape,(17,3))
        partial=skeleton();partial[15:]=0
        self.assertEqual(g.preset_joints(partial,'wave')[15,2],0)
        with self.assertRaises(ValueError):g.preset_joints(partial,'run')
    def test_interaction_contact_and_protected_overlap(self):
        people=[dict(box=[.15,.075,.45,.9],keypoints=skeleton().tolist()),dict(box=[.55,.075,.85,.9],keypoints=skeleton(.4).tolist())]
        targets,contacts=g.interaction_targets(people,{0:skeleton(),1:skeleton(.4)},'handshake');self.assertEqual(len(contacts),2)
        np.testing.assert_allclose([contacts[0]['x'],contacts[0]['y']],[contacts[1]['x'],contacts[1]['y']])
        mask=np.array(g.allowed_mask(people,{0:skeleton()},(400,400),'body'));self.assertTrue((mask[30:360,220:340]==0).all())
    def test_target_qa_measures_target_not_original(self):
        q=g.preset_joints(skeleton(),'wave');matching=[dict(keypoints=(q*[400,400,1]).tolist())]
        score=g.pose_score({0:q},matching,(400,400));self.assertTrue(score['passed']);self.assertAlmostEqual(score['meanTargetError'],0)
        shifted=q.copy();shifted[:,:2]+=.2;self.assertFalse(g.pose_score({0:q},[dict(keypoints=(shifted*[400,400,1]).tolist())],(400,400))['passed'])
        self.assertFalse(g.pose_score({0:q,1:q},matching,(400,400))['available'])
    def test_malformed_target_and_noop_face(self):
        with self.assertRaises(ValueError):c.plan({**self.body,'targetPoses':{'1':skeleton().tolist()}},self.env)
        with self.assertRaises(ValueError):c.plan({**self.body,'expression':'keep'},self.env)
    def test_reference_hash_and_person_binding(self):
        for changes in [dict(referenceSha256='old',referencePersonId=0),dict(referenceSha256=self.body['sourceSha256'],referencePersonId=8)]:
            with self.assertRaises(ValueError):c.plan({**self.body,'referenceId':'source','useReferenceExpression':True,**changes},self.env)

    def test_body_edit_preserves_face_and_unselected_person(self):
        def generated(*args):
            for _ in range(args[5]['count']):yield Image.new('RGB',self.source.size,'white')
        self.env['character_body']=generated
        result=self.run_case(mode='body',pose='wave',expression='keep')
        pixels=np.array(Image.open(self.root/result['results'][0]['file']))
        np.testing.assert_array_equal(pixels[55:115,100:150],np.array(self.source)[55:115,100:150])
        np.testing.assert_array_equal(pixels[30:360,220:340],np.array(self.source)[30:360,220:340])
        self.assertEqual(result['results'][0]['metrics']['outsideMaskMaxError'],0)

    def test_preview_count_and_resolution_share_reviewed_geometry(self):
        plan=c.plan(self.body,self.env)
        other=c.plan({**self.body,'count':1,'preview':True,'resolution':512,'steps':16},self.env)
        self.assertEqual(plan['planHash'],other['planHash'])

    def test_disappeared_body_is_not_published(self):
        def generated(*args):
            self.env['detect_people_pose']=lambda _:[]
            yield self.source.copy()
        self.env['character_body']=generated
        with self.assertRaisesRegex(ValueError,'Không nhận diện đủ'):self.run_case(mode='body',pose='wave',expression='keep')
        self.assertFalse(list((self.root/'outputs').rglob('result*.png')))

    def test_old_fingers_are_in_editable_region(self):
        p=skeleton();q=g.preset_joints(p,'wave')
        mask=np.array(g.allowed_mask([dict(box=[.15,.075,.45,.9],keypoints=p.tolist())],{0:q},(400,400),'body',pose='wave'))
        wrist=p[10,:2]*400;tip=wrist+(wrist-p[8,:2]*400)*.6
        self.assertEqual(mask[round(tip[1]),round(tip[0])],255)

    def test_sitting_covers_old_trousers_and_new_feet(self):
        p=skeleton();q=g.preset_joints(p,'sit');person=dict(box=[.15,.075,.45,.9],keypoints=p.tolist())
        mask=np.array(g.allowed_mask([person],{0:q},(400,400),'body',pose='sit'))
        self.assertTrue((mask[210:350,61:179]>0).all())
        self.assertEqual(mask[round(q[15,1]*400),round(q[15,0]*400)+12],255)

    def test_reference_pose_adapts_to_wide_group_frame(self):
        source=skeleton();target=source.copy();target[:,0]*=.5
        transferred=g.transfer_pose(source,target)
        np.testing.assert_allclose(transferred[:,:2],target[:,:2],atol=1e-3)

    def test_small_head_drift_is_anchored_when_face_is_protected(self):
        q=g.preset_joints(skeleton(),'wave');q[:5,1]+=.007
        result=c.prepare({**self.body,'mode':'body','pose':'custom','expression':'keep','targetPoses':{'0':q.tolist()}},self.env)
        np.testing.assert_array_equal(result['targets'][0][:5],skeleton()[:5])

    def test_stationary_shirt_is_kept_but_crossing_arms_remain_editable(self):
        p=skeleton();people=[dict(keypoints=p.tolist())]
        q=g.preset_joints(p,'wave')
        kept=np.array(g.stationary_torso_mask(people,{0:q},(400,400)))
        chest=np.rint(p[[5,6,11,12],:2].mean(axis=0)*400).astype(int)
        self.assertGreater(kept.sum(),0)
        self.assertEqual(kept[chest[1],chest[0]],255)
        q[8,:2]=chest/400;q[10,:2]=chest/400+[.02,.02]
        crossing=np.array(g.stationary_torso_mask(people,{0:q},(400,400)))
        self.assertEqual(crossing[chest[1],chest[0]],0)
        q=p.copy();q[11:,1]+=.1
        self.assertFalse(np.array(g.stationary_torso_mask(people,{0:q},(400,400))).any())

    def test_nested_detections_do_not_become_a_protected_bystander(self):
        full=self.raw[0];partial={**full,'box':[65,30,180,190]}
        merged=c.merge_duplicate_people([partial,full,self.raw[1]])
        self.assertEqual(len(merged),2);self.assertEqual(merged[0]['box'],full['box'])
        self.env['detect_people_pose']=lambda _:[partial,full,self.raw[1]]
        result=c.analyze(self.body,self.env);self.assertEqual(len(result['people']),2)
        self.assertTrue(c.plan(self.body,self.env)['ok'])

    def test_anatomical_left_hand_and_independent_people(self):
        p=skeleton();left=g.preset_joints(p,'wave','left');right=g.preset_joints(p,'wave','right')
        np.testing.assert_array_equal(left[[8,10]],p[[8,10]]);np.testing.assert_array_equal(right[[7,9]],p[[7,9]])
        both=g.preset_joints(p,'wave','both');self.assertFalse(np.array_equal(both[[7,9]],p[[7,9]]))
        body={**self.body,'mode':'body','pose':'keep','expression':'keep','personIds':[0,1],'perPerson':{'0':{'pose':'wave','handSide':'right'},'1':{'pose':'hands_hips','expression':'smile'}}}
        prepared=c.prepare(body,self.env)
        np.testing.assert_allclose(prepared['targets'][0],g.preset_joints(skeleton(),'wave'))
        np.testing.assert_allclose(prepared['targets'][1],g.preset_joints(skeleton(.4),'hands_hips'))
        self.assertFalse(np.array(prepared['allowed'])[80,120]>0);self.assertTrue(np.array(prepared['allowed'])[80,280]>0)

    def test_expression_only_person_does_not_regenerate_their_hands(self):
        body={**self.body,'mode':'body','pose':'keep','expression':'keep','personIds':[0,1],'perPerson':{'0':{'pose':'wave'},'1':{'expression':'smile'}}}
        prepared=c.prepare(body,self.env);mask=np.array(prepared['allowed'])
        for wrist in (9,10):
            x,y=np.rint(skeleton(.4)[wrist,:2]*400).astype(int);self.assertEqual(mask[y,x],0)
        face_only=c.prepare({**self.body,'mode':'body','pose':'keep'},self.env)
        self.assertTrue(face_only['allowed'].getbbox())

    def test_hand_controls_validate_and_bind_to_plan(self):
        from character_controls import hand_targets,person
        for bad in [{'2':{}},{'0':{'hands':{'middle':{}}}},{'0':{'hands':{'left':{'fingers':[0]}}}},{'0':{'hands':{'right':{'rotation':91}}}},{'0':{'expression':'evil'}}]:
            with self.assertRaises(ValueError):g.options({**self.body,'perPerson':bad})
        body={**self.body,'mode':'body','pose':'wave','expression':'keep','perPerson':{'0':{'hands':{'right':{'gesture':'custom','fingers':[0,0,1,1,1]}}}}}
        plan=c.plan(body,self.env);self.assertEqual(len(plan['handTargets']['0']['right']),21)
        body['perPerson']['0']['hands']['right']['fingers'][1]=1
        self.assertNotEqual(plan['planHash'],c.plan(body,self.env)['planHash'])

    def test_hand_at_image_boundary_is_rejected_instead_of_clipped(self):
        from character_controls import hand_targets
        p=skeleton();p[9]=[.5,.005,1];p[7]=[.5,.2,1]
        with self.assertRaisesRegex(ValueError,'Bàn tay vượt'):hand_targets(p,dict(pose='wave',handSide='left'),(400,400))

    def test_retry_single_variant_retains_offset_and_original_files(self):
        from character_workflow import regenerate
        result=self.run_case();item=result['results'][1];path=self.root/item['file'];before=path.read_bytes()
        replay=regenerate({'file':item['file'],'jobId':'retry'},self.env)
        self.assertEqual(len(replay['results']),1);self.assertEqual(replay['results'][0]['variantIndex'],1)
        self.assertEqual(replay['results'][0]['parentFile'],item['file']);self.assertEqual(path.read_bytes(),before)
        self.assertNotEqual(replay['results'][0]['file'],item['file'])
        with self.assertRaises(ValueError):regenerate({'file':'source.png'},self.env)
        self.path.write_bytes(b'changed')
        with self.assertRaises(Exception):regenerate({'file':item['file']},self.env)

    def test_garment_recovery_and_boundary_preserve_protected_pixels(self):
        import character_quality as quality
        p=skeleton();people=[dict(box=[.1,.05,.5,.95],keypoints=p.tolist())]
        source=Image.new('RGB',(400,400),(40,100,190));generated=Image.new('RGB',(400,400),(50,40,40))
        mask=Image.new('L',(400,400));ImageDraw.Draw(mask).rectangle((50,90,180,200),fill=255)
        parser=lambda image:(np.full((image.height,image.width),4,np.uint8),np.ones((image.height,image.width),bool))
        result,metrics=quality.recover(source,generated,people,{0:p},mask,self.root,.8,parser)
        allowed=np.array(mask)>0;np.testing.assert_array_equal(np.array(result)[~allowed],np.array(source)[~allowed])
        record=metrics['people'][0];self.assertGreater(record['recoveredPixels'],0);self.assertLess(record['colorDistanceAfter'],record['colorDistanceBefore'])
        matched=quality.match_boundary(source,result,mask);np.testing.assert_array_equal(np.array(matched)[~allowed],np.array(source)[~allowed])

if __name__=='__main__':unittest.main()
