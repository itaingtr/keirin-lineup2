from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from rider_identities import collect_identities, validate_identities
from collect_sources import parse_card
from render_races import validate
from test_sources import fixture, doc, URL, OBSERVED


class RiderIdentityTests(unittest.TestCase):
    def setUp(self):
        self.card,self.odds=fixture()
        parsed,_=parse_card(doc(self.card,self.odds),URL,OBSERVED)
        self.races=validate({'schema_version':1,'provider':'winticket','target_date':'2026-10-22',
                             'expected_races':1,'races':[parsed]})[1]

    def test_existing_official_ids_do_not_need_new_reads(self):
        def blocked(*args):self.fail('Existing verified IDs must not be recollected')
        result=collect_identities(self.races,'2026-10-22',OBSERVED,blocked)
        self.assertEqual([p['player_id'] for p in result['races'][0]['players']],['1','2','3'])

    def test_first_day_ids_are_checked_against_all_cars_names_and_periods(self):
        for p in self.races[0]['players']:p.pop('playerId')
        race_id='128720261022'
        self.card['race']['id']=race_id
        for entry in self.card['entries']:entry['raceId']=race_id
        reader=lambda *args:(doc(self.card,self.odds),OBSERVED)
        result=collect_identities(self.races,'2026-10-22',OBSERVED,reader)
        self.assertEqual(result['races'][0]['players'][0]['player_id'],'1')
        for edit in [lambda c:c['players'][0].update(name='違う選手'),
                     lambda c:c['players'][0].update(term=999),
                     lambda c:c['entries'][0].update(number=4),
                     lambda c:c['schedule'].update(date='20261023')]:
            original=deepcopy(self.card);edit(self.card)
            with self.assertRaises(ValueError):collect_identities(self.races,'2026-10-22',OBSERVED,reader)
            self.card=original

    def test_saved_ids_cannot_move_to_another_rider_or_history(self):
        data=collect_identities(self.races,'2026-10-22',OBSERVED)
        for edit in [lambda d:d['races'][0]['players'][0].update(player_id='2'),
                     lambda d:d['races'][0]['players'][0].update(name='違う選手'),
                     lambda d:d.update(target_date='2026-10-23')]:
            changed=deepcopy(data);edit(changed)
            with self.assertRaises(ValueError):validate_identities(changed,self.races,'2026-10-22')


if __name__=='__main__':unittest.main()
