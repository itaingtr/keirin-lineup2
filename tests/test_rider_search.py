import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from copy import deepcopy
import re

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
            public_page=(output/'daily-results/index.html').read_text()
            self.assertEqual(re.sub(r'\?v=[0-9a-f]{12}', '', public_page),(ROOT/'site/daily-results/search.html').read_text())
            self.assertIn('./search.js?v=',public_page)
            self.assertEqual((output/'daily-results/entries.html').read_bytes(),(ROOT/'site/daily-results/index.html').read_bytes())
            config=json.loads((output/'daily-results/profile-config.json').read_text())
            self.assertTrue(config['endpoint'].endswith('/rider-profile'))

    def test_saved_profile_details_bind_only_to_the_exact_card_person(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);site=root/'site';output=root/'public';directory=site/'line20261116.html'
            directory.mkdir(parents=True);(site/'daily-results').mkdir()
            for name in ('index.html','search.html'):(site/'daily-results'/name).write_text(name)
            (site/'race-results-config.json').write_text(json.dumps({'endpoint':'https://example.test/functions/v1/race-results','anon_key':'public-test-key'}))
            player={'no':1,'name':'確認選手','period':'100','playerId':'015000','rawScore':105.13,'stats':[2,0,0,0,3,1]}
            source='https://keirin.kdreams.jp/tachikawa/racedetail/2820261116010001/'
            race={'source':source,'players':[player]}
            (directory/'index.html').write_text('const races='+json.dumps([race])+';\nconst body=null;')
            details={'schema_version':1,'provider':'kdreams','target_date':'2026-11-16','races':[{'source_url':source,'observed_at':'2026-11-15T12:00:00Z','players':[{'no':1,'name':'確認選手','period':'100','prefecture':'福井','age':38}]}]}
            def person():
                export_search(site,output)
                return next(p for p in json.loads((output/'daily-results/riders.json').read_text())['players'] if p['player_id']=='015000')
            (directory/'rider-details.json').write_text(json.dumps(details))
            matched=person();self.assertEqual((matched['prefecture'],matched['age']),('福井',38));self.assertEqual(matched['last_card']['score_raw'],105.13)
            for field,value in [('name','別人'),('period','101'),('no',2),('player_id','015001')]:
                changed=deepcopy(details);changed['races'][0]['players'][0][field]=value
                (directory/'rider-details.json').write_text(json.dumps(changed))
                mismatched=person();self.assertNotIn('age',mismatched);self.assertNotIn('prefecture',mismatched)
            wrong_day=deepcopy(details);wrong_day['target_date']='2026-11-15'
            (directory/'rider-details.json').write_text(json.dumps(wrong_day));self.assertNotIn('age',person())


if __name__=='__main__':unittest.main()
