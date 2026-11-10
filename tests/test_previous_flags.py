from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from previous_flags import enrich

STAMP = '2026-11-04T01:00:00+00:00'
K_SOURCE = 'https://keirin.kdreams.jp/toyohashi/racedetail/4520261102030012/?pageType=showResult'
JP_SOURCE = 'https://keirin.jp/pc/dfw/dataplaza/guest/raceresult?KCD=45&KBI=20261104&RNO=12'


def history(**values):
    return dict({'provider': 'keirin.jp', 'player_id': '014505', 'race_id': '124520261104',
                 'race_date': '2026-11-04', 'race_number': 12, 'order': 3, 'accident': '',
                 'final_half_record': '11.7', 'home': True, 'back': False, 'start': True,
                 'result_url': JP_SOURCE, 'observed_at': STAMP,
                 'start_source_url': K_SOURCE, 'start_observed_at': STAMP}, **values)


def current():
    return {'schema_version': 1, 'provider': 'kdreams', 'target_date': '2026-11-10',
            'races': [{'source_url': 'https://keirin.kdreams.jp/takeo/racedetail/8420261109020006/',
                       'players': [{'no': 1, 'name': '雨谷一樹', 'period': 96, 'player_id': '014505',
                                    'meetings': [{'days': [{'slot': 1, 'race_id': '124520261104',
                                        'race_date': '2026-11-04', 'race_number': 12,
                                        'race_date_inferred': False, 'order': 3, 'accident': '',
                                        'final_half_record': '11.7', 'home': None, 'back': None,
                                        'start': None, 'player_id': '014505',
                                        'observed_at': '2026-11-10T01:00:00+00:00'}]}]}]}]}


def write_archive(root, name='line20261105.html', rows=None, **player_values):
    player = dict({'no': 7, 'name': '雨谷一樹', 'period': '96', 'playerId': '014505',
                   'meetingResults': rows if rows is not None else [history()]}, **player_values)
    page = root / name / 'index.html'; page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text('const races=' + json.dumps([{'players': [player]}], ensure_ascii=False) + ';\nconst body=')
    return page


def day(dataset):
    return dataset['races'][0]['players'][0]['meetings'][0]['days'][0]


class PreviousFlagsTests(unittest.TestCase):
    def test_exact_join_keeps_false_flags_source_times_and_original_records(self):
        data = current(); original = deepcopy(data)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); page = write_archive(root); before = page.read_bytes()
            result = enrich(data, root)
            self.assertEqual((day(result)['home'], day(result)['back'], day(result)['start']), (True, False, True))
            self.assertEqual(day(result)['flags_observed_at'], STAMP)
            self.assertEqual(day(result)['flags_source_url'], JP_SOURCE)
            self.assertEqual(day(result)['start_source_url'], K_SOURCE)
            self.assertEqual(day(result)['observed_at'], day(original)['observed_at'])
            self.assertEqual(data, original)
            self.assertEqual(page.read_bytes(), before)

    def test_rider_race_placing_time_and_provider_mismatches_never_attach(self):
        variants = [{'player_id': '014506'}, {'race_id': '114520261104', 'race_number': 11},
                    {'order': 4}, {'final_half_record': '11.8'}, {'provider': 'winticket'},
                    {'accident': '落'}, {'result_url': JP_SOURCE.replace('RNO=12', 'RNO=11')},
                    {'race_id': 124520261104}]
        for changes in variants:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); write_archive(root, rows=[history(**changes)])
                self.assertEqual([day(enrich(current(), root))[key] for key in ('home', 'back', 'start')], [None, None, None])
        for changes in [{'playerId': '014506'}, {'name': '別の選手'}, {'period': '97'}]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); write_archive(root, **changes)
                self.assertIsNone(day(enrich(current(), root))['home'])

    def test_newest_observation_wins_and_equal_time_conflicts_remain_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            write_archive(root, rows=[history(home=True, back=True)])
            write_archive(root, 'line20261106.html', [history(home=False, back=False, observed_at='2026-11-05T01:00:00+00:00')])
            result = day(enrich(current(), root))
            self.assertFalse(result['home']); self.assertFalse(result['back'])
            self.assertEqual(result['flags_observed_at'], '2026-11-05T01:00:00+00:00')
            write_archive(root, 'line20261107.html', [history(home=True, back=False, observed_at='2026-11-05T01:00:00+00:00')])
            result = day(enrich(current(), root))
            self.assertIsNone(result['home']); self.assertFalse(result['back'])

    def test_s_requires_its_own_matching_kdreams_receipt_and_unknown_ids_stay_blank(self):
        bad = [dict(start_source_url=K_SOURCE.replace('0012/', '0011/')),
               dict(start_source_url=K_SOURCE.replace('4520261102', '4520261101')),
               dict(start_observed_at=None), dict(start_source_url='https://www.winticket.jp/keirin/')]
        for changes in bad:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); write_archive(root, rows=[history(**changes)])
                result = day(enrich(current(), root))
                self.assertTrue(result['home']); self.assertIsNone(result['start'])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); write_archive(root)
            data = current(); day(data)['race_id'] = None
            self.assertIsNone(day(enrich(data, root))['home'])

    def test_malformed_archives_are_skipped_and_known_source_flags_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); bad = root / 'line20261103.html/index.html'
            bad.parent.mkdir(); bad.write_text('invalid older page')
            write_archive(root)
            data = current(); day(data)['home'] = False
            result = day(enrich(data, root))
            self.assertFalse(result['home'])
            self.assertNotIn('home', result['flag_sources'])
            self.assertFalse(result['back'])


if __name__ == '__main__':
    unittest.main()
