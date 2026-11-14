import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from published_card import parse_page
from race_results_page import apply,export_all_results,ASSETS


def page(day):
    source='https://keirin.kdreams.jp/tachikawa/racedetail/28'+day+'010001/'
    races=[{'source':source,'race':1,'players':[{'no':1,'name':'確認済み選手'}]}]
    return '<html><head><title>出走表</title><base href="/keirin-lineup2/data/'+day+'/"></head><body><select><option value="/keirin-lineup2/line'+day+'.html">日付</option></select><script>const races='+json.dumps(races,ensure_ascii=False)+';\nconst body=null;</script></body></html>'


class RaceResultsPageTests(unittest.TestCase):
    def test_old_cards_and_original_data_stay_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)
            original=page('20261103')
            self.assertEqual(apply(original,ROOT/'site',output,'20261103'),original)
            self.assertEqual(list(output.iterdir()),[])
            previous=page('20261113')
            navigable=apply(previous,ROOT/'site',output,'20261113')
            self.assertIn('data-all-results-date="20261113"',navigable)
            self.assertNotIn('data-race-results="true"',navigable,'archived card gets navigation only')
            self.assertEqual(parse_page(navigable),parse_page(previous))
            self.assertIn('all-results-nav.js?v=',navigable)
            current=page('20261114')
            result=apply(current,ROOT/'site',output,'20261114')
            self.assertEqual(parse_page(result),parse_page(current))
            self.assertIn('data-race-results="true"',result)
            self.assertIn('data-all-results-date="20261114"',result)
            self.assertNotIn('data-race-results-all=',result)
            for name in ASSETS:self.assertEqual((output/name).read_bytes(),(ROOT/'site'/name).read_bytes())

    def test_separate_all_results_pages_keep_normal_pages_intact(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)
            dates=['20261113','20261114']
            for day in dates:(output/('line'+day+'.html')).write_text(page(day))
            report=export_all_results(ROOT/'site',output,dates)
            self.assertEqual(report['date_pages'],dates)
            for day in dates:
                self.assertEqual((output/('line'+day+'.html')).read_text(),page(day))
                all_page=(output/('results'+day+'.html')).read_text()
                self.assertIn('data-race-results-all="true"',all_page)
                self.assertEqual(parse_page(all_page),parse_page(page(day)))
                self.assertIn('value="/keirin-lineup2/results'+day+'.html"',all_page)
            selector=(output/'results.html').read_text()
            self.assertIn('Date.now()+9*60*60*1000',selector,'today must use JST instead of the top card date')
            self.assertIn('dates.includes(requested)',selector,'never redirect to an unexported date or arbitrary URL')


if __name__=='__main__':unittest.main()
