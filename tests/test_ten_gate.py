import hashlib,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from ten_preview_gate import ready_for_export

class CalendarGateTests(unittest.TestCase):
    def write(self,root,verified=False,linked=True):
        meeting={'grade_code':5,'calendar_sequence_verified':verified,'days':[{'video_url':'https://keirin.kdreams.jp/stadium/digest/' if linked else None}]}
        payload=json.dumps({'races':[{'players':[{'meetings':[meeting]}]}]}).encode()
        path='ten-preview/20261112/runs/run-100-1.json';p=root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(payload)
        (root/'ten-preview/current.json').write_text(json.dumps({'path':path,'sha256':hashlib.sha256(payload).hexdigest()}))
        return p
    def test_high_grade_links_wait_for_checked_calendar_and_detect_tampering(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);self.assertFalse(ready_for_export(root))
            self.write(root);self.assertFalse(ready_for_export(root))
            path=self.write(root,verified=True);self.assertTrue(ready_for_export(root))
            path.write_bytes(path.read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError,'checksum'):ready_for_export(root)
    def test_unlinked_actual_ranks_are_safe_without_guessed_calendar_links(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);self.write(root,linked=False)
            self.assertTrue(ready_for_export(root))

if __name__=='__main__':unittest.main()
