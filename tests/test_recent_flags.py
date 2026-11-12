from copy import deepcopy
from datetime import datetime,timedelta,timezone
import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from recent_flags import collect_day,apply,enrich,pending,read_index,read_record,validate_record
from keirin_jp_provider import parse_cards,parse_results
from test_kdreams_history import result_page,K,J
from source_http import Document
from previous_daily import ensure_daily,load_daily

STAMP='2026-11-04T07:21:49+00:00'
IDENTIFIER='124520261103'

class Official:
    def cards(self,code,raw):
        return parse_cards({'raceInfo':[{'raceNo':'12','shumokuName':'Ｓ級準決勝','sensyuTypeInfo':J['previous']['players']}]}),STAMP
    def results(self,code,raw,number,start,entries,**kwargs):
        data=parse_results({'tyakujyunItemSubData':J['result']},code,raw,number,start,entries,**kwargs)
        for r in data.values():r['observed_at']=STAMP
        return data

def read(url):
    if '/racecard/' in url:
        return Document('<div class="raceinfo_table"><table><tr><td>豊橋</td><td class="gr2"><a href="'+K['source_url'].split('?')[0]+'">12R</a></td></tr></table></div>').root,STAMP
    return Document(result_page()).root,STAMP

def record():
    records,errors=collect_day('20261103',[IDENTIFIER],{},Official,read)
    assert not errors,errors
    return records[0]

def display():
    p={'no':1,'name':'雨谷一樹','period':96,'player_id':'014505','meetings':[{'days':[
        {'player_id':'014505','race_id':IDENTIFIER,'race_date':'2026-11-03','race_number':12,
         'order':2,'accident':'','final_half_record':'11.0','start':None,'home':None,'back':None}]}]}
    return {'schema_version':1,'provider':'kdreams','target_date':'2026-11-13','races':[{'source_url':'https://keirin.kdreams.jp/takeo/racedetail/8420261113010006/','players':[p]}]}

