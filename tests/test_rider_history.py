from copy import deepcopy
from datetime import date,timedelta
import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from rider_history import ensure,read_index,save_player,read_player,context,load_snapshot,hydrate,refresh_subset,apply_official,merge_meetings,encode
from previous_daily import ensure_daily
from rider_history_worker import collect_batch

def card_for(day='20261113',start='20261113',players=1):
    offset=(date.fromisoformat(day[:4]+'-'+day[4:6]+'-'+day[6:])-date.fromisoformat(start[:4]+'-'+start[4:6]+'-'+start[6:])).days+1
    people=[{'no':n,'name':'選手'+str(n),'period':100+n,'playerId':'01510'+str(n)} for n in range(1,players+1)]
    races=[{'source':'https://keirin.kdreams.jp/takeo/racedetail/84'+start+f'{offset:02}'+'0006/', 'players':people}]
    return {'target_date':day[:4]+'-'+day[4:6]+'-'+day[6:],'html':'const races='+json.dumps(races,ensure_ascii=False)+';\nconst body='},races

def meeting(start,index=0,provider='keirin.jp'):
    first=date.fromisoformat(start);days=[]
    for i in range(3):
        actual=(first+timedelta(days=i)).isoformat();raw=actual.replace('-','')
        days.append({'race_date':actual,'race_id':'0627'+raw,'race_number':6,'order':(i+index)%7+1,'accident':'',
                     'race_type':'S級予選','race_date_inferred':False,
                     'video_url':'https://keirin.kdreams.jp/stadium/digest/?kyogijoCd=27&kaisaiDate='+raw+'&gradeCd=2&raceNo=6'})
    return {'venue':'京王閣','venue_code':'27','grade_code':2,'start_date':start,'provider':provider,'days':days}

def histories():return [meeting((date(2026,8,1)+timedelta(days=i*8)).isoformat(),i) for i in range(10)]

def recent(site,card,races,groups,run='run-100-1'):
    data={'schema_version':1,'provider':'kdreams','target_date':card['target_date'],'races':[
        {'source_url':r['source'],'players':[{'no':p['no'],'name':p['name'],'period':p['period'],'player_id':p['playerId'],'meetings':deepcopy(groups)} for p in r['players']]} for r in races]}
    return ensure_daily(card,races,run,site,collector=lambda *_:data)

def prime(site,races):
    index=read_index(site)
    for r in races:
        for p in r['players']:save_player(site,index,p,histories(),checked=[context(r)])
    (site/'rider-history/current.json').write_text(encode(index))

