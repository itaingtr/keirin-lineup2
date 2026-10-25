from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from export_pages import public_html,page_date,export,materialize_card
from published_card import parse_page

ROOT=Path(__file__).parents[1]


class PublicPagesTests(unittest.TestCase):
    def test_flat_pages_keep_race_values_and_support_the_project_prefix(self):
        source=(ROOT/'site/index.html').read_text();day=page_date(source)
        result=public_html(source,day)
        self.assertEqual(parse_page(source),parse_page(result))
        self.assertIn('<base href="/keirin-lineup2/data/'+day+'/">',result)
        self.assertIn('src="/keirin-lineup2/comments.js',result)
        self.assertIn('function webUrl(source){return source;}',result)
        self.assertNotIn('/open-web?',result)
        self.assertNotIn('value="/line',result)

    def test_export_has_identical_root_and_date_and_independent_saved_feed(self):
        with tempfile.TemporaryDirectory() as folder:
            report=export(ROOT/'site',folder)
            root=Path(folder);day=report['target_date'].replace('-','')
            self.assertEqual((root/'index.html').read_bytes(),(root/('line'+day+'.html')).read_bytes())
            self.assertIn('/itaingtr/keirin-lineup2/odds-diagnostics/',(root/'data'/day/'odds-config.json').read_text())
            self.assertTrue((root/'.nojekyll').exists())
            for raw in report['dates']:
                self.assertEqual(parse_page((root/('line'+raw+'.html')).read_text()),
                                 parse_page((ROOT/'site'/('line'+raw+'.html')/'index.html').read_text()))

    def test_materialization_rejects_date_regression(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'index.html').write_text((ROOT/'site/index.html').read_text())
            older=(ROOT/'site/line20261021.html/index.html').read_text()
            with self.assertRaises(ValueError):
                materialize_card({'target_date':'2026-10-21','html':older,'assets':{}},root)


if __name__=='__main__':unittest.main()
