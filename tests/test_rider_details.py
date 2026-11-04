from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from kdreams_provider import parse_card
from rider_details import collect_details,details_from_dataset,validate_details,stage_details
from source_http import Document
from test_kdreams_provider import URL,STAMP,MEETING,card


class RiderDetailTests(unittest.TestCase):
    def setUp(self):
        self.markup=card().replace('選手1</a>高知/30/101','選手1</a>神 奈 川/36/101')
        self.race=parse_card(Document(self.markup).root,URL,MEETING)

    def test_actual_profile_fields_are_normalized_without_changing_race_values(self):
        before=deepcopy(self.race);requests=[]
        def reader(url):requests.append(url);return Document(self.markup).root,STAMP
        details=collect_details([self.race],'2026-10-18',reader,pause=0)
        self.assertEqual(requests,[URL])
        self.assertEqual(self.race,before)
        self.assertEqual(details['races'][0]['observed_at'],STAMP)
        self.assertEqual(details['races'][0]['players'][0],{'no':1,'name':'選手1','period':'101','prefecture':'神奈川','age':36})
        self.assertNotIn('score',details['races'][0]['players'][0])
        self.assertNotIn('stats',details['races'][0]['players'][0])

    def test_fresh_nightly_dataset_reuses_the_exact_card_observation(self):
        dataset={'provider':'kdreams','target_date':'2026-10-18','races':[self.race],
                 'sources':[{'provider':'kdreams','url':URL,'observed_at':STAMP}]}
        data=details_from_dataset(dataset)
        self.assertEqual(data['races'][0]['observed_at'],STAMP)
        self.assertEqual(data['races'][0]['players'][0]['prefecture'],'神奈川')
        self.assertIs(validate_details(data,[self.race],'2026-10-18'),data)
        wrong=deepcopy(dataset);wrong['sources']=[]
        with self.assertRaises(ValueError):details_from_dataset(wrong)

    def test_wrong_car_name_period_and_registration_cannot_receive_details(self):
        for field,value in [('name','別人'),('period',999),('player_id','015999')]:
            race=deepcopy(self.race);race['players'][0][field]=value
            with self.assertRaises(ValueError):collect_details([race],'2026-10-18',lambda url:(Document(self.markup).root,STAMP),pause=0)
        with self.assertRaises(ValueError):collect_details([self.race],'2026-10-19',lambda url:(Document(self.markup).root,STAMP),pause=0)
        markup=self.markup.replace('<td class="num">3</td>','<td class="num">2</td>')
        with self.assertRaises(ValueError):collect_details([self.race],'2026-10-18',lambda url:(Document(markup).root,STAMP),pause=0)

    def test_invalid_unverified_or_incomplete_profile_records_are_rejected(self):
        data=collect_details([self.race],'2026-10-18',lambda url:(Document(self.markup).root,STAMP),pause=0)
        variants=[]
        for key,value in [('age',0),('age',101),('age',True),('prefecture','神奈'),('period','999'),('name','別人')]:
            wrong=deepcopy(data);wrong['races'][0]['players'][0][key]=value;variants.append(wrong)
        wrong=deepcopy(data);wrong['races'][0]['players'].pop();variants.append(wrong)
        wrong=deepcopy(data);wrong['races'][0]['observed_at']='2099-01-01T00:00:00+00:00';variants.append(wrong)
        wrong=deepcopy(data);wrong['provider']='winticket';variants.append(wrong)
        for wrong in variants:
            with self.assertRaises((ValueError,TypeError)):validate_details(wrong,[self.race],'2026-10-18')
        for markup in [self.markup.replace('神 奈 川/36/101','未確認/36/101'),self.markup.replace('神 奈 川/36/101','神奈川/0/101')]:
            with self.assertRaises(ValueError):parse_card(Document(markup).root,URL,MEETING)

    def test_staging_appends_immutable_metadata_without_touching_old_runs(self):
        data=collect_details([self.race],'2026-10-18',lambda url:(Document(self.markup).root,STAMP),pause=0)
        with tempfile.TemporaryDirectory() as work:
            prefix=Path(work)/'fallback/details/20261018'
            first=stage_details(data,'run-123-1',work)
            self.assertEqual((prefix/'runs/run-123-1.json').read_text(),first)
            changed=deepcopy(data);changed['races'][0]['players'][0]['age']=37
            stage_details(changed,'run-124-1',work)
            self.assertEqual((prefix/'runs/run-123-1.json').read_text(),first)
            with self.assertRaises(FileExistsError):stage_details(changed,'run-123-1',work)
            self.assertEqual((prefix/'runs/run-123-1.json').read_text(),first)


if __name__=='__main__':unittest.main()
