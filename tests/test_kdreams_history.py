from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from kdreams_history import parse_result_flags,enrich_start_flags
from keirin_jp_provider import parse_cards,parse_results
from source_http import Document

FIXTURES=Path(__file__).parent/'fixtures'
K=json.loads((FIXTURES/'kdreams-public-result.json').read_text())
J=json.loads((FIXTURES/'keirin-jp-public-result.json').read_text())


def result_page():
    # Minimal test card supplies the known name/period columns; result cells
    # below are the exact public fields observed in the official K result.
    header='<tr><th>直近4ヶ月の成績</th></tr><tr>'+''.join('<th>'+s+'</th>' for s in ['競走得点','S','B','逃','捲','差','マ'])+'</tr>'
    riders=''
    for p in J['previous']['players']:
        name=''.join(p['sensyuName'].split())
        riders+='<tr><td class="num">'+p['syaban']+'</td><td class="tip"></td><td class="rider">'+name+'静岡/30/'+p['sotugyouki']+'</td>'+''.join('<td>'+v+'</td>' for v in ['S1','逃','3.92','100.00','0','1','0','0','0','0'])+'</tr>'
    rows='<tr>'+''.join('<th>'+h+'</th>' for h in K['headers'])+'</tr>'
    rows+=''.join('<tr>'+''.join('<td class="'+c['class']+'">'+c['text']+'</td>' for c in r)+'</tr>' for r in K['rows'])
    return '<title>豊橋 12R Ｓ級準決勝 | 2026年11月03日</title><table class="racecard_table">'+header+riders+'</table><table class="result_table">'+rows+'</table>'


class KdreamsHistoryTests(unittest.TestCase):
    def history(self):
        entries=parse_cards({'raceInfo':[{'raceNo':'12','shumokuName':'Ｓ級準決勝','sensyuTypeInfo':J['previous']['players']}]})[12]['players']
        return parse_results({'tyakujyunItemSubData':J['result']},'45','20261103',12,'20261102',entries)

    def test_observed_s_is_independent_of_the_official_h_and_b(self):
        rows=parse_result_flags(Document(result_page()).root,K['source_url'])
        self.assertTrue(rows[4]['start'])
        self.assertFalse(rows[4]['back'])
        self.assertFalse(rows[7]['start'])
        self.assertTrue(rows[7]['back'])
        histories=self.history()
        players=[{'no':1,'name':'雨谷一樹','period':96,'player_id':'014505','meeting_results':[histories['014505']]},
                 {'no':2,'name':'橋本宇宙','period':123,'player_id':'015744','meeting_results':[histories['015744']]}]
        data={'provider':'kdreams','races':[{'source':'https://keirin.kdreams.jp/toyohashi/racedetail/4520261102030012/','players':players}]}
        before=deepcopy(data);calls=[]
        def read(url):calls.append(url);return Document(result_page()).root,K['observed_at']
        enriched=enrich_start_flags(data,read)
        self.assertEqual(data,before)
        self.assertEqual(len(calls),1)
        amagai,hashimoto=[p['meeting_results'][0] for p in enriched['races'][0]['players']]
        self.assertEqual((amagai['start'],amagai['home'],amagai['back']),(True,False,False))
        self.assertEqual((hashimoto['start'],hashimoto['home'],hashimoto['back']),(False,True,True))
        self.assertEqual(amagai['start_source_url'],K['source_url'])

    def test_mismatched_race_results_and_unknown_flags_are_rejected(self):
        for markup in [result_page().replace('>S</td>','>H</td>'),result_page().replace('>S/B</th>','>別項目</th>')]:
            with self.assertRaises(ValueError):parse_result_flags(Document(markup).root,K['source_url'])
        history=self.history()['014505']
        for key,value in [('car_number',2),('order',1),('final_half_record','12.0'),('back',True)]:
            wrong=deepcopy(history);wrong[key]=value
            data={'provider':'kdreams','races':[{'source':'https://keirin.kdreams.jp/toyohashi/racedetail/4520261102030012/','players':[{'no':1,'name':'雨谷一樹','period':96,'player_id':'014505','meeting_results':[wrong]}]}]}
            with self.assertRaises(ValueError):enrich_start_flags(data,lambda url:(Document(result_page()).root,K['observed_at']))


if __name__=='__main__':unittest.main()
