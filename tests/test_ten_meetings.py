from datetime import date,timedelta
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import unittest
import tempfile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from ten_meetings import collect,parse_profile,profile_url,check_profile_url,validate_timeline,repair_high_grades
from source_http import Document

STAMP='2026-11-12T05:00:00+00:00'
PLAYER={'no':1,'name':'確認選手','period':82,'playerId':'013497'}
SOURCE='https://keirin.kdreams.jp/takeo/racedetail/8420261112010006/'


def meeting(start,label='武Ｆ１',ranks=(2,3,1),supplement=False):
    records=''
    for index,rank in enumerate(ranks):
        if rank is None:records+='<td>2補</td>' if supplement else '<td></td>'
        else:
            records+='<td><div onclick="rbTyokinResultClick(\'public-nav-placeholder\',\'opaque-navigation-placeholder\',\'public-display\')"><p class="imgbadge_s4" title="'+str(rank)+'" style="background-image:url(\'/pc/static/img/icon/print/setP-normal-'+str(rank)+'.png\')"></p></div></td>'
    return '<table class="seiseki_kobetsu"><tr><td>'+start.strftime('%m/%d')+'</td><td>'+label+'</td></tr><tr>'+records+'</tr></table>'


def page(items,name='確認選手',identifier='013497',period=82):
    return '<table><tr><td>氏名</td><td>登録番号</td></tr><tr><td>'+name+'</td><td>'+identifier+'</td></tr><tr><td>期別</td></tr><tr><td>'+str(period)+'期</td></tr></table><table><tr><td>直近1</td></tr><tr><td>'+''.join(items)+'</td></tr></table>'


class Client:
    def __init__(self,missing=False,wrong_name=False):
        self.calls=[];self.receipts=[];self.missing=missing;self.wrong_name=wrong_name
    def cards(self,code,raw):
        self.calls.append((code,raw))
        if self.missing:raise ValueError('Public official entries unavailable')
        return {9:{'race_type':'S級準決勝','players':{1:{'player_id':'013497','name':'別人' if self.wrong_name else '確認選手','period':82}}}},STAMP


