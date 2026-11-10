from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from previous_presentation import enrich,highlight,semifinal


def write(root,day,rows):
    path=root/('line'+day+'.html')/'index.html';path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text('const races='+json.dumps(rows,ensure_ascii=False)+';\nconst body=')
    return path


def race(kind='Ｓ級初日特選',source='https://keirin.kdreams.jp/takeo/racedetail/8420261109010012/'):
    return {'source':source,'raceType':kind,'race':12,'venueCode':'84','players':[]}


def record(**changes):
    return dict({'race_id':'128420261109','race_date':'2026-11-09','race_number':12,'player_id':'013497'},**changes)


def data():
    return {'races':[{'players':[{'player_id':'013497','meetings':[{'days':[record()]}]}]}]}


class PreviousPresentationTests(unittest.TestCase):
    def test_explicit_special_and_final_exclude_semifinal_and_later_special(self):
        for kind in ('Ｓ級初日特選','S級初特選','Ｓ級初特','S級決勝','A級決勝戦'):
            self.assertTrue(highlight(kind,2),kind)
        self.assertTrue(highlight('S級特選',1))
        for kind in ('S級準決勝','S級準々決勝','S級特選','S級特秀','S級優秀'):
            self.assertFalse(highlight(kind,2),kind)

    def test_semifinal_is_distinct_from_final_and_quarterfinal(self):
        for kind in ('Ｓ級準決勝','S級準決勝戦',' Ａ級 準決勝 '):
            self.assertTrue(semifinal(kind),kind)
        for kind in ('S級決勝','S級準々決勝','S級二次予選','S級初日特選',None):
            self.assertFalse(semifinal(kind),kind)

    def test_verified_semifinal_metadata_stays_separate_and_preserves_source(self):
        original=data();before=deepcopy(original)
        current=[{'players':[{'playerId':'013497','meetingResults':[record()]}]}]
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=write(root,'20261109',[race('Ｓ級準決勝')]);source=path.read_bytes()
            result=enrich(original,root,current)
            self.assertEqual(result['current_result_types'],{'128420261109':'S級準決勝'})
            row=result['races'][0]['players'][0]['meetings'][0]['days'][0]
            self.assertTrue(row['semifinal_rank']);self.assertFalse(row['highlight_rank'])
            self.assertEqual(original,before);self.assertEqual(path.read_bytes(),source)

    def test_exact_archive_type_adds_current_and_previous_hints_without_mutation(self):
        original=data();before=deepcopy(original)
        current=[{'players':[{'playerId':'013497','meetingResults':[record()]}]}]
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=write(root,'20261109',[race()]);source=path.read_bytes()
            result=enrich(original,root,current)
            self.assertEqual(result['current_result_types'],{'128420261109':'S級初日特選'})
            self.assertTrue(result['races'][0]['players'][0]['meetings'][0]['days'][0]['highlight_rank'])
            self.assertEqual(original,before);self.assertEqual(path.read_bytes(),source)

    def test_other_date_venue_player_and_legacy_sources_do_not_attach(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            write(root,'20261108',[race()]) # URLdate and archived-page date differ.
            write(root,'20261109',[race(source='https://www.winticket.jp/keirin/takeo/racecard/2026110984/1/12')])
            (root/'line20261107.html').mkdir();(root/'line20261107.html/index.html').write_text('broken')
            result=enrich(data(),root,[{'players':[{'playerId':'013498','meetingResults':[record()]}]}])
            self.assertEqual(result['current_result_types'],{})
            self.assertNotIn('highlight_rank',result['races'][0]['players'][0]['meetings'][0]['days'][0])

    def test_verified_day1_special_only_and_unknown_unavailable_ids_stay_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            write(root,'20261109',[race('S級特選')])
            self.assertTrue(enrich(data(),root)['races'][0]['players'][0]['meetings'][0]['days'][0]['highlight_rank'])
            write(root,'20261109',[race('S級特選','https://keirin.kdreams.jp/takeo/racedetail/8420261108020012/')])
            self.assertFalse(enrich(data(),root)['races'][0]['players'][0]['meetings'][0]['days'][0]['highlight_rank'])
            for changes in ({'race_date':'2026-11-08'},{'race_number':11},{'player_id':'013498'},{'race_id':None},{'unavailable':True}):
                altered=data();altered['races'][0]['players'][0]['meetings'][0]['days'][0].update(changes)
                self.assertNotIn('highlight_rank',enrich(altered,root)['races'][0]['players'][0]['meetings'][0]['days'][0])

    def test_conflicting_verified_archive_entries_stay_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);write(root,'20261109',[race(),race('S級予選')])
            self.assertEqual(enrich(data(),root)['current_result_types'],{})
            self.assertNotIn('highlight_rank',enrich(data(),root)['races'][0]['players'][0]['meetings'][0]['days'][0])


if __name__=='__main__':unittest.main()
