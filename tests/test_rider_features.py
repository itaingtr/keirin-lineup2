from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from export_pages import public_html
from published_card import parse_page
from rider_features import rider_appearance

ROOT=Path(__file__).parents[1]


class RiderFeaturesTests(unittest.TestCase):
    def test_s_moves_only_for_new_appearance_without_changing_race_data(self):
        directory=ROOT/'site/line20261102.html'
        source=(directory/'index.html').read_text()
        marks=json.loads((directory/'rakuten-marks.json').read_text())
        identities=json.loads((directory/'rider-identities.json').read_text())
        archived=public_html(source,'20261102',marks,identities)
        self.assertNotIn('rider-appearance-style',archived)
        self.assertIn('''<div class="rider"><span class="recent-s">''',archived)
        updated=rider_appearance(archived)
        self.assertIn('''<span class="period">'+p.period+'</span><span class="recent-s">'+p.stats[0]+'</span><div class="stats">''',updated)
        self.assertEqual(parse_page(archived),parse_page(updated))
        self.assertIn('top:27px',updated);self.assertIn('top:62px',updated)

    def test_new_controls_preserve_results_and_add_verified_official_ids(self):
        directory=ROOT/'site/line20261102.html'
        source=(directory/'index.html').read_text()
        marks=json.loads((directory/'rakuten-marks.json').read_text())
        identities=json.loads((directory/'rider-identities.json').read_text())
        output=public_html(source,'20261102',marks,identities)
        before,after=parse_page(source),parse_page(output)
        for original,published in zip(before,after):
            for old,new in zip(original['players'],published['players']):
                self.assertRegex(new['playerId'],r'^\d{1,12}$')
                self.assertEqual(old['meetingResults'],new['meetingResults'])
                for field in ('no','name','period','score','rawScore','stats'):self.assertEqual(old[field],new[field])
        self.assertIn('class="video-link result-link"',output)
        self.assertIn('class="car condition-car c',output)
        self.assertIn('/keirin-lineup2/comments-passphrase.js',output)
        self.assertNotIn('▶ 映像を見る',output)

    def test_wrong_player_identity_cannot_enable_condition_writes(self):
        directory=ROOT/'site/line20261102.html'
        source=(directory/'index.html').read_text()
        marks=json.loads((directory/'rakuten-marks.json').read_text())
        identities=json.loads((directory/'rider-identities.json').read_text())
        wrong=deepcopy(identities);wrong['races'][0]['players'][0]['name']='別の選手'
        with self.assertRaises(ValueError):public_html(source,'20261102',marks,wrong)

    def test_earlier_pages_keep_their_existing_controls_and_auth(self):
        directory=ROOT/'site/line20261101.html'
        source=(directory/'index.html').read_text()
        marks=json.loads((directory/'rakuten-marks.json').read_text())
        output=public_html(source,'20261101',marks)
        self.assertIn('▶ 映像を見る',output)
        self.assertIn('https://www.winticket.jp/keirin/',output)
        self.assertNotIn('condition-car',output)
        self.assertIn('/keirin-lineup2/comments.js',output)
        self.assertNotIn('/keirin-lineup2/comments-passphrase.js',output)


if __name__=='__main__':unittest.main()
