from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from previous_daily import ensure_daily,load_daily,identity_digest
from published_card import parse_page

ROOT=Path(__file__).parents[1]


def card_for(day='20261111',player_id='013497'):
    races=[{'source':'https://keirin.kdreams.jp/takeo/racedetail/84'+day+'010006/',
            'players':[{'no':1,'name':'確認選手','period':96,'playerId':player_id}]}]
    page='const races='+json.dumps(races,ensure_ascii=False)+';\nconst body='
    return {'target_date':day[:4]+'-'+day[4:6]+'-'+day[6:],'html':page},races


def history_for(card,races):
    return {'schema_version':1,'provider':'kdreams','target_date':card['target_date'],
            'sources':[], 'races':[{'source_url':race['source'],'players':[
                {'no':p['no'],'name':p['name'],'period':p['period'],'player_id':p['playerId'],
                 'meetings':[]} for p in race['players']]} for race in races]}


class DailyHistoryTests(unittest.TestCase):
    def test_future_day_collects_once_and_unchanged_stats_reuse_checked_history(self):
        card,races=card_for();data=history_for(card,races);read=Mock(return_value=data)
        with tempfile.TemporaryDirectory() as folder:
            first=ensure_daily(card,races,'run-100-1',folder,collector=read)
            self.assertTrue(first['changed']);self.assertEqual(first['summary']['recorded_results'],0)
            payload=(Path(folder)/first['path']).read_bytes()
            changed=deepcopy(races);changed[0]['players'][0]['stats']=[2,1,0,0,1,0]
            refreshed=dict(card,html='const races='+json.dumps(changed)+';\nconst body=')
            second=ensure_daily(refreshed,changed,'run-101-1',folder,collector=read)
            self.assertFalse(second['changed']);read.assert_called_once_with(races,'2026-11-11')
            self.assertEqual(load_daily(folder,'20261111',refreshed['html'])['races'],data['races'])
            self.assertEqual((Path(folder)/first['path']).read_bytes(),payload)
            self.assertFalse((Path(folder)/'previous-daily/20261111/runs/run-101-1.json').exists())

    def test_roster_change_appends_new_checked_run_and_preserves_old_bytes(self):
        card,races=card_for()
        with tempfile.TemporaryDirectory() as folder:
            first=ensure_daily(card,races,'run-100-1',folder,collector=lambda *_:history_for(card,races))
            before=(Path(folder)/first['path']).read_bytes()
            newer,members=card_for(player_id='014498');read=Mock(return_value=history_for(newer,members))
            second=ensure_daily(newer,members,'run-101-1',folder,collector=read)
            self.assertTrue(second['changed']);read.assert_called_once()
            self.assertEqual((Path(folder)/first['path']).read_bytes(),before)
            self.assertEqual(load_daily(folder,'20261111',newer['html'])['races'][0]['players'][0]['player_id'],'014498')
            with self.assertRaisesRegex(ValueError,'identity differs'):
                load_daily(folder,'20261111',card['html'])

    def test_failure_on_new_roster_preserves_pointer_and_all_saved_records(self):
        card,races=card_for()
        with tempfile.TemporaryDirectory() as folder:
            ensure_daily(card,races,'run-100-1',folder,collector=lambda *_:history_for(card,races))
            root=Path(folder);before={p.relative_to(root):p.read_bytes() for p in root.rglob('*.json')}
            newer,members=card_for(player_id='014498')
            with self.assertRaisesRegex(ValueError,'source unavailable'):
                ensure_daily(newer,members,'run-101-1',folder,collector=Mock(side_effect=ValueError('source unavailable')))
            self.assertEqual(before,{p.relative_to(root):p.read_bytes() for p in root.rglob('*.json')})

    def test_preview_reuse_requires_same_date_and_complete_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            shutil.copytree(ROOT/'site/previous-preview',root/'previous-preview')
            shutil.copyfile(ROOT/'site/index2.html',root/'index2.html')
            page=(ROOT/'site/index2.html').read_text();card={'target_date':'2026-11-10','html':page}
            read=Mock(side_effect=AssertionError('Matching checked preview should be reused'))
            result=ensure_daily(card,parse_page(page),'run-100-1',root,collector=read)
            self.assertTrue(result['changed']);self.assertGreater(result['summary']['recorded_results'],0)
            read.assert_not_called()
            tomorrow,members=card_for();next_read=Mock(return_value=history_for(tomorrow,members))
            ensure_daily(tomorrow,members,'run-101-1',root,collector=next_read)
            next_read.assert_called_once_with(members,'2026-11-11')

    def test_wrong_provider_date_or_rider_never_creates_a_checked_pointer(self):
        card,races=card_for()
        for field,value in [('provider','winticket'),('target_date','2026-11-10'),('player_id','999999')]:
            data=history_for(card,races)
            if field=='player_id':data['races'][0]['players'][0][field]=value
            else:data[field]=value
            with self.subTest(field=field),tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):ensure_daily(card,races,'run-100-1',folder,collector=lambda *_:data)
                self.assertFalse(list(Path(folder).rglob('*.json')))

    def test_corrupt_saved_payload_and_immutable_run_collision_are_rejected(self):
        card,races=card_for()
        with tempfile.TemporaryDirectory() as folder:
            first=ensure_daily(card,races,'run-100-1',folder,collector=lambda *_:history_for(card,races))
            path=Path(folder)/first['path'];before=path.read_bytes();path.write_bytes(before+b' ')
            with self.assertRaisesRegex(ValueError,'checksum differs'):
                load_daily(folder,'20261111',card['html'])
            path.write_bytes(before)
            newer,members=card_for(player_id='014498')
            with self.assertRaisesRegex(ValueError,'already exists'):
                ensure_daily(newer,members,'run-100-1',folder,collector=lambda *_:history_for(newer,members))
            self.assertEqual(path.read_bytes(),before)
            self.assertEqual(load_daily(folder,'20261111',card['html'])['races'][0]['players'][0]['player_id'],'013497')

    def test_before_cutover_never_collects_or_adds_history(self):
        card,races=card_for('20261109');read=Mock()
        with tempfile.TemporaryDirectory() as folder:
            self.assertFalse(ensure_daily(card,races,'run-100-1',folder,collector=read)['changed'])
            read.assert_not_called();self.assertEqual(list(Path(folder).iterdir()),[])


if __name__=='__main__':unittest.main()
