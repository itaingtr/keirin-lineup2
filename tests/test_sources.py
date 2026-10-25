from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from collect_sources import parse_card, parse_odds, lineup_text, daily_races, prediction_marks
from render_races import render, write_pages
from source_http import Document, check_url
from collect_media import parse_extra, parse_live, media_url

URL = 'https://www.winticket.jp/keirin/kumamoto/racecard/2026102287/1/12'
OBSERVED = '2026-10-22T05:00:00+00:00'


def fixture():
    race = {'id':'test-race', 'scheduleId':'test-schedule', 'number':12, 'class':'S級',
            'raceType3':'初特選', 'startAt':1792653840, 'entriesNumber':3, 'cancel':False}
    card = {'race':race, 'schedule':{'id':'test-schedule','cupId':'2026102287','date':'20261022','index':1},
            'cups':[{'id':'2026102287','venueId':'87','grade':3}],
            'entries':[{'number':n,'raceId':'test-race','absent':False,'playerId':str(n)} for n in (1,2,3)],
            'players':[{'id':str(n),'name':f'テスト選手{n}','term':100+n} for n in (1,2,3)],
            'records':[{'playerId':str(n),'racePoint':100.25+n,'standing':n,'back':10+n,
                        'frontRunner':n,'stalker':3,'deepCloser':2,'marker':0,'currentCupResults':[]} for n in (1,2,3)],
            'linePrediction':{'lines':[{'entries':[{'numbers':[1]},{'numbers':[2]}]}, {'entries':[{'numbers':[3]}]}]}}
    odds = {'oddsUpdatedAt':1792644000, 'exacta':[{'raceId':'test-race','type':4,'key':[a,b],
              'odds':float(a*10+b),'absent':False} for a in (1,2,3) for b in (1,2,3) if a!=b]}
    return card, odds


def doc(card, odds):
    params = {'cupId':'2026102287','index':1,'raceNumber':12}
    state = {'redux':{'user':{'loggedIn':False}}, 'tanStackQuery':{'queries':[
        {'queryKey':['keirin/race/common','FETCH_KEIRIN_RACE',params], 'state':{'status':'success','data':card}},
        {'queryKey':['keirin/race/odds','FETCH_KEIRIN_RACE_ODDS',params], 'state':{'status':'success','data':odds}}]}}
    rows = ''.join(f'<tr><td>1</td><td>{n}</td><td>{100.25+n}</td><td>{n}</td><td>{10+n}</td><td>{n}</td><td>2</td><td>3</td><td>0</td></tr>' for n in (1,2,3))
    return Document('<table><tr>'+''.join('<th>'+x+'</th>' for x in ('枠','車','競走得点','S','B','逃','捲','差','マ'))+'</tr>'+rows+'</table><script>window.__PRELOADED_STATE__ = '+json.dumps(state)+';evilFunction();</script>').root


