import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]/'scripts'))
from rider_search import export_search
from published_card import parse_page

ROOT=Path(__file__).parents[1]


class RiderSearchTests(unittest.TestCase):
    def test_search_includes_saved_riders_who_are_not_on_the_current_card(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary)
            result=export_search(ROOT/'site',output)
            catalogue=json.loads((output/'daily-results/riders.json').read_text())
            ids={p.get('playerId') for race in parse_page((ROOT/'site/index.html').read_text()) for p in race['players']}
            independent=[p for p in catalogue['players'] if p['player_id'] not in ids and p.get('history_ref')]
            self.assertTrue(independent)
            self.assertGreater(result['players'],len(ids))
            wakimoto=next(p for p in catalogue['players'] if p['name']=='脇本雄太')
            self.assertEqual(wakimoto['player_id'],'014396')
            for person in independent:
                ref=person['history_ref'];payload=(output/ref['path']).read_bytes()
                self.assertEqual(hashlib.sha256(payload).hexdigest(),ref['sha256'])
                data=json.loads(payload)
                self.assertEqual((data['player_id'],data['name'],str(data['period'])),(person['player_id'],person['name'],str(person['period'])))
                self.assertLessEqual(len(data['meetings']),10)
            self.assertEqual((output/'daily-results/index.html').read_bytes(),(ROOT/'site/daily-results/search.html').read_bytes())
            self.assertEqual((output/'daily-results/entries.html').read_bytes(),(ROOT/'site/daily-results/index.html').read_bytes())
            config=json.loads((output/'daily-results/profile-config.json').read_text())
            self.assertTrue(config['endpoint'].endswith('/rider-profile'))


if __name__=='__main__':unittest.main()
