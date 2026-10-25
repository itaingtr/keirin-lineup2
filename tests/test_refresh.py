from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from refresh_exacta import refresh,valid_saved,read_snapshot
from test_sources import fixture,doc,URL,OBSERVED


def race(number=12):
    return {'venue':'熊本','race':number,'source':URL.rsplit('/',1)[0]+'/'+str(number),
            'players':[{'no':n,'name':f'テスト選手{n}'} for n in (1,2,3)]}


def snapshot(r):
    return {'provider':'winticket','bet_type':'exacta','status':'snapshot',
            'source_url':r['source'],'race_key':r['source'].replace('https://www.winticket.jp',''),
            'rider_numbers':[1,2,3],'observed_at':OBSERVED,'fetched_at':OBSERVED,
            'odds':[{'first':a,'second':b,'value':a*10+b+0.345} for a in (1,2,3) for b in (1,2,3) if a!=b]}


class RefreshTests(unittest.TestCase):
    def test_partial_failure_preserves_previous_values_and_observation_time(self):
        a,b=race(),race(11);old=snapshot(b);fresh=snapshot(a)
        previous={'results':[{'ok':True,'snapshot':old}]}
        with patch('refresh_exacta.read_snapshot',side_effect=[fresh,TimeoutError('source unavailable')]):
            feed,stats=refresh([a,b],previous,pause=0)
        self.assertEqual(feed['results'][0]['snapshot'],fresh)
        self.assertEqual(feed['results'][1]['snapshot'],old)
        self.assertEqual(stats['retained'],1)
        self.assertEqual(stats['observations'],1)

    def test_all_failures_do_not_create_zero_or_null_quotes(self):
        with patch('refresh_exacta.read_snapshot',side_effect=TimeoutError('unavailable')):
            feed,stats=refresh([race()],pause=0)
        self.assertEqual(stats['observations'],0)
        self.assertFalse(feed['results'][0]['ok'])
        self.assertNotIn('snapshot',feed['results'][0])

    def test_wrong_saved_identity_and_incomplete_matrix_are_not_reused(self):
        r=race();good=snapshot(r)
        self.assertEqual(valid_saved(good,r),good)
        for edit in (lambda s:s.update(source_url=race(11)['source']),lambda s:s['odds'].pop(),lambda s:s['odds'][0].update(value=0)):
            bad=deepcopy(good);edit(bad);self.assertIsNone(valid_saved(bad,r))

    def test_public_source_identity_and_rider_names_are_verified(self):
        card,odds=fixture();rid='128720261022';card['race']['id']=rid
        for entry in card['entries']:entry['raceId']=rid
        for row in odds['exacta']:row['raceId']=rid
        result=read_snapshot(race(),read=lambda url,sources:(doc(card,odds),OBSERVED))
        self.assertEqual(result['odds'][0]['value'],12.0)
        card['players'][0]['name']='別の選手'
        with self.assertRaises(ValueError):read_snapshot(race(),read=lambda url,sources:(doc(card,odds),OBSERVED))


if __name__=='__main__':unittest.main()
