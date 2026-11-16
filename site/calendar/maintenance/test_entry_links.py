"""Assignment-link regression checks; all source pages are local fixtures."""
from datetime import date
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import update_entry_links as entry


MEETING = {'id': '26-2026-11-18-F1', 'code': '26', 'venue': '西武園',
           'start': '2026-11-18', 'end': '2026-11-20'}
HREF = entry.ORIGIN + '/seibuen/assen/2620261118/'
HOME = ('<h1>西武園競輪</h1><a href="/seibuen/">西武園競輪</a>'
        '<a href="'+HREF+'">あっせん情報</a>')
ASSIGNMENT = ('<h1>西武園競輪 あっせん情報</h1>'
              '<h2>2026年11月18日～2026年11月20日 あっせん情報</h2>'
              '<table class="assen_s"><tr><td>選手</td><td>117</td></tr></table>')


class EntryLinkTests(unittest.TestCase):
    def test_only_existing_matching_links_are_enabled(self):
        missing = MEETING | {'id': '26-2026-11-21-F1', 'start': '2026-11-21', 'end': '2026-11-23'}
        requests = []

        def read(url):
            requests.append(url)
            html = HOME if url == entry.HUB else ASSIGNMENT
            return html, {'url': url, 'http_status': 200, 'sha256': sha256(html.encode()).hexdigest(),
                          'observed_at': '2026-11-16T03:00:00+00:00'}

        data = entry.collect({'schema_version': 1, 'meetings': [MEETING, missing]}, date(2026, 11, 16), read)
        self.assertEqual([m['id'] for m in data['meetings']], [MEETING['id']])
        self.assertEqual(data['meetings'][0]['href'], HREF)
        self.assertEqual(requests, [entry.HUB, HREF])

    def test_wrong_venue_dates_and_empty_list_are_rejected(self):
        for bad in [ASSIGNMENT.replace('西武園', '大垣'),
                    ASSIGNMENT.replace('11月20日', '11月21日'),
                    ASSIGNMENT.replace('<td>117</td>', '<td></td>')]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                entry.verify_assignment(entry.Page(bad), MEETING)

    def test_foreign_host_and_other_meeting_are_not_followed(self):
        self.assertIsNone(entry.assignment_link(HREF.replace('keirin.kdreams.jp', 'example.com'), entry.HUB, MEETING))
        self.assertIsNone(entry.assignment_link(HREF.replace('20261118', '20261119'), entry.HUB, MEETING))
        for bad in ['http://keirin.kdreams.jp/seibuen/', 'https://example.com/seibuen/',
                    'https://keirin.kdreams.jp/seibuen/?token=test']:
            with self.subTest(url=bad), self.assertRaises(ValueError):
                entry.source_url(bad)

    def test_failed_refresh_keeps_existing_metadata(self):
        with tempfile.TemporaryDirectory(dir=entry.ROOT) as directory:
            root = Path(directory)
            output, schedule = root/'links.json', root/'schedule.json'
            output.write_text('existing verified links\n')
            schedule.write_text('{"schema_version":1,"meetings":[]}')
            with patch.object(entry, 'collect', side_effect=ValueError('Source unavailable')):
                with self.assertRaises(ValueError):
                    entry.refresh(schedule, output)
            self.assertEqual(output.read_text(), 'existing verified links\n')
            self.assertFalse(output.with_suffix('.tmp').exists())


if __name__ == '__main__':
    unittest.main()
