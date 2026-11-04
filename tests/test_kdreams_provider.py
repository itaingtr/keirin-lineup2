from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from kdreams_provider import parse_card,parse_schedule,parse_exacta,collect_cards,collect_quote,race_identity,public_structure,MissingLineup,parse_result_flags,collect_result_flags
from source_http import Document

URL='https://keirin.kdreams.jp/kochi/racedetail/7420261017020006/'
ODDS=URL+'?pageType=odds'
STAMP='2026-10-18T00:00:00+00:00'
MEETING={'venue':'高知','grade_code':2,'night':False}


def card(lineup=True,absent=False):
    title='<title>高知競輪 レース詳細 | テスト杯 6R Ｓ級予選 | 2026年10月18日</title>'
    header='<tr><th>直近4ヶ月の成績</th></tr><tr>'+''.join('<th>'+s+'</th>' for s in ['競走得点','S','B','逃','捲','差','マ'])+'</tr>'
    rows=''
    for n in (1,2,3):
        values=['A1','逃','3.92','101.25',str(n),'12','4','3','2','1']
        rows+='<tr'+(' class="absent"' if absent and n==3 else '')+'><td class="num">'+str(n)+'</td><td class="tip">'+('◎' if n==1 else '')+'</td><td class="rider"><a href="https://keirin.kdreams.jp/athlete/detail/01510'+str(n)+'/">選手'+str(n)+'</a>高知/30/10'+str(n)+'</td>'+''.join('<td>'+x+'</td>' for x in values)+'</tr>'
    lines='<div class="line_position"><span class="icon_p"><i class="p001"></i></span><span class="icon_p"><i class="p002"></i></span><span class="space"></span><span class="icon_p"><i class="p003"></i></span></div>' if lineup else ''
    return title+'<link rel="canonical" href="'+URL+'"><p>発走予定 15:23</p><table class="racecard_table">'+header+rows+'</table>'+lines


def matrix():
    head='<tr><th></th>'+''.join('<th class="n'+str(n)+'">'+str(n)+'</th>' for n in (1,2,3))+'</tr>'
    rows=''.join('<tr><th class="n'+str(second)+'">'+str(second)+'</th>'+''.join('<td>'+('-' if first==second else str(first*10+second+.125))+'</td>' for first in (1,2,3))+'</tr>' for second in (1,2,3))
    return '<div id="JS_ODDSCONTENTS_2shatan"><table class="odds_table">'+head+rows+'</table></div>'


def calendar():
    return '<div class="raceinfo_table"><table><tr><td>高知競輪</td><td><i class="gr2"></i><a href="'+URL+'">6R</a></td></tr></table></div>'


def result_table():
    labels=['予想','着順','車番','選手名','着差','上り','決まり手','S／B','勝敗因']
    rows='<tr>'+''.join('<th>'+value+'</th>' for value in labels)+'</tr>'
    for n,rank,flags in [(1,2,'S'),(2,1,'B'),(3,3,'')]:
        rows+='<tr>'+''.join('<td>'+value+'</td>' for value in ['',str(rank),str(n),'選手'+str(n),'','11.'+str(n),'',flags,''])+'</tr>'
    return '<table class="result_table">'+rows+'</table>'


