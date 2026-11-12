from copy import deepcopy
from datetime import date,timedelta
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from export_pages import page_date
from published_card import parse_page
from ten_preview import prepare,export_ten_preview,validate

ROOT=Path(__file__).parents[1]


def fixture():
    page=(ROOT/'site/index.html').read_text();raw=page_date(page)
    target=raw[:4]+'-'+raw[4:6]+'-'+raw[6:]
    directory=ROOT/'site'/('line'+raw+'.html')
    assets={name:(directory/name).read_text() for name in
            ('rakuten-marks.json','rider-identities.json','rider-details.json')}
    card={'target_date':target,'html':page,'assets':assets};races=parse_page(page)
    rows=[]
    for race in races:
        players=[]
        for player in race['players']:
            days=[]
            for offset in range(3):
                actual=(date(2026,9,1)+timedelta(days=offset)).isoformat()
                days.append({'race_date':actual,'race_number':6,'race_id':'0627'+actual.replace('-',''),
                             'order':offset+1,'accident':'','race_type':'S級予選',
                             'video_url':'https://keirin.kdreams.jp/stadium/digest/?kyogijoCd=27&kaisaiDate='+actual.replace('-','')+'&gradeCd=2&raceNo=6'})
            players.append({'no':player['no'],'name':player['name'],'period':player['period'],
                            'player_id':player['playerId'],'meetings':[{'venue':'京王閣','venue_code':'27',
                             'grade_code':2,'start_date':'2026-09-01','days':days}]})
        rows.append({'source_url':race['source'],'players':players})
    return card,races,{'schema_version':1,'provider':'keirin.jp','target_date':target,'races':rows}


class TenPreviewTests(unittest.TestCase):
    def test_trial_exports_independently_and_preserves_normal_and_previous_sources(self):
        card,races,data=fixture()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site=root/'site';output=root/'public';shutil.copytree(ROOT/'site',site)
            protected={p.relative_to(site):p.read_bytes() for p in site.rglob('*')
                       if p.is_file() and 'ten-preview' not in p.relative_to(site).parts
                       and (p.name=='index.html' or 'previous-preview' in p.parts or p.name=='index2.html')}
            pointer=prepare(card,races,card['target_date'],'run-100-1',site,collector=lambda *_:data)
            payload=(site/pointer['path']).read_bytes();prior=(site/pointer['previous_path']).read_bytes()
            output.mkdir();(output/'index.html').write_text('normal artifact preserved')
            # The frozen experiment must not bind to a later normal-day pointer.
            daily=site/'previous-daily'/card['target_date'].replace('-','')/'latest.json'
            daily.write_text('{}')
            report=export_ten_preview(site,output)
            html=(output/'index2.html').read_text()
            self.assertIn('data-ten-meetings="true"',html)
            self.assertIn('data-previous-meetings="true"',html)
            self.assertNotIn('data-previous-meetings-src=',html)
            self.assertEqual((output/'index.html').read_text(),'normal artifact preserved')
            self.assertEqual(parse_page(html),parse_page((site/'ten-preview/index2.html').read_text()))
            self.assertTrue((output/report['data_path']).exists());self.assertTrue((output/report['ten_data_path']).exists())
            self.assertEqual(json.loads((output/report['ten_data_path']).read_text())['races'],data['races'])
            self.assertGreater(report['results'],0)
            for name in ('previous-meetings.css','previous-meetings.js','ten-meetings.css','ten-meetings.js'):
                version=hashlib.sha256((site/name).read_bytes()).hexdigest()[:12]
                self.assertIn('/keirin-lineup2/'+name+'?v='+version,html)
            self.assertEqual((site/pointer['path']).read_bytes(),payload)
            self.assertEqual((site/pointer['previous_path']).read_bytes(),prior)
            for path,original in protected.items():self.assertEqual((site/path).read_bytes(),original,str(path))

    def test_wrong_identity_dates_or_video_fail_before_any_preview_pointer(self):
        card,races,data=fixture()
        mutations=[lambda x:x.update(target_date='2026-11-01'),
                   lambda x:x['races'][0]['players'][0].update(player_id='999999'),
                   lambda x:x['races'][0]['players'][0]['meetings'][0]['days'][0].update(race_date=card['target_date']),
                   lambda x:x['races'][0]['players'][0]['meetings'][0]['days'][0].update(video_url='https://example.com/video')]
        for mutate in mutations:
            wrong=deepcopy(data);mutate(wrong)
            with self.assertRaises(ValueError):validate(wrong,card['html'])

    def test_unknown_grade_or_race_keeps_unlinked_verified_placing(self):
        card,_,data=fixture();first=data['races'][0]['players'][0]['meetings'][0]
        first['grade_code']=None
        for record in first['days']:record.update(video_url=None,race_id=None)
        first['days'][0]['race_number']=None
        self.assertIs(validate(data,card['html']),data)

    def test_payload_tampering_and_run_collision_preserve_the_checked_trial(self):
        card,races,data=fixture()
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder)/'site';shutil.copytree(ROOT/'site',site)
            pointer=prepare(card,races,card['target_date'],'run-100-1',site,collector=lambda *_:data)
            current=(site/'ten-preview/current.json').read_bytes();page=(site/'ten-preview/index2.html').read_bytes()
            with self.assertRaisesRegex(ValueError,'already exists'):
                prepare(card,races,card['target_date'],'run-100-1',site,collector=lambda *_:data)
            self.assertEqual((site/'ten-preview/current.json').read_bytes(),current)
            self.assertEqual((site/'ten-preview/index2.html').read_bytes(),page)
            payload=site/pointer['path'];payload.write_bytes(payload.read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError,'checksum differs'):
                export_ten_preview(site,Path(folder)/'public')

    def test_absent_trial_is_a_noop(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(export_ten_preview(Path(folder)/'site',Path(folder)/'public'))
            self.assertFalse((Path(folder)/'public').exists())


if __name__=='__main__':unittest.main()
