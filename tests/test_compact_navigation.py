import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from compact_navigation import apply,ASSETS
from published_card import parse_page
from source_http import Document


def card(day='20261115'):
    races=[{'source':'https://keirin.kdreams.jp/toyama/racedetail/46'+day+'01'+str(n).zfill(4)+'/',
            'players':[{'no':x} for x in range(1,n+2)]} for n in [6,7]]
    return '<html><head><title>旧題字</title></head><body><header><div class="eyebrow">KEIRIN</div><h1>旧題字</h1><p class="intro">説明</p></header><main><div class="tools"><select id="date-select"></select><button>更新</button></div><nav id="venue-nav"></nav><div class="table-wrap"></div><footer>旧説明</footer><section class="page-bottom"><input id="search"><p class="notice">旧案内</p><div id="comments-auth-slot"></div></section></main><script>const races='+json.dumps(races)+';\nconst body=null;</script></body></html>'


class CompactNavigationTests(unittest.TestCase):
    def test_date_relative_controls_and_counts_preserve_the_card(self):
        with tempfile.TemporaryDirectory() as folder:
            source=card();result=apply(source,ROOT/'site',folder,'20261115',['20261114','20261115','20261116'])
            self.assertEqual(parse_page(source),parse_page(result))
            doc=Document(result).root
            self.assertEqual(next(doc.find_all('h1')).text(),'11月15日 全2レース・15人')
            self.assertNotIn('KEIRIN',result);self.assertNotIn('旧説明',result);self.assertNotIn('旧案内',result)
            nodes={n.attrs.get('class'):n for n in doc.find_all('a')}
            self.assertEqual(nodes['refresh-button yesterday-button'].attrs['href'],'/keirin-lineup2/line20261114.html')
            self.assertEqual(nodes['refresh-button tomorrow-button'].attrs['href'],'/keirin-lineup2/line20261116.html')
            self.assertEqual(sum(n.attrs.get('class')=='refresh-button results-button' and n.text()=='全選手成績' for n in doc.find_all('a')),2)
            self.assertIn('id="venue-nav-bottom"',result);self.assertIn('id="comments-auth-slot"',result)
            for name in ASSETS:self.assertEqual((Path(folder)/name).read_bytes(),(ROOT/'site'/name).read_bytes())

    def test_unpublished_tomorrow_is_disabled_and_results_keep_their_view(self):
        with tempfile.TemporaryDirectory() as folder:
            result=apply(card(),ROOT/'site',folder,'20261115',['20261114','20261115'],all_results=True)
            self.assertIn('href="/keirin-lineup2/results20261114.html"',result)
            self.assertIn('class="refresh-button tomorrow-button" disabled',result)
            self.assertNotIn('href="/keirin-lineup2/results20261116.html"',result)

    def test_earlier_normal_cards_are_unchanged_and_wrong_dates_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            original=card('20261114')
            self.assertEqual(apply(original,ROOT/'site',folder,'20261114',['20261114']),original)
            with self.assertRaisesRegex(ValueError,'date differs'):
                apply(original,ROOT/'site',folder,'20261115',['20261114','20261115'])


if __name__=='__main__':unittest.main()