class SourceTests(unittest.TestCase):
    def test_media_race_and_rider_identity_are_checked(self):
        c,o=fixture()
        players=[{'no':n,'name':f'テスト選手{n}'} for n in (1,2,3)]
        extra=parse_extra(doc(c,o),URL,OBSERVED,players)
        self.assertEqual(extra['digest_status'],'unpublished')
        c['race'].update(hasDigestVideo=True,digestVideoProvider=0,digestVideo='https://video.winticket.jp/keirin/digest/verified123.mp4')
        self.assertEqual(parse_extra(doc(c,o),URL,OBSERVED,players)['digest'],c['race']['digestVideo'])
        players[0]['name']='別の選手'
        with self.assertRaises(ValueError): parse_extra(doc(c,o),URL,OBSERVED,players)

    def test_live_broadcast_uses_calendar_day_on_multiday_meetings(self):
        hls='https://keirin-odawara.winticket.live/out/v1/'+'a'*32+'/index.m3u8'
        data={'channels':[{'venueId':'36','programs':[{'id':'1:venue36:2026102236:0','videoProvider':0,'hls':hls,'startAt':1,'endAt':2}]}]}
        state={'redux':{'user':{'loggedIn':False}},'tanStackQuery':{'queries':[{'queryKey':['broadcast','FETCH_BROADCAST_TIMETABLE',{'sport':0}], 'state':{'status':'success','data':data}}]}}
        page=Document('<script>window.__PRELOADED_STATE__='+json.dumps(state)+'</script>').root
        self.assertEqual(parse_live(page,'36','2026-10-22',OBSERVED)['hls'],hls)
        self.assertIsNone(parse_live(page,'36','2026-10-23',OBSERVED)['hls'])
        for url in (hls.replace('odawara','kumamoto'),hls+'?token=x',hls.replace('https:','http:')):
            with self.assertRaises(ValueError): media_url(url,slug='odawara')

    def test_ai_marks_follow_published_order_and_missing_predictions_stay_empty(self):
        self.assertEqual(prediction_marks({}, [1,2,3]), {})
        self.assertEqual(prediction_marks({'predictions':[{'isAi':True,'order':[3,1,2]}]}, [1,2,3]),
                         {3:'◎',1:'○',2:'▲'})
        for order in ([1,1], [9], ['1'], []):
            with self.assertRaises(ValueError):
                prediction_marks({'predictions':[{'isAi':True,'order':order}]}, [1,2,3])

    def test_source_json_is_checked_against_visible_riders(self):
        card, odds = fixture()
        parsed, quotes = parse_card(doc(card,odds), URL, OBSERVED)
        self.assertEqual(parsed['lineup'], '1-2/3')
        self.assertEqual(parsed['players'][0]['stats'], [1,11,1,2,3,0])
        self.assertEqual(parsed['source'], URL)
        self.assertEqual(quotes['observed_at'], datetime.fromtimestamp(1792644000,timezone.utc).isoformat())

    def test_ordered_pairs_are_not_transposed_or_rounded(self):
        _, data = fixture()
        data['exacta'][0]['odds'] = 12.345
        result = parse_odds(data,'test-race',URL,[1,2,3],OBSERVED)
        pairs = {(x['first'],x['second']):x['value'] for x in result['odds']}
        self.assertEqual(pairs[1,2],12.345)
        self.assertEqual(pairs[2,1],21.0)

    def test_missing_duplicate_wrong_race_and_zero_quotes_are_rejected(self):
        for edit in (lambda d:d['exacta'].pop(),
                     lambda d:d['exacta'].append(d['exacta'][0]),
                     lambda d:d['exacta'][0].update(raceId='another-race'),
                     lambda d:d['exacta'][0].update(type=5),
                     lambda d:d['exacta'][0].update(odds=0),
                     lambda d:d.update(oddsUpdatedAt=9999999999)):
            _, odds = fixture(); edit(odds)
            with self.assertRaises(ValueError):
                parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)

    def test_only_confirmed_absence_becomes_null(self):
        _, odds = fixture(); odds['exacta'][0]['absent']=True; odds['exacta'][0]['odds']=0
        self.assertIsNone(parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)['odds'][0]['value'])
        odds['exacta']=[]
        self.assertEqual(parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)['status'],'unavailable')

    def test_unpublished_zero_placeholders_are_not_displayed_as_quotes(self):
        _, odds = fixture()
        odds['oddsUpdatedAt'] = 0
        for row in odds['exacta']:
            row['odds'] = 0
        result = parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)
        self.assertEqual(result['status'],'unavailable')
        self.assertEqual(result['unavailable_reason'],'not_yet_published')
        self.assertNotIn('odds',result)
        for edit in (lambda d:d['exacta'].pop(),
                     lambda d:d['exacta'][0].update(raceId='wrong-race'),
                     lambda d:d['exacta'][0].update(odds=12.3)):
            bad=deepcopy(odds)
            edit(bad)
            with self.assertRaises(ValueError):
                parse_odds(bad,'test-race',URL,[1,2,3],OBSERVED)

    def test_preopening_ceiling_placeholders_need_missing_time_and_zero_popularity(self):
        _, odds=fixture()
        for row in odds['exacta']:
            row.update(odds=9999.9,popularityOrder=0)
        self.assertEqual(parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)['odds'][0]['value'],9999.9)
        odds['oddsUpdatedAt']=0
        result=parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)
        self.assertEqual(result['status'],'unavailable')
        self.assertNotIn('odds',result)
        odds['exacta'][0]['popularityOrder']=1
        with self.assertRaises(ValueError):
            parse_odds(odds,'test-race',URL,[1,2,3],OBSERVED)

    def test_wrong_date_rider_table_or_logged_in_page_is_rejected(self):
        for edit in (lambda c:c['schedule'].update(date='20261023'),
                     lambda c:c['records'][0].update(back=99),
                     lambda c:c['entries'][0].update(raceId='another-race')):
            card, odds = fixture(); edit(card)
            with self.assertRaises(ValueError):
                parse_card(doc(card,odds),URL,OBSERVED)

    def test_contested_lineup_and_duplicates(self):
        self.assertEqual(lineup_text({'lines':[{'entries':[{'numbers':[1]},{'numbers':[2,3]}]}]},[1,2,3]),'1(23)')
        with self.assertRaises(ValueError):
            lineup_text({'lines':[{'entries':[{'numbers':[1]},{'numbers':[1,3]}]}]},[1,2,3])

    def test_no_k_dreams_requests_or_unsafe_redirects(self):
        for url in ('https://keirin.kdreams.jp/', 'https://user@www.winticket.jp/', 'http://www.winticket.jp/', 'https://www.winticket.jp:444/'):
            with self.assertRaises(ValueError): check_url(url)

    def test_renderer_links_and_existing_pages_are_preserved(self):
        c, o = fixture(); card, _ = parse_card(doc(c,o),URL,OBSERVED)
        data = {'schema_version':1,'provider':'winticket','target_date':'2026-10-22','expected_races':1,'races':[card]}
        with tempfile.TemporaryDirectory() as directory:
            site=Path(directory)
            write_pages(data,site)
            original=(site/'index.html').read_bytes()
            self.assertEqual(original,(site/'line20261022.html/index.html').read_bytes())
            self.assertNotIn('@@',original.decode())
            self.assertIn('winticket.jp/keirin/',original.decode())
            self.assertNotIn('keirin.kdreams.jp',original.decode())
            data['races'][0]['players'][0]['score'] += 1
            with self.assertRaises(ValueError): write_pages(data,site)
            self.assertEqual(original,(site/'index.html').read_bytes())

    def test_script_breakout_is_escaped(self):
        c,o=fixture(); card,_=parse_card(doc(c,o),URL,OBSERVED)
        card['players'][0]['name']='</script><img src=x onerror=alert(1)>'
        output=render({'schema_version':1,'provider':'winticket','target_date':'2026-10-22','expected_races':1,'races':[card]})
        self.assertNotIn('</script><img',output)


if __name__ == '__main__':
    unittest.main()
