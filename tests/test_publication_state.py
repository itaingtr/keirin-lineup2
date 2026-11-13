from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from publication_state import card_digest,artifact_digest,is_confirmed,read_receipt
from official_publication import build_card,main
from export_pages import materialize_card
from test_official_publication import dataset
from test_kdreams_provider import STAMP


class PublicationStateTests(unittest.TestCase):
    def test_staged_card_is_not_published_until_matching_http_receipt_exists(self):
        card,_=build_card(dataset(),STAMP)
        self.assertFalse(is_confirmed(None,card))
        receipt={'schema_version':1,'http_verified':True,'target_date':card['target_date'],'card_sha256':card_digest(card)}
        self.assertTrue(is_confirmed(receipt,card))
        receipt['source_commit']='old-code'
        self.assertFalse(is_confirmed(receipt,card,source_commit='fixed-code'))
        self.assertTrue(is_confirmed(receipt,card,source_commit='old-code'))
        changed=deepcopy(card);changed['checked_at']='2026-10-18T01:00:00+00:00'
        self.assertFalse(is_confirmed(receipt,changed))
        self.assertFalse(is_confirmed({**receipt,'http_verified':False},card))
        self.assertIsNone(read_receipt('ref',lambda *a,**k:b'invalid'))

    def test_shared_asset_change_invalidates_verified_artifact(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'index.html').write_text('same page')
            (root/'odds.js').write_text('old reader');prior=artifact_digest(root)
            (root/'odds.js').write_text('new reader')
            self.assertNotEqual(prior,artifact_digest(root))

    def test_unconfirmed_same_card_retries_publication_even_after_source_failure(self):
        payload,races=build_card(dataset(),STAMP)
        for source_failed in (False,True):
            with self.subTest(source_failed=source_failed),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);materialize_card(payload,root/'site')
                args=['official_publication.py','--event','workflow_dispatch','--mode','cards',
                      '--date','2026-10-18','--run-key','run-123-1','--work',str(root/'work')]
                with patch('official_publication.ROOT',root),patch.object(sys,'argv',args), \
                     patch('official_publication.datetime',wraps=datetime) as clock, \
                     patch('official_publication.git',return_value=''), \
                     patch('official_publication.git_read',return_value=None), \
                     patch('official_publication.read_published',return_value=(payload,races,'2026-10-18')), \
                     patch('official_publication.saved_odds',return_value=None), \
                     patch('official_publication.refresh',return_value=({}, {'observations':0})), \
                     patch('kdreams_provider.collect_cards',side_effect=ValueError('source unavailable') if source_failed else None,return_value=dataset()), \
                     patch('official_publication.enrich_cards',side_effect=lambda d,**kwargs:d), \
                     patch('official_publication.enrich_start_flags',side_effect=lambda d,**kwargs:d), \
                     patch('official_publication.export',return_value={'target_date':'2026-10-18'}) as export, \
                     patch('official_publication.artifact_digest',return_value='artifact-hash'):
                    clock.now.return_value=datetime.fromisoformat('2026-10-18T05:00:00+00:00')
                    main();export.assert_called_once()
                    report=json.loads((root/'work/report.json').read_text())
                    self.assertTrue(report['publish_pages'])
                    self.assertTrue(report['publication_pending'])
                    self.assertFalse(report['card_changed'])
                    self.assertEqual(bool(report['card_check_error']),source_failed)


if __name__=='__main__':unittest.main()