class KdreamsProviderTests(unittest.TestCase):
    def test_venue_spellings_and_tottori_are_not_relabelled(self):
        ident=race_identity('https://keirin.kdreams.jp/iwakitaira/racedetail/1320261017010001/')
        self.assertEqual(ident['code'],'13')
        with self.assertRaises(ValueError):race_identity('https://keirin.kdreams.jp/iwakidaira/racedetail/1320261017010001/')
        parsed=parse_card(Document(card().replace('選手1</a>高知','選手1</a>鳥取')).root,URL,MEETING)
        self.assertEqual(parsed['players'][0]['name'],'選手1')

    def test_calendar_tracking_query_is_removed_before_reading(self):
        schedule=parse_schedule(Document(calendar().replace(URL,URL+'?l-id=calendar_link')).root,'https://keirin.kdreams.jp/racecard/2026/10/18/','2026-10-18')
        self.assertEqual(schedule[0]['urls'],[URL])

    def test_structural_probe_contains_no_raw_source(self):
        report=public_structure(URL,lambda url:(Document(card()+matrix()).root,STAMP))
        self.assertEqual(report['provider'],'kdreams');self.assertTrue(report['tables']);self.assertTrue(report['athlete_links'])
        self.assertNotIn('raw_html',report);self.assertEqual(report['lineups'][0]['class'],'line_position')

    def test_card_preserves_car_identity_score_marks_statistics_and_single_line(self):
        result=parse_card(Document(card(absent=True)).root,URL,MEETING)
        self.assertEqual(result['lineup'],'12/3')
        self.assertEqual(result['players'][0],{'no':1,'name':'選手1','score':101.25,'period':101,'mark':'◎','stats':[1,12,4,3,2,1],'absent':False,'meeting_results':[],'player_id':'015101','prefecture':'高知','age':30})
        self.assertTrue(result['players'][2]['absent'])
        self.assertEqual(race_identity(URL)['date'],'20261018')

    def test_title_calendar_and_rider_statistics_cannot_be_relabelled(self):
        for wrong in [card().replace('10月18日','10月19日'),card().replace('6R','7R'),card().replace('>101.25<','>欠測<'),card().replace('>S<','>H<')]:
            with self.assertRaises(ValueError):parse_card(Document(wrong).root,URL,MEETING)
        with self.assertRaises(ValueError):parse_schedule(Document(calendar()).root,'https://keirin.kdreams.jp/racecard/2026/10/19/','2026-10-19')
        with self.assertRaises(MissingLineup):parse_card(Document(card(False)).root,URL,MEETING)

    def test_known_non_s_classes_skip_before_rider_or_lineup_parsing(self):
        for kind in ('Ａ級予選','A級特選','Ｌ級予選','L級予選','ガールズ一般','チャレンジ一般'):
            markup=card(False).replace('Ｓ級予選',kind).replace('racecard_table','not_a_card')
            self.assertIsNone(parse_card(Document(markup).root,URL,MEETING))

    def test_collect_cards_never_requests_odds_and_omits_unpublished_meeting(self):
        calls=[]
        def read(url):
            calls.append(url)
            return Document(calendar() if '/racecard/' in url else card()).root,STAMP
        data=collect_cards('2026-10-18',read)
        self.assertEqual(data['provider'],'kdreams');self.assertEqual(data['expected_races'],1)
        self.assertFalse(any('pageType=odds' in url for url in calls))
        def unpublished(url):return Document(calendar() if '/racecard/' in url else card(False)).root,STAMP
        with self.assertRaises(ValueError):collect_cards('2026-10-18',unpublished)

    def test_exacta_columns_are_first_place_rows_second_and_precision_is_retained(self):
        quote=parse_exacta(Document(card()+matrix()).root,ODDS,STAMP)
        prices={(q['first'],q['second']):q['value'] for q in quote['odds']}
        self.assertEqual(prices[1,2],12.125);self.assertEqual(prices[2,1],21.125)
        self.assertEqual(quote['provider'],'kdreams');self.assertEqual(quote['parser_version'],2)
        self.assertEqual(quote['observed_at'],STAMP);self.assertEqual(len(prices),6)

    def test_invalid_or_missing_prices_stop_and_explicit_unavailable_is_not_invented(self):
        for wrong in [matrix().replace('12.125','0'),matrix().replace('12.125','不明'),matrix().replace('<td>12.125</td>','')]:
            with self.assertRaises(ValueError):parse_exacta(Document(wrong).root,ODDS,STAMP)
        missing=matrix()
        import re
        missing=re.sub(r'\d+\.125','-',missing)
        quote=parse_exacta(Document(missing).root,ODDS,STAMP)
        self.assertEqual(quote['status'],'unavailable');self.assertTrue(all(q['value'] is None for q in quote['odds']))

    def test_collect_quote_verifies_names_periods_ids_before_accepting_matrix(self):
        race=parse_card(Document(card()).root,URL,MEETING)
        def read(url):return Document(card()+matrix()).root,STAMP
        self.assertEqual(collect_quote(race,read)['rider_numbers'],[1,2,3])
        for field,value in [('name','別人'),('period',999),('player_id','015999')]:
            wrong=deepcopy(race);wrong['players'][0][field]=value
            with self.assertRaises(ValueError):collect_quote(wrong,read)

    def test_external_verified_rider_id_does_not_require_an_id_on_odds_markup(self):
        race=parse_card(Document(card()).root,URL,MEETING)
        markup=card().replace('href="https://keirin.kdreams.jp/athlete/detail/015101/"','').replace('href="https://keirin.kdreams.jp/athlete/detail/015102/"','').replace('href="https://keirin.kdreams.jp/athlete/detail/015103/"','')+matrix()
        quote=collect_quote(race,lambda url:(Document(markup).root,STAMP))
        self.assertEqual(quote['status'],'snapshot')

    def test_result_s_b_flags_match_the_source_card_rider_and_keep_observation(self):
        url=URL+'?pageType=showResult'
        report=collect_result_flags(URL,lambda requested:(Document(card()+result_table()).root,STAMP))
        self.assertEqual(report['source_url'],url);self.assertEqual(report['observed_at'],STAMP)
        self.assertEqual(report['results'][0],{'no':1,'name':'選手1','period':101,'rank':2,'agari':'11.1','s':True,'b':False,'player_id':'015101'})
        self.assertTrue(report['results'][1]['b']);self.assertFalse(report['results'][2]['s'])
        for wrong in [result_table().replace('>選手1<','>別人<'),result_table().replace('>S<','>H<'),result_table().replace('>11.1<','>不明<')]:
            with self.assertRaises(ValueError):parse_result_flags(Document(card()+wrong).root,url)


if __name__=='__main__':unittest.main()