class SharedRiderHistoryTests(unittest.TestCase):
    def test_same_meeting_on_next_day_reuses_exact_immutable_player_files(self):
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder);card,races=card_for();prime(site,races);recent(site,card,races,[])
            first=ensure(site,card,races,'run-101-1');self.assertEqual(first['pending'],0)
            snapshot=load_snapshot(site,'20261113',card['html']);ref=snapshot['races'][0]['players'][0]['history_ref']
            before={p:p.read_bytes() for p in (site/'rider-history').rglob('*.json')}
            again=ensure(site,card,races,'run-102-1');self.assertFalse(again['changed'])
            newer,members=card_for('20261114','20261113');recent(site,newer,members,[],run='run-103-1')
            result=ensure(site,newer,members,'run-104-1');self.assertEqual(result['pending'],0)
            self.assertEqual(load_snapshot(site,'20261114',newer['html'])['races'][0]['players'][0]['history_ref'],ref)
            self.assertEqual(before,{p:p.read_bytes() for p in (site/'rider-history').rglob('*.json')})
            with patch('rider_history_worker.collect',side_effect=AssertionError('No source reads allowed')):
                self.assertIsNone(collect_batch(site,newer,members)['data'])

    def test_new_meeting_appends_result_once_and_keeps_old_date_references(self):
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder);card,races=card_for();prime(site,races);recent(site,card,races,[]);ensure(site,card,races,'run-101-1')
            old=load_snapshot(site,'20261113',card['html']);old_ref=old['races'][0]['players'][0]['history_ref'];old_bytes=(site/old_ref['path']).read_bytes()
            newer,members=card_for('20261121','20261121');new_group=meeting('2026-11-18',provider='kdreams')
            recent(site,newer,members,[new_group],run='run-102-1')
            result=ensure(site,newer,members,'run-103-1');self.assertEqual(result['pending'],1)
            full=hydrate(site,load_snapshot(site,'20261121',newer['html']),newer['html'])
            groups=full['races'][0]['players'][0]['meetings'];self.assertEqual(len(groups),10)
            self.assertEqual(groups[-1]['start_date'],'2026-11-18');self.assertEqual(groups[-1]['provider'],'kdreams')
            self.assertEqual(groups[0]['start_date'],histories()[1]['start_date'])
            self.assertEqual((site/old_ref['path']).read_bytes(),old_bytes)
            self.assertEqual(load_snapshot(site,'20261113',card['html']),old)
            official=deepcopy(full);official['provider']='keirin.jp'
            for g in official['races'][0]['players'][0]['meetings']:g['provider']='keirin.jp'
            apply_official(site,official,members)
            ensure(site,newer,members,'run-104-1');self.assertEqual(refresh_subset(site,members),[])
            self.assertEqual(hydrate(site,load_snapshot(site,'20261121',newer['html']),newer['html'])['races'][0]['players'][0]['meetings'][-1]['provider'],'keirin.jp')

    def test_only_an_unregistered_rider_is_queued_for_official_profile_refresh(self):
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder);card,races=card_for();prime(site,races)
            card,members=card_for(players=2);recent(site,card,members,[meeting('2026-11-01')])
            result=ensure(site,card,members,'run-101-1');self.assertEqual(result['pending'],1)
            subset=refresh_subset(site,members)
            self.assertEqual([p['playerId'] for p in subset[0]['players']],['015102'])
            full=hydrate(site,load_snapshot(site,'20261113',card['html']),card['html'])
            self.assertEqual(len(full['races'][0]['players'][0]['meetings']),10)
            self.assertEqual(len(full['races'][0]['players'][1]['meetings']),1)

    def test_rider_identity_mismatch_never_reuses_another_named_history(self):
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder);card,races=card_for();prime(site,races)
            members=deepcopy(races);members[0]['players'][0]['name']='変更名'
            card['html']='const races='+json.dumps(members,ensure_ascii=False)+';\nconst body='
            recent(site,card,members,[]);ensure(site,card,members,'run-101-1')
            full=hydrate(site,load_snapshot(site,'20261113',card['html']),card['html'])
            self.assertEqual(full['races'][0]['players'][0]['meetings'],[])
            self.assertEqual(len(refresh_subset(site,members)[0]['players']),1)

    def test_checksum_damage_stops_a_new_snapshot_without_overwriting_saved_versions(self):
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder);card,races=card_for();prime(site,races);recent(site,card,races,[]);ensure(site,card,races,'run-101-1')
            pointer=site/'ten-daily/20261113/latest.json';before=pointer.read_bytes()
            record=read_index(site)['players']['015101'];file=site/record['path'];file.write_bytes(file.read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError,'checksum'):ensure(site,card,races,'run-102-1')
            self.assertEqual(pointer.read_bytes(),before)

    def test_identical_known_meeting_does_not_duplicate_or_downgrade_official_data(self):
        groups=histories();duplicate=deepcopy(groups[-1]);duplicate['provider']='kdreams'
        self.assertEqual(merge_meetings(groups,[duplicate]),groups)

    def test_partial_placing_correction_keeps_the_other_checked_starts(self):
        groups=histories();groups[-1]['days'][0]['race_type']='S級初日特選'
        groups[-1]['days'][0]['highlight_rank']=True
        partial=deepcopy(groups[-1]);partial['provider']='kdreams';partial['days']=partial['days'][:1]
        partial['days'][0].update(order=7,race_type='')
        del partial['days'][0]['highlight_rank']
        merged=merge_meetings(groups,[partial])
        self.assertEqual(len(merged[-1]['days']),3)
        self.assertEqual(merged[-1]['days'][1:],groups[-1]['days'][1:])
        self.assertEqual(merged[-1]['days'][0]['order'],7)
        self.assertEqual(merged[-1]['days'][0]['race_type'],'S級初日特選')
        self.assertTrue(merged[-1]['days'][0]['highlight_rank'])

if __name__=='__main__':unittest.main()
