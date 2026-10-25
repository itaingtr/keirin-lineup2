from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from meeting_history import parse_history, validate_history
from collect_history import verify_result

URL='https://www.winticket.jp/keirin/odawara/racecard/2026102036/3/6'


def fixture():
    return {'playerId':'123456','currentCupResults':[
        {'playerId':'123456','raceId':'073620261021','index':2,'raceNumber':7,'order':3,
         'displayType':0,'back':False,'finalHalfRecord':'11.40','hasAccident':False,'accident':'','accidentName':''},
        {'playerId':'123456','raceId':'103620261020','index':1,'raceNumber':10,'order':2,
         'displayType':1,'back':True,'finalHalfRecord':'11.2','hasAccident':False,'accident':'','accidentName':''}]}


class HistoryTests(unittest.TestCase):
    def test_earlier_days_keep_rank_back_time_precision_and_exact_result_links(self):
        history=parse_history(fixture(),URL,'123456')
        self.assertEqual([x['order'] for x in history],[2,3])
        self.assertEqual([x['back'] for x in history],[True,False])
        self.assertEqual([x['final_half_record'] for x in history],['11.2','11.40'])
        self.assertEqual(history[0]['result_url'],'https://www.winticket.jp/keirin/odawara/raceresult/2026102036/1/10')

    def test_wrong_rider_meeting_day_duplicate_and_race_are_rejected(self):
        edits=[lambda r:r['currentCupResults'][0].update(playerId='654321'),
               lambda r:r['currentCupResults'][0].update(raceId='074820261021'),
               lambda r:r['currentCupResults'][0].update(index=3),
               lambda r:r['currentCupResults'].append(deepcopy(r['currentCupResults'][0])),
               lambda r:r['currentCupResults'][0].update(back=1),
               lambda r:r['currentCupResults'][0].update(finalHalfRecord='<img>')]
        for edit in edits:
            value=fixture();edit(value)
            with self.assertRaises(ValueError): parse_history(value,URL,'123456')
        with self.assertRaises(ValueError): parse_history(fixture(),URL,'654321')

    def test_accident_and_absent_results_preserve_original_values(self):
        record=fixture(); record['currentCupResults'][0].update(order=0,hasAccident=True,accident='未',accidentName='中止',finalHalfRecord='0.0')
        history=parse_history(record,URL,'123456')
        self.assertEqual(history[1]['accident'],'未')
        self.assertEqual(history[1]['final_half_record'],'0.0')
        self.assertEqual(parse_history({'playerId':'123456','currentCupResults':[]},URL,'123456'),[])

    def test_linked_result_must_match_rider_rank_back_and_individual_time(self):
        record=fixture(); history=parse_history(record,URL,'123456')[0]
        result=deepcopy(record['currentCupResults'][1])
        data={'players':[{'id':'123456','name':'テスト選手'}], 'entries':[{'playerId':'123456'}], 'results':[result]}
        verify_result(data,history,'123456','テスト選手')
        for field,value in (('order',1),('back',False),('finalHalfRecord','11.3'),('playerId','654321')):
            bad=deepcopy(data);bad['results'][0][field]=value
            with self.assertRaises(ValueError): verify_result(bad,history,'123456','テスト選手')
        bad=deepcopy(history);bad['result_url']='https://evil.example/'
        with self.assertRaises(ValueError): validate_history([bad],URL)


if __name__=='__main__':unittest.main()
