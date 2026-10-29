from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from rakuten_marks import parse_marks,validate_marks,stage_marks,race_url,check_url
from source_http import Document
from collect_sources import parse_card
from render_races import validate
from test_sources import fixture,doc,URL,OBSERVED


def race():
    card,odds=fixture();raw,_=parse_card(doc(card,odds),URL,OBSERVED)
    return validate({'schema_version':1,'provider':'winticket','target_date':'2026-10-22','expected_races':1,'races':[raw]})[1][0]


def page():
    return ('<title>熊本競輪 12R Ｓ級初特選 | 2026年10月22日</title>'
            '<table class="racecard_table"><caption>直近4ヶ月の成績</caption>'+''.join(
            f'<tr><td class="num">{n}</td><td class="rider">テスト選手{n}熊本/30/{100+n}</td><td class="tip">{mark}</td></tr>'
            for n,mark in [(1,'×'),(2,'注'),(3,'')])+'</table>')


class RakutenMarksTests(unittest.TestCase):
    def test_marks_are_the_published_symbols_and_blanks(self):
        result=parse_marks(Document(page()).root,race(),OBSERVED)
        self.assertEqual([p['mark'] for p in result['players']],['×','注',''])
        self.assertEqual(result['prediction_source_url'],'https://my.keirin.kdreams.jp/kumamoto/racedetail/8720261022010012/')
        self.assertEqual(result['source_url'],URL)

    def test_wrong_car_name_period_race_or_date_is_rejected(self):
        for text in [page().replace('テスト選手1','別の選手'),page().replace('/101','/102'),
                     page().replace('12R','11R'),page().replace('10月22日','10月23日'),
                     page().replace('class="num">1','class="num">2'),page().replace('>注<','>不正<')]:
            with self.assertRaises(ValueError):parse_marks(Document(text).root,race(),OBSERVED)

    def test_provider_and_saved_riders_are_checked_and_runs_are_immutable(self):
        row=parse_marks(Document(page()).root,race(),OBSERVED)
        data={'schema_version':1,'provider':'kdreams','target_date':'2026-10-22','checked_at':OBSERVED,'races':[row]}
        validate_marks(data,[race()],'2026-10-22')
        for edit in [lambda d:d.update(provider='winticket'),lambda d:d['races'][0]['players'][0].update(name='別の選手'),
                     lambda d:d['races'][0].update(prediction_source_url='https://evil.example/')]:
            bad=deepcopy(data);edit(bad)
            with self.assertRaises(ValueError):validate_marks(bad,[race()],'2026-10-22')
        with tempfile.TemporaryDirectory() as folder:
            payload=stage_marks(data,'run-123-1',folder)
            with self.assertRaises(FileExistsError):stage_marks(data,'run-123-1',folder)
            self.assertEqual((Path(folder)/'fallback/marks/20261022/runs/run-123-1.json').read_text(),payload)

    def test_source_host_is_restricted(self):
        check_url(race_url(race()))
        for url in ['http://my.keirin.kdreams.jp/kumamoto/racedetail/8720261022010012/',
                    'https://my.keirin.kdreams.jp/keirin/?pageType=odds','https://evil.example/']:
            with self.assertRaises(ValueError):check_url(url)


if __name__=='__main__':unittest.main()