class TenMeetingsTests(unittest.TestCase):
    def test_known_unchanged_meetings_skip_all_historical_entry_reads(self):
        html=page([meeting(date(2026,11,1))]);race={'source':SOURCE,'players':[PLAYER]}
        read=lambda *_:(Document(html).root,STAMP)
        initial=collect([race],'2026-11-12',read,Client())
        known={'013497':initial['races'][0]['players'][0]['meetings']}
        client=Client();result=collect([race],'2026-11-12',read,client,known=known)
        self.assertEqual(client.calls,[])
        self.assertEqual(result['races'][0]['players'][0]['meetings'],known['013497'])

    def test_only_a_new_meeting_reads_historical_entries(self):
        race={'source':SOURCE,'players':[PLAYER]}
        initial=collect([race],'2026-11-12',lambda *_:(Document(page([meeting(date(2026,10,1))])).root,STAMP),Client())
        known={'013497':initial['races'][0]['players'][0]['meetings']}
        client=Client();html=page([meeting(date(2026,11,1)),meeting(date(2026,10,1))])
        result=collect([race],'2026-11-12',lambda *_:(Document(html).root,STAMP),client,known=known)
        self.assertEqual(client.calls,[('84','20261101'),('84','20261102'),('84','20261103')])
        self.assertEqual(result['races'][0]['players'][0]['meetings'][0],known['013497'][0])

    def test_verified_high_grade_cache_skips_all_six_calendar_reads(self):
        race={'source':SOURCE,'players':[PLAYER]};html=page([meeting(date(2026,11,1),'岸Ｇ１',ranks=(1,2,3,4,5))])
        read=lambda *_:(Document(html).root,STAMP)
        initial=collect([race],'2026-11-12',read,self.high_client())
        known={'013497':initial['races'][0]['players'][0]['meetings']}
        self.assertTrue(known['013497'][0]['calendar_sequence_verified'])
        client=self.high_client();result=collect([race],'2026-11-12',read,client,known=known)
        self.assertEqual(client.calls,[])
        self.assertEqual(result['races'][0]['players'][0]['meetings'],known['013497'])

    def test_supplementary_meeting_schedule_can_overlap_previous_actual_rides(self):
        html=page([meeting(date(2026,11,3),ranks=(None,None,4)),meeting(date(2026,11,1))])
        history=parse_profile(html,PLAYER,date(2026,11,12))
        validate_timeline(history,date(2026,11,12))
        self.assertEqual(history[0]['days'][-1]['race_date'],'2026-11-03')
        self.assertEqual(history[1]['days'][0]['race_date'],'2026-11-05')

    def high_fixture(self):
        days=[{'race_date':(date(2026,11,1)+timedelta(days=i)).isoformat(),'meeting_day':i+1,
               'player_id':'013497','order':i+1,'accident':'','race_id':'old-wrong-date',
               'race_number':9,'race_type':'old-type','video_url':'old-wrong-link','highlight_rank':True}
              for i in range(5)]
        meetings=[{'venue':'武雄','venue_code':'84','grade_code':2,'start_date':'2026-10-01',
                   'days':[{'order':3,'race_date':'2026-10-01','video_url':'preserve-low-grade-display'}]},
                  {'venue':'岸和田','venue_code':'56','grade_code':5,'start_date':'2026-11-01','days':days}]
        data={'schema_version':1,'provider':'keirin.jp','target_date':'2026-11-12','sources':[],
              'races':[{'source_url':SOURCE,'players':[{'no':1,'name':'確認選手','period':82,'player_id':'013497','meetings':meetings}]}]}
        return data,[{'source':SOURCE,'players':[PLAYER]}]

    def high_client(self,missing_last=False):
        class Historical:
            def __init__(self):self.calls=[];self.receipts=[]
            def cards(self,code,raw):
                self.calls.append((code,raw));day=int(raw[-2:])
                member={'player_id':'013497','name':'確認選手','period':82,'absent':day==2}
                if missing_last and day==6:return {1:{'race_type':'S級一般','players':{}}},STAMP
                kind='S級初日特選' if day==1 else 'S級準決勝' if day==5 else 'S級決勝' if day==6 else 'S級一般'
                return {day:{'race_type':kind,'players':{1:member}}},STAMP
        return Historical()

    def test_high_grade_rest_day_repairs_rank_sequence_to_real_participation_dates(self):
        data,races=self.high_fixture();before=deepcopy(data);client=self.high_client()
        repaired=repair_high_grades(data,races,'2026-11-12',client)
        meetings=repaired['races'][0]['players'][0]['meetings'];high=meetings[1]
        self.assertEqual(data,before,'The old saved display data remains immutable')
        self.assertEqual(meetings[0],before['races'][0]['players'][0]['meetings'][0])
        self.assertTrue(high['calendar_sequence_verified'])
        self.assertEqual([d['order'] for d in high['days']],[1,2,3,4,5])
        self.assertEqual([d['race_date'] for d in high['days']],['2026-11-01','2026-11-03','2026-11-04','2026-11-05','2026-11-06'])
        self.assertEqual([d['meeting_day'] for d in high['days']],[1,3,4,5,6])
        self.assertEqual(high['days'][1]['race_id'],'035620261103')
        self.assertIn('kaisaiDate=20261103',high['days'][1]['video_url'])
        self.assertIn('raceNo=3',high['days'][1]['video_url'])
        self.assertTrue(high['days'][-2]['semifinal_rank']);self.assertTrue(high['days'][-1]['highlight_rank'])
        self.assertEqual(len(client.calls),6)

    def test_high_grade_incomplete_calendar_removes_all_old_guessed_links(self):
        data,races=self.high_fixture()
        repaired=repair_high_grades(data,races,'2026-11-12',self.high_client(missing_last=True))
        high=repaired['races'][0]['players'][0]['meetings'][1]
        self.assertFalse(high['calendar_sequence_verified'])
        self.assertEqual([d['order'] for d in high['days']],[1,2,3,4,5])
        for record in high['days']:
            self.assertIsNone(record['video_url']);self.assertIsNone(record['race_id']);self.assertIsNone(record['race_number'])
            self.assertEqual(record['race_type'],'');self.assertTrue(record['race_date_inferred'])
            self.assertNotIn('highlight_rank',record);self.assertNotIn('semifinal_rank',record)

    def test_high_grade_repair_requires_the_full_current_rider_identity(self):
        data,races=self.high_fixture();data['races'][0]['players'][0]['player_id']='999999'
        client=self.high_client()
        with self.assertRaisesRegex(ValueError,'full rider identity'):
            repair_high_grades(data,races,'2026-11-12',client)
        self.assertEqual(client.calls,[])

    def test_source_cursor_unwraps_several_calendar_years(self):
        dates=[date(2026,10,1),date(2026,1,10),date(2025,12,1),date(2025,1,10),date(2024,12,1)]
        result=parse_profile(page([meeting(day) for day in dates]),PLAYER,date(2026,11,12))
        self.assertEqual([m['start_date'] for m in result],[day.isoformat() for day in reversed(dates)])
        validate_timeline(result,date(2026,11,12))

    def test_timeline_failure_is_checkpointed_before_any_entry_join(self):
        # Source has two calendar-overlapping meetings. This must be diagnosed
        # before potentially thousands of historical source requests.
        html=page([meeting(date(2026,11,3)),meeting(date(2026,11,1))]);client=Client()
        with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'TEN_CHECKPOINT_DIR':folder}):
            with self.assertRaisesRegex(ValueError,'chronology differs'):
                collect([{'source':SOURCE,'players':[PLAYER]}],'2026-11-12',lambda *_:(Document(html).root,STAMP),client)
            checkpoint=json.loads((Path(folder)/'profiles.json').read_text())
            self.assertEqual(len(checkpoint['profiles']),1)
            self.assertIn('2026-11-03',checkpoint['errors'][0]);self.assertEqual(client.calls,[])
            self.assertNotIn('opaque-navigation-placeholder',json.dumps(checkpoint))

    def test_wrapped_official_g1_keeps_fifth_and_sixth_calendar_days(self):
        for ranks in ((1,2,3,4,5),(1,None,3,4,5,6)):
            html=meeting(date(2026,6,16),'岸Ｇ１',ranks=ranks)
            # Observed source layout: firstfourdaycells occupy one row;
            # the fifth/sixth calendar slots continue in the next row.
            marker=html.index('</tr><tr>')+len('</tr><tr>')
            pieces=html[marker:html.rindex('</tr></table>')].split('</td>')
            split='</td>'.join(pieces[:4])+'</td></tr><tr>'+'</td>'.join(pieces[4:])
            html=html[:marker]+split+'</tr></table>'
            result=parse_profile(page([html]),PLAYER,date(2026,11,12))[0]
            expected=[index+1 for index,value in enumerate(ranks) if value is not None]
            self.assertEqual([row['meeting_day'] for row in result['days']],expected)
            self.assertEqual([row['order'] for row in result['days']],[value for value in ranks if value is not None])
            self.assertEqual(result['days'][-1]['race_date'],(date(2026,6,16)+timedelta(days=len(ranks)-1)).isoformat())

    def test_observed_disqualification_articles_and_unconfirmed_cells(self):
        for article in (11,13,14,15,16):
            label='失格'+str(article)+'条'
            result=parse_profile(page([meeting(date(2026,11,1),'園Ｇ３',ranks=('未',label,'途中欠場','事故棄権'))]),
                                 PLAYER,date(2026,11,12))[0]
            self.assertEqual(result['venue_options'],('26',));self.assertEqual(result['grade_code'],3)
            self.assertEqual([row['meeting_day'] for row in result['days']],[2,4])
            self.assertEqual([row['accident'] for row in result['days']],['失','棄'])
            self.assertEqual(result['days'][0]['accident_name'],label)
            self.assertTrue(result['withdrawn'])
            self.assertTrue(all(row['order']==0 for row in result['days']))

    def test_profile_format_errors_are_batched_before_any_historical_entry_request(self):
        first=dict(PLAYER)
        second=dict(PLAYER,no=2,playerId='013498')
        calls=[];client=Client()
        def read(url):
            calls.append(url);identifier=url.rsplit('=',1)[-1]
            html=page([meeting(date(2026,11,1),ranks=('未確認','未確認',1))],identifier=identifier)
            return Document(html).root,STAMP
        with self.assertRaises(ValueError) as raised:
            collect([{'source':SOURCE,'players':[first,second]}],'2026-11-12',read,client)
        message=str(raised.exception)
        self.assertIn('JKA 013497',message);self.assertIn('JKA 013498',message)
        self.assertIn("rank label: '未確認'",message)
        self.assertEqual(len(calls),2)
        self.assertEqual(client.calls,[],'No costly entry join can begin after a profile format error')

    def test_last_ten_completed_meetings_are_chronological_and_keep_five_starts(self):
        before=date(2026,11,12)
        entries=[meeting(before)]+[meeting(before-timedelta(days=5*i),ranks=(1,2,3,4,5) if i==3 else (1,2,3)) for i in range(1,13)]
        results=parse_profile(Document(page(entries)).root,PLAYER,before)
        self.assertEqual(len(results),10)
        self.assertEqual(results[0]['start_date'],(before-timedelta(days=50)).isoformat())
        self.assertEqual(results[-1]['start_date'],(before-timedelta(days=5)).isoformat())
        self.assertEqual(max(len(row['days']) for row in results),5)
        self.assertEqual([row['start_date'] for row in results],sorted(row['start_date'] for row in results))

    def test_supplementary_entry_uses_real_calendar_column_not_result_ordinal(self):
        html=page([meeting(date(2026,11,1),ranks=(None,2,6,None),supplement=True)])
        result=parse_profile(html,PLAYER,date(2026,11,12))[0]
        self.assertEqual([row['race_date'] for row in result['days']],['2026-11-02','2026-11-03'])
        self.assertEqual([row['meeting_day'] for row in result['days']],[2,3])
        self.assertEqual([row['order'] for row in result['days']],[2,6])

    def test_wrong_registration_name_or_period_rejects_entire_profile(self):
        for kwargs in ({'name':'別人'},{'identifier':'999999'},{'period':83}):
            with self.subTest(kwargs=kwargs),self.assertRaisesRegex(ValueError,'name/registration/period'):
                parse_profile(page([meeting(date(2026,11,1))],**kwargs),PLAYER,date(2026,11,12))

    def test_exact_entry_join_builds_valid_rakuten_links_and_drops_navigation_data(self):
        html=page([meeting(date(2026,11,1))]);client=Client();calls=[]
        def read(url):calls.append(url);return Document(html).root,STAMP
        race={'source':SOURCE,'players':[PLAYER]}
        result=collect([race],'2026-11-12',read,client)
        self.assertEqual(calls,[profile_url('013497')]);self.assertEqual(len(client.calls),3)
        actual=result['races'][0]['players'][0]['meetings'][0]
        self.assertEqual((actual['venue'],actual['venue_code'],actual['grade_code']),('武雄','84',2))
        row=actual['days'][0]
        self.assertEqual(row['race_id'],'098420261101');self.assertEqual(row['race_number'],9)
        self.assertEqual(row['race_type'],'S級準決勝');self.assertTrue(row['semifinal_rank'])
        self.assertFalse(row['highlight_rank']);self.assertFalse(row['race_date_inferred'])
        self.assertIn('kaisaiDate=20261101',row['video_url']);self.assertIn('raceNo=9',row['video_url'])
        self.assertEqual(result['provider'],'keirin.jp')
        self.assertNotIn('opaque-navigation-placeholder',json.dumps(result))
        self.assertNotIn('rbTyokinResultClick',json.dumps(result))

    def test_unavailable_entry_never_invents_race_number_or_digest_link(self):
        result=collect([{'source':SOURCE,'players':[PLAYER]}],'2026-11-12',
                       lambda *_:(Document(page([meeting(date(2026,11,1))])).root,STAMP),Client(missing=True))
        rows=result['races'][0]['players'][0]['meetings'][0]['days']
        self.assertEqual([row['order'] for row in rows],[2,3,1])
        self.assertTrue(all(row['race_number'] is None and row['race_id'] is None and row['video_url'] is None for row in rows))

    def test_historical_entry_identity_disagreement_fails_instead_of_linking_another_rider(self):
        with self.assertRaisesRegex(ValueError,'name/period differs'):
            collect([{'source':SOURCE,'players':[PLAYER]}],'2026-11-12',
                    lambda *_:(Document(page([meeting(date(2026,11,1))])).root,STAMP),Client(wrong_name=True))

    def test_month_year_boundary_and_grade_code_are_preserved(self):
        rows=parse_profile(page([meeting(date(2025,12,28),'倉Ｇ１',ranks=(1,2,3,4,5))]),PLAYER,date(2026,1,5))
        self.assertEqual(rows[0]['start_date'],'2025-12-28');self.assertEqual(rows[0]['grade_code'],5)
        self.assertEqual(rows[0]['days'][-1]['race_date'],'2026-01-01')

    def test_profile_url_rejects_other_hosts_opaque_queries_and_invalid_id(self):
        for url in ('https://example.com/pc/racerprofile?snum=013497','https://keirin.jp/pc/json?encp=opaque',
                    'https://keirin.jp/pc/racerprofile?snum=013497&snum=013498'):
            with self.assertRaises(ValueError):check_profile_url(url)
        with self.assertRaises(ValueError):profile_url('13497')


if __name__=='__main__':unittest.main()
