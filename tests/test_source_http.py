from email.message import Message
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from source_http import fetch

URL = 'https://www.winticket.jp/keirin/racecard/20261029'


def response(url=URL):
    result = MagicMock()
    result.__enter__.return_value = result
    result.url = url
    result.headers = Message()
    result.read.return_value = b'<html><p>Public race card</p></html>'
    return result


class PublicSourceRetryTests(unittest.TestCase):
    def test_temporary_404_and_network_error_recover_without_duplicate_records(self):
        sources = []
        with patch('source_http.build_opener') as build, patch('source_http.time.sleep') as sleep:
            build.return_value.open.side_effect = [HTTPError(URL, 404, 'Not yet available', {}, None),
                                                   URLError('temporary connection failure'), response()]
            doc, observed = fetch(URL, sources)
            self.assertIn('Public race card', doc.text())
            self.assertEqual(build.return_value.open.call_count, 3)
            self.assertEqual([c.args[0] for c in sleep.call_args_list], [2, 5])
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]['url'], URL)
        self.assertEqual(sources[0]['observed_at'], observed)

    def test_exhausted_reads_leave_no_source_record(self):
        sources = []
        with patch('source_http.build_opener') as build, patch('source_http.time.sleep') as sleep:
            build.return_value.open.side_effect = HTTPError(URL, 503, 'Unavailable', {}, None)
            with self.assertRaises(HTTPError):
                fetch(URL, sources)
            self.assertEqual(build.return_value.open.call_count, 3)
            self.assertEqual(sleep.call_count, 2)
        self.assertEqual(sources, [])

    def test_access_denials_and_rate_limits_are_not_retried(self):
        for status in (400, 401, 403, 429):
            with self.subTest(status=status), patch('source_http.build_opener') as build, patch('source_http.time.sleep') as sleep:
                build.return_value.open.side_effect = HTTPError(URL, status, 'Stop', {}, None)
                sources = []
                with self.assertRaises(HTTPError):
                    fetch(URL, sources)
                self.assertEqual(build.return_value.open.call_count, 1)
                sleep.assert_not_called()
                self.assertEqual(sources, [])

    def test_invalid_final_host_is_rejected_without_retry_or_record(self):
        sources = []
        with patch('source_http.build_opener') as build, patch('source_http.time.sleep') as sleep:
            build.return_value.open.return_value = response('https://invalid.example/racecard')
            with self.assertRaises(ValueError):
                fetch(URL, sources)
            self.assertEqual(build.return_value.open.call_count, 1)
            sleep.assert_not_called()
        self.assertEqual(sources, [])


if __name__ == '__main__':
    unittest.main()
