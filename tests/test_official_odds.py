from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from official_odds import (ODDS_PREFIX, blank_feed, refresh, should_collect,
                           stage_feed, valid_saved)

STAMP = '2026-10-18T00:00:00+00:00'
URL = 'https://keirin.kdreams.jp/kochi/racedetail/7420261017020006/'


def race():
    return {'source': URL, 'venue': '高知', 'race': 6,
            'players': [{'no': 1}, {'no': 2}, {'no': 3}]}


def quote():
    return {'provider': 'kdreams', 'parser_version': 2, 'bet_type': 'exacta',
            'status': 'snapshot', 'source_url': URL + '?pageType=odds',
            'race_key': URL.replace('https://keirin.kdreams.jp', ''),
            'rider_numbers': [1, 2, 3], 'observed_at': STAMP,
            'odds': [{'first': a, 'second': b, 'value': a * 10 + b + .125}
                     for a in (1, 2, 3) for b in (1, 2, 3) if a != b]}


class OfficialOddsTests(unittest.TestCase):
    def test_retained_quotes_keep_source_precision_time_and_direction(self):
        prior = quote()
        previous = {'provider': 'kdreams', 'results': [{'ok': True, 'snapshot': prior}]}
        def failed(_):
            raise TimeoutError('public source unavailable')
        feed, stats = refresh([race()], previous, collector=failed, pause=0)
        self.assertEqual(feed['results'][0]['snapshot'], prior)
        self.assertEqual(stats['retained'], 1)
        self.assertEqual(stats['observations'], 0)
        prices = {(p['first'], p['second']): p['value'] for p in prior['odds']}
        self.assertEqual(prices[1, 2], 12.125)
        self.assertEqual(prices[2, 1], 21.125)

    def test_old_provider_version_wrong_identity_or_partial_matrix_are_rejected(self):
        for edit in (lambda q: q.update(provider='winticket'),
                     lambda q: q.update(parser_version=1),
                     lambda q: q.update(source_url=URL),
                     lambda q: q['odds'].pop(),
                     lambda q: q['odds'][0].update(value=0)):
            wrong = deepcopy(quote())
            edit(wrong)
            self.assertIsNone(valid_saved(wrong, race()))
        with self.assertRaises(ValueError):
            refresh([race()], {'provider': 'winticket', 'results': []}, pause=0)

    def test_failed_or_explicitly_unavailable_source_does_not_fabricate_prices(self):
        def failed(_):
            raise TimeoutError('source unavailable')
        feed, stats = refresh([race()], collector=failed, pause=0)
        self.assertFalse(feed['results'][0]['ok'])
        self.assertNotIn('snapshot', feed['results'][0])
        self.assertEqual(stats['observations'], 0)
        unavailable = quote()
        unavailable['status'] = 'unavailable'
        for pair in unavailable['odds']:
            pair['value'] = None
        feed, stats = refresh([race()], collector=lambda _: unavailable, pause=0)
        self.assertEqual(stats['observations'], 1)
        self.assertEqual(feed['results'][0]['snapshot']['status'], 'unavailable')

    def test_blank_new_card_and_immutable_run_use_only_new_provider_prefix(self):
        feed = blank_feed([race()], '2026-10-18', STAMP)
        self.assertNotIn('observed_at', feed['results'][0]['snapshot'])
        self.assertNotIn('odds', feed['results'][0]['snapshot'])
        with tempfile.TemporaryDirectory() as folder:
            path = stage_feed(feed, '2026-10-18', 'run-123-1', folder)
            self.assertIn(ODDS_PREFIX, str(path))
            self.assertEqual(json.loads(path.read_text()), feed)
            with self.assertRaises(FileExistsError):
                stage_feed(feed, '2026-10-18', 'run-123-1', folder)
            self.assertFalse((Path(folder) / 'fallback/exacta').exists())

    def test_race_day_quarter_hour_window_and_delayed_final_slot_are_preserved(self):
        for stamp, allowed in [('2026-10-17T22:59:00+00:00', False),
                               ('2026-10-17T23:00:00+00:00', True),
                               ('2026-10-18T11:30:00+00:00', True),
                               ('2026-10-18T11:31:00+00:00', False)]:
            now = datetime.fromisoformat(stamp)
            self.assertEqual(should_collect('2026-10-18', now), allowed)
            self.assertFalse(should_collect('2026-10-19', now))
        self.assertTrue(should_collect('2026-10-18', datetime.fromisoformat('2026-10-18T12:15:00+00:00'),
                                       '0,15,30 11 * * *'))
        self.assertFalse(should_collect('2026-10-18', datetime.fromisoformat('2026-10-18T12:31:00+00:00'),
                                        '0,15,30 11 * * *'))


if __name__ == '__main__':
    unittest.main()