class RecentFlagsTests(unittest.TestCase):
    def test_real_official_hb_and_independent_k_s_are_matched(self):
        data=record();people={p['player_id']:p for p in data['players']}
        self.assertEqual(tuple(people['014505'][f] for f in ('start','home','back')),(True,False,False))
        self.assertEqual(tuple(people['015744'][f] for f in ('start','home','back')),(False,True,True))
        self.assertEqual(people['015744']['flag_sources']['back']['provider'],'keirin.jp')
        self.assertEqual(people['014505']['flag_sources']['start']['provider'],'kdreams')

    def test_race_cache_reuse_has_no_source_reads_and_keeps_prior_versions(self):
        with tempfile.TemporaryDirectory() as root:
            data=record();apply(root,{'records':[data]});entry=deepcopy(read_index(root)['races'][IDENTIFIER])
            before=(Path(root)/entry['path']).read_bytes();source=display();saved=deepcopy(source)
            merged=enrich(source,root);self.assertEqual(source,saved)
            day=merged['races'][0]['players'][0]['meetings'][0]['days'][0]
            self.assertEqual((day['start'],day['home'],day['back']),(True,False,False))
            self.assertEqual(pending(source,root),{})
            newer=deepcopy(data);newer['checked_at']=(datetime.fromisoformat(data['checked_at'])+timedelta(microseconds=1)).isoformat()
            apply(root,{'records':[newer]});self.assertEqual((Path(root)/entry['path']).read_bytes(),before)

    def test_wrong_identity_placing_or_time_never_gets_another_riders_flags(self):
        with tempfile.TemporaryDirectory() as root:
            apply(root,{'records':[record()]})
            for kind in ('name','period','order','final_half_record'):
                data=display();p=data['races'][0]['players'][0];day=p['meetings'][0]['days'][0]
                if kind=='name':p[kind]='別人'
                elif kind=='period':p[kind]=97
                elif kind=='order':day[kind]=3
                else:day[kind]='11.1'
                self.assertIsNone(enrich(data,root)['races'][0]['players'][0]['meetings'][0]['days'][0]['start'])

    def test_unavailable_s_stays_unknown_and_hb_remains_usable(self):
        def no_k(url):raise ValueError('Calendar unavailable')
        records,errors=collect_day('20261103',[IDENTIFIER],{},Official,no_k)
        self.assertEqual(errors,[]);self.assertTrue(all(p['start'] is None for p in records[0]['players']))
        self.assertTrue(any(p['back'] for p in records[0]['players']))
        with tempfile.TemporaryDirectory() as root:
            apply(root,{'records':records});self.assertFalse(pending(display(),root))
            later=datetime.fromisoformat(records[0]['checked_at'])+timedelta(hours=1,seconds=1)
            self.assertEqual(list(pending(display(),root,now=later)),[IDENTIFIER])

    def test_unrequested_unknown_riders_do_not_force_a_completed_riders_source_refresh(self):
        with tempfile.TemporaryDirectory() as root:
            data=record()
            for p in data['players']:
                if p['player_id']!='014505':p['start']=None;p['flag_sources'].pop('start',None)
            apply(root,{'records':[data]})
            self.assertEqual(pending(display(),root),{})

    def test_mismatched_k_rank_or_b_never_invents_s(self):
        def wrong_k(url):
            doc,stamp=read(url)
            if '/racecard/' in url:return doc,stamp
            return Document(result_page().replace('>S</td>','>SB</td>')).root,stamp
        records,errors=collect_day('20261103',[IDENTIFIER],{},Official,wrong_k)
        p=next(p for p in records[0]['players'] if p['player_id']=='014505')
        self.assertIsNone(p['start']);self.assertFalse(p['back'])

    def test_explicit_official_incident_matches_compact_accident_without_changing_display(self):
        for label,state in (('落','落滑入'),('故','事故入')):
            with tempfile.TemporaryDirectory() as root:
                data=record();actual=next(p for p in data['players'] if p['player_id']=='014505')
                data.pop('incidents_checked',None)
                source=display();day=source['races'][0]['players'][0]['meetings'][0]['days'][0]
                day.update(order=None,accident=label,final_half_record=None)
                original=deepcopy(source)
                apply(root,{'records':[data]})
                self.assertIn(IDENTIFIER,pending(source,root),'Old cache must verify the missing official incident details once')
                self.assertIsNone(enrich(source,root)['races'][0]['players'][0]['meetings'][0]['days'][0]['start'])
                data['checked_at']=(datetime.fromisoformat(data['checked_at'])+timedelta(microseconds=1)).isoformat()
                data['incidents_checked']=True;actual['incident_states']=[state]
                apply(root,{'records':[data]});merged=enrich(source,root)['races'][0]['players'][0]['meetings'][0]['days'][0]
                self.assertTrue(merged['start']);self.assertFalse(pending(source,root));self.assertEqual(source,original)
                self.assertEqual((merged['order'],merged['accident'],merged['final_half_record']),(None,label,None))

    def test_checksum_or_wrong_provenance_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            data=record();bad=deepcopy(data);bad['players'][0]['flag_sources']['back']['provider']='kdreams'
            with self.assertRaises(ValueError):validate_record(bad)
            apply(root,{'records':[data]});entry=read_index(root)['races'][IDENTIFIER]
            (Path(root)/entry['path']).write_text('{}')
            with self.assertRaisesRegex(ValueError,'checksum'):read_record(root,entry)

    def test_existing_daily_snapshot_appends_flags_without_recollecting_or_mutating_old_run(self):
        with tempfile.TemporaryDirectory() as root:
            site=Path(root);data=display();p=data['races'][0]['players'][0]
            people=[{'no':p['no'],'name':p['name'],'period':p['period'],'playerId':p['player_id']}]
            races=[{'source':data['races'][0]['source_url'],'players':people}]
            card={'target_date':'2026-11-13','html':'const races='+json.dumps(races,ensure_ascii=False)+';\nconst body='}
            first=ensure_daily(card,races,'run-101-1',site,collector=lambda *_:data)
            old=(site/first['path']).read_bytes();apply(site,{'records':[record()]})
            def no_read(*_):raise AssertionError('No history recollection allowed')
            updated=ensure_daily(card,races,'run-102-1',site,collector=no_read)
            self.assertTrue(updated['changed']);self.assertEqual((site/first['path']).read_bytes(),old)
            self.assertTrue(load_daily(site,'20261113',card['html'])['races'][0]['players'][0]['meetings'][0]['days'][0]['start'])
            self.assertFalse(ensure_daily(card,races,'run-103-1',site,collector=no_read)['changed'])

if __name__=='__main__':unittest.main()
