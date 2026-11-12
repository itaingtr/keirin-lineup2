from datetime import date,timedelta
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from ten_meetings import collect,parse_profile,profile_url,check_profile_url
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
        result=collect([race,race],'2026-11-12',read,client)
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
