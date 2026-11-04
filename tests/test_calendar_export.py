from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from calendar_export import export_calendar


def race(day='20261104', number=6, code='43', venue='岐阜'):
    slug={'43':'gifu', '45':'toyohashi'}[code]
    return {'source':f'https://keirin.kdreams.jp/{slug}/racedetail/{code}{day}01{number:04}/',
            'venueCode':code, 'venue':venue, 'race':number, 'players':[]}


def page(races, *, anchors=True, future_option=False):
    rows=''.join('<tr id="race-'+r['venueCode']+'-'+str(r['race'])+'"></tr>' for r in races) if anchors else ''
    option='<option value="line20261106.html">翌日</option>' if future_option else ''
    return '<html>'+option+'<script>const races='+json.dumps(races,ensure_ascii=False)+';\nconst body=null;</script>'+rows+'</html>'


class CalendarExportTests(unittest.TestCase):
    def test_verified_dates_and_first_display_race_have_direct_project_links(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);site=root/'site';output=root/'public';site.mkdir();output.mkdir()
            cards={'20261104':page([race(number=6),race(number=7),race(number=11,code='45',venue='豊橋')],future_option=True),
                   '20261105':page([race('20261105',8)])}
            for day,body in cards.items():(output/('line'+day+'.html')).write_text(body)
            data=export_calendar(site,output,['20261105','20261104'],'20261105')
            self.assertEqual(data['current_date'],'2026-11-05')
            self.assertEqual(data['current_href'],'/keirin-lineup2/line20261105.html')
            self.assertEqual([d['date'] for d in data['days']],['2026-11-04','2026-11-05'])
            first=data['days'][0]
            self.assertEqual(first['label'],'11月4日')
            self.assertEqual(first['race_count'],3)
            self.assertEqual(first['venues'][0],{'name':'岐阜','code':'43','first_race':6,'race_count':2,
                'href':'/keirin-lineup2/line20261104.html#race-43-6'})
            self.assertEqual(first['venues'][1]['href'],'/keirin-lineup2/line20261104.html#race-45-11')
            self.assertNotIn('2026-11-06',json.dumps(data))
            self.assertFalse((output/'calendar/index.html').exists())
            self.assertEqual(json.loads((output/'calendar/dates.json').read_text()),data)
            for day,body in cards.items():self.assertEqual((output/('line'+day+'.html')).read_text(),body)

    def test_missing_mismatched_or_duplicate_cards_are_rejected(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);site=root/'site';output=root/'public';site.mkdir();output.mkdir()
            file=output/'line20261104.html'
            with self.assertRaises(ValueError):export_calendar(site,output,['20261104'],'20261104')
            for body in [page([race('20261105')]),page([race(),race()])]:
                file.write_text(body)
                with self.assertRaises(ValueError):export_calendar(site,output,['20261104'],'20261104')
            file.write_text(page([race()]))
            for days,current in [(['20261104','20261104'],'20261104'),(['20261104'],'20261105'),(['20261340'],'20261340')]:
                with self.assertRaises(ValueError):export_calendar(site,output,days,current)

    def test_older_archives_without_row_ids_get_no_invented_fragment(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);site=root/'site';output=root/'public';site.mkdir();output.mkdir()
            (output/'line20261104.html').write_text(page([race()],anchors=False))
            data=export_calendar(site,output,['20261104'],'20261104')
            venue=data['days'][0]['venues'][0]
            self.assertEqual(venue['first_race'],6)
            self.assertEqual(venue['href'],'/keirin-lineup2/line20261104.html')

    def test_dynamic_page_row_contract_is_supported(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);site=root/'site';output=root/'public';site.mkdir();output.mkdir()
            body=page([race()],anchors=False)+'''<script>const row='id="race-'+r.venueCode+'-'+r.race+'"';</script>'''
            (output/'line20261104.html').write_text(body)
            data=export_calendar(site,output,['20261104'],'20261104')
            self.assertEqual(data['days'][0]['venues'][0]['first_race'],6)

    def test_static_calendar_assets_are_copied_but_cannot_replace_generated_dates(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);site=root/'site';output=root/'public';site.mkdir();output.mkdir()
            source=site/'calendar';(source/'assets').mkdir(parents=True)
            (source/'index.html').write_bytes(b'<html>Calendar UI from its own task</html>')
            (source/'assets/style.css').write_bytes(b'.calendar{display:grid}')
            (source/'dates.json').write_text('{"manual":"do not publish"}')
            (output/'line20261104.html').write_text(page([race()]))
            export_calendar(site,output,['20261104'],'20261104')
            for file in ['index.html','assets/style.css']:
                self.assertEqual((source/file).read_bytes(),(output/'calendar'/file).read_bytes())
            self.assertEqual((source/'dates.json').read_text(),'{"manual":"do not publish"}')
            self.assertNotIn('manual',json.loads((output/'calendar/dates.json').read_text()))

    def test_calendar_asset_symlinks_are_not_followed(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);site=root/'site';output=root/'public';site.mkdir();output.mkdir()
            source=site/'calendar';source.mkdir()
            outside=root/'outside.txt';outside.write_text('not a calendar asset')
            (source/'linked.txt').symlink_to(outside)
            (output/'line20261104.html').write_text(page([race()]))
            with self.assertRaises(ValueError):export_calendar(site,output,['20261104'],'20261104')
            self.assertFalse((output/'calendar/linked.txt').exists())
            (source/'linked.txt').unlink()
            (source/'assets').mkdir()
            (source/'assets/style.css').write_text('ordinary source')
            (output/'calendar').mkdir(exist_ok=True)
            outside_dir=root/'outside';outside_dir.mkdir()
            (output/'calendar/assets').symlink_to(outside_dir,target_is_directory=True)
            with self.assertRaises(ValueError):export_calendar(site,output,['20261104'],'20261104')
            self.assertFalse((outside_dir/'style.css').exists())


if __name__=='__main__':unittest.main()
