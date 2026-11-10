import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from export_pages import export,public_html
from previous_daily import ensure_daily
from published_card import parse_page
from verify_pages import verification_files

ROOT=Path(__file__).parents[1]


class DailyHistoryExportTests(unittest.TestCase):
    def test_approved_normal_pages_share_daily_data_and_preserve_earlier_pages(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site=root/'site';output=root/'public'
            shutil.copytree(ROOT/'site',site)
            # The explicitly approved November10 card stays a fixed regression
            # fixture even after the unattended top page advances to a new day.
            (site/'index.html').write_bytes((site/'line20261110.html/index.html').read_bytes())
            page=(site/'index.html').read_text();races=parse_page(page)
            snapshot=ensure_daily({'target_date':'2026-11-10','html':page},races,'run-100-1',site)
            original=(site/snapshot['path']).read_bytes()
            report=export(site,output)
            html=(output/'index.html').read_text()
            self.assertEqual(html,(output/'line20261110.html').read_text())
            self.assertIn('data-previous-meetings-src="previous-daily.json"',html)
            self.assertIn('data-previous-meetings="true"',html)
            for name in ('previous-meetings.js','previous-meetings.css'):
                version=hashlib.sha256((site/name).read_bytes()).hexdigest()[:12]
                self.assertIn('/keirin-lineup2/'+name+'?v='+version,html)
            self.assertEqual(report['previous_daily']['data_path'],'data/20261110/previous-daily.json')
            self.assertEqual((site/snapshot['path']).read_bytes(),original,'Enrichment must not rewrite saved observations')
            self.assertEqual(parse_page(html),parse_page((output/'index2.html').read_text()))
            for raw in report['dates']:
                if raw>='20261110':continue
                directory=site/('line'+raw+'.html');source=(directory/'index.html').read_text()
                def asset(name):
                    path=directory/name
                    return json.loads(path.read_text()) if path.exists() else None
                expected=public_html(source,raw,asset('rakuten-marks.json'),asset('rider-identities.json'),asset('rider-details.json'))
                self.assertEqual((output/('line'+raw+'.html')).read_text(),expected,'An earlier page must keep its previous export')
            preview=(output/'index2.html').read_text()
            self.assertNotIn('data-previous-meetings-src',preview)
            self.assertTrue((output/'data/20261110/previous-meetings.json').exists())
            self.assertTrue((output/'data/20261110/previous-daily.json').exists())
            checks=verification_files(output)
            self.assertIn('data/20261110/previous-daily.json',checks)
            self.assertIn('data/20261110/previous-meetings.json',checks)
            self.assertEqual(checks.count('previous-meetings.js'),1)
            self.assertEqual(checks.count('previous-meetings.css'),1)


if __name__=='__main__':unittest.main()
