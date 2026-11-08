from copy import deepcopy
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from official_publication import build_card, can_replace, main, stage_card
from test_kdreams_provider import URL, STAMP, MEETING, card
from kdreams_provider import parse_card
from source_http import Document


def dataset():
    race = parse_card(Document(card()).root, URL, MEETING)
    return {'schema_version': 1, 'provider': 'kdreams', 'target_date': '2026-10-18',
            'expected_races': 1, 'races': [race],
            'sources': [{'url': URL, 'provider': 'kdreams', 'observed_at': STAMP}]}


class OfficialPublicationTests(unittest.TestCase):
    def test_late_recovery_adds_only_unpublished_today_without_regressing(self):
        now=datetime.fromisoformat('2026-11-08T05:47:00+00:00')
        today=date(2026,11,8)
        self.assertTrue(can_replace(today,now,'2026-11-07'))
        for previous in (None,'2026-11-08','2026-11-09'):
            self.assertFalse(can_replace(today,now,previous))
        self.assertFalse(can_replace(date(2026,11,7),now,'2026-11-06'))
        self.assertTrue(can_replace(date(2026,11,9),now,'2026-11-08'))

    def test_provider_migration_requires_the_same_current_or_future_date(self):
        now = datetime.fromisoformat('2026-11-04T05:00:00+00:00')
        self.assertTrue(can_replace(date(2026, 11, 4), now, '2026-11-04', migration=True))
        self.assertFalse(can_replace(date(2026, 11, 4), now, '2026-11-04'))
        self.assertFalse(can_replace(date(2026, 11, 3), now, '2026-11-03', migration=True))
        self.assertFalse(can_replace(date(2026, 11, 4), now, '2026-11-05', migration=True))
        self.assertFalse(can_replace(date(2026, 11, 6), now, '2026-11-06', migration=True))
        self.assertTrue(can_replace(date(2026, 11, 5), now, '2026-11-04'))

    def test_new_card_marks_ids_and_blank_quotes_share_actual_official_sources(self):
        payload, races = build_card(dataset(), '2026-10-18T00:10:00+00:00')
        self.assertEqual(payload['provider'], 'kdreams')
        marks = json.loads(payload['assets']['rakuten-marks.json'])
        ids = json.loads(payload['assets']['rider-identities.json'])
        self.assertEqual(marks['races'][0]['prediction_source_url'], URL)
        self.assertEqual(marks['races'][0]['observed_at'], STAMP)
        self.assertEqual(ids['races'][0]['players'][0]['player_id'], '015101')
        self.assertEqual(ids['races'][0]['observed_at'], STAMP)
        self.assertEqual(ids['provider'], 'kdreams')
        self.assertEqual(races[0]['players'][0]['playerId'], '015101')
        self.assertNotIn('odds', json.loads(payload['assets']['odds.json'])['results'][0]['snapshot'])
        self.assertFalse(payload['summary']['odds_collected'])

    def test_wrong_provider_missing_receipts_and_missing_ids_fail_before_publication(self):
        original = dataset()
        variants = []
        wrong = deepcopy(original);wrong['provider'] = 'winticket';variants.append(wrong)
        wrong = deepcopy(original);wrong['sources'] = [];variants.append(wrong)
        wrong = deepcopy(original);wrong['races'][0]['players'][0].pop('player_id');variants.append(wrong)
        for wrong in variants:
            with self.assertRaises(ValueError):
                build_card(wrong, STAMP)

    def test_card_pointer_is_checksummed_new_run_and_does_not_modify_archives(self):
        payload, _ = build_card(dataset(), STAMP)
        with tempfile.TemporaryDirectory() as folder:
            old = Path(folder) / 'fallback/cards/20261017/runs/old.json'
            old.parent.mkdir(parents=True);old.write_bytes(b'preserve previous source records')
            pointer = stage_card(payload, 'run-123-1', folder, 'ref', reader=lambda *a, **k: None)
            saved = (Path(folder) / pointer['path']).read_bytes()
            self.assertEqual(hashlib.sha256(saved).hexdigest(), pointer['sha256'])
            self.assertEqual(pointer['provider'], 'kdreams')
            self.assertEqual(old.read_bytes(), b'preserve previous source records')
            with self.assertRaises(ValueError):
                stage_card(payload, 'run-124-1', folder, 'ref', reader=lambda *a, **k: b'existing run')
            self.assertFalse((Path(folder) / 'fallback/cards/20261018/runs/run-124-1.json').exists())

    def test_invalid_export_never_advances_shared_feed_or_main(self):
        payload, races = build_card(dataset(), STAMP)
        fresh_dataset = dataset()
        fresh_dataset['sources'][0]['observed_at'] = '2026-10-17T22:00:00+00:00'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'site').mkdir()
            (root / 'site/index.html').write_text(payload['html'])
            args = ['official_publication.py', '--event', 'workflow_dispatch', '--mode', 'cards',
                    '--date', '2026-10-18', '--run-key', 'run-123-1', '--work', str(root / 'work')]
            def fake_git(*arguments, **kwargs):
                return 'feed-base' if arguments[:2] == ('rev-parse', 'FETCH_HEAD') else ''
            with patch('official_publication.ROOT', root), patch.object(sys, 'argv', args), \
                 patch('official_publication.datetime', wraps=datetime) as clock, \
                 patch('official_publication.git', side_effect=fake_git) as git_call, \
                 patch('official_publication.read_published', return_value=(payload, races, '2026-10-18')), \
                 patch('official_publication.git_read', return_value=None), \
                 patch('official_publication.saved_odds', return_value=None), \
                 patch('kdreams_provider.collect_cards', return_value=fresh_dataset), \
                 patch('official_publication.enrich_cards', side_effect=lambda dataset:dataset), \
                 patch('official_publication.enrich_start_flags', side_effect=lambda dataset:dataset), \
                 patch('official_publication.export', side_effect=ValueError('invalid public layout')), \
                 patch('official_publication.publish_feed') as shared_publication:
                clock.now.return_value = datetime.fromisoformat('2026-10-17T23:10:00+00:00')
                with self.assertRaisesRegex(ValueError, 'invalid public layout'):
                    main()
                shared_publication.assert_not_called()
                self.assertFalse(any(call.args[0] in ('commit', 'push') for call in git_call.call_args_list))


if __name__ == '__main__':
    unittest.main()
