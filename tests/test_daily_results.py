from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]/'scripts'))
from daily_results import build_index, checked_previous
from export_pages import export
from published_card import parse_page
from rider_history import read_player
from verify_pages import verification_files

ROOT = Path(__file__).parents[1]


class DailyResultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory()
        cls.output = Path(cls.work.name)
        cls.report = export(ROOT/'site', cls.output)
        # Pin regression fixtures to an archived card, independently of the
        # top's nightly advance and incomplete first publication of a new day.
        cls.day = '20261113'
        cls.index = json.loads((cls.output/'data'/cls.day/'all-rider-results.json').read_text())

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def test_all_entries_and_absences_match_every_saved_card_without_source_changes(self):
        for day, summary in self.report['daily_results']['days'].items():
            data = json.loads((self.output/'data'/day/'all-rider-results.json').read_text())
            races = parse_page((self.output/('line'+day+'.html')).read_text())
            entries = [p for r in data['races'] for p in r['players']]
            self.assertEqual(summary['races'], len(races))
            self.assertEqual(summary['entries'], sum(len(r['players']) for r in races))
            self.assertEqual(summary['absent'], sum(p.get('absent', False) for r in races for p in r['players']))
            self.assertEqual(len({p['entry_id'] for p in entries}), len(entries))
            for before, after in zip(races, data['races']):
                self.assertEqual(before['groups'], after['groups'])
                for player, entry in zip(before['players'], after['players']):
                    self.assertEqual((player['no'], player['name'], player.get('rawScore')), (entry['car_number'], entry['name'], entry['score_raw']))
                    if entry.get('history_ref'):
                        ref = entry['history_ref']
                        self.assertEqual(hashlib.sha256((self.output/ref['path']).read_bytes()).hexdigest(), ref['sha256'])
                        self.assertEqual((ROOT/'site'/ref['path']).read_bytes(), (self.output/ref['path']).read_bytes())
        current = self.report['target_date'].replace('-', '')
        self.assertEqual((self.output/'index.html').read_bytes(), (self.output/('line'+current+'.html')).read_bytes())
        self.assertEqual(self.index['summary']['entries'], 186)
        self.assertEqual(self.index['summary']['previous_ready'], 186)
        self.assertEqual(self.index['summary']['ten_ready'], 185)

    def test_one_broken_player_does_not_hide_other_histories_or_entries(self):
        bad_id = self.index['races'][0]['players'][0]['player_id']
        def reader(site, entry):
            if entry['player_id'] == bad_id:
                raise ValueError('Checksum differs')
            return read_player(site, entry)
        with patch('daily_results.read_player', side_effect=reader):
            data = build_index(ROOT/'site', self.output, self.day)
        players = [p for r in data['races'] for p in r['players']]
        self.assertEqual(data['summary']['entries'], 186)
        self.assertEqual(data['summary']['previous_ready'], 186)
        self.assertEqual(data['summary']['ten_ready'], 184)
        self.assertEqual(next(p for p in players if p['player_id'] == bad_id)['data_status']['ten'], 'error')

    def test_wrong_previous_person_is_isolated_and_does_not_remove_ten(self):
        page = (self.output/('line'+self.day+'.html')).read_text()
        data = deepcopy(checked_previous(ROOT/'site', self.day, page))
        data['races'][0]['players'][0]['period'] += 1
        with patch('daily_results.checked_previous', return_value=data):
            result = build_index(ROOT/'site', self.output, self.day)
        self.assertEqual(result['summary']['entries'], 186)
        self.assertEqual(result['summary']['previous_ready'], 185)
        self.assertEqual(result['summary']['ten_ready'], 185)
        self.assertEqual(result['races'][0]['players'][0]['data_status']['previous'], 'mismatch')

    def test_missing_previous_keeps_current_and_ten_without_collecting(self):
        with patch('daily_results.checked_previous', side_effect=FileNotFoundError), \
             patch('previous_daily.ensure_daily', side_effect=AssertionError('Must not collect')):
            data = build_index(ROOT/'site', self.output, self.day)
        self.assertEqual(data['summary']['entries'], 186)
        self.assertEqual(data['summary']['ten_ready'], 185)
        self.assertEqual(data['races'][0]['players'][0]['data_status']['previous'], 'error')
        self.assertTrue(data['races'][0]['players'][0]['current_meeting_prior_results'])

    def test_new_public_artifacts_are_in_http_verification_and_no_auth_identity_is_copied(self):
        files = verification_files(self.output)
        for name in ('index.html', 'app.js', 'model.js', 'style.css', 'board-client.js'):
            self.assertIn('daily-results/'+name, files)
        self.assertIn('data/'+self.day+'/all-rider-results.json', files)
        client = (self.output/'daily-results/board-client.js').read_text()
        for text in ('BOARD_EMAIL', 'PASSPHRASE_DOMAIN', '.insert(', '.update(', '.delete('):
            self.assertNotIn(text, client)
        self.assertIn('storageKey:', client)
        self.assertEqual((self.output/'comments-passphrase.js').read_bytes(), (ROOT/'site/comments-passphrase.js').read_bytes())


if __name__ == '__main__':
    unittest.main()
