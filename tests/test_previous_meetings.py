from copy import deepcopy
from datetime import datetime
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from previous_meetings import collect, parse_previous
from source_http import Document
from test_kdreams_provider import URL, STAMP, card


HEADERS = ['枠番', '車番', '選手名府県/年齢/期別', '競走得点',
           '今場所成績', '前場所成績', '前々場所成績']
PLAYERS = [{'no': n, 'name': '選手' + str(n), 'period': 100 + n,
            'playerId': '01510' + str(n)} for n in (1, 2, 3)]


def results(code, dates, missing_video=False):
    venue = {'27': '京王閣', '34': '川崎'}[code]
    rows = []
    for index, day in enumerate(dates):
        actual = datetime.strptime(day, '%Y%m%d').date()
        url = ('https://keirin.kdreams.jp/stadium/digest/?kyogijoCd=' + code
               + '&gradeCd=2&kaisaiDate=' + day + '&raceNo=' + str(index + 6)
               + '&l-id=Highlightreel')
        video = '' if missing_video else '<span><a href="javascript:void(0);" onclick="windowOpen(\'' + url + '\',\'\',\'710,460\');">[映像]</a></span>'
        rows.append('<li><span>' + f'{actual.month}/{actual.day}' + '</span><span>S級予選</span><span>'
                    + str(index + 1) + '着</span><span>11.' + str(index) + '</span>' + video + '</li>')
    return '<td><p>' + venue + 'F1</p><ul>' + ''.join(rows) + '</ul></td>'


def markup(old_dates=('20261001', '20261002', '20261003', '20261004'), missing_video=False):
    header = '<tr>' + ''.join('<th>' + value + '</th>' for value in HEADERS) + '</tr>'
    rows = ''
    for number in (1, 2, 3):
        rows += ('<tr><td class="num">' + str(number) + '</td><td class="rider">選手'
                 + str(number) + '高知/30/10' + str(number) + '</td><td>100.00</td><td></td>'
                 + results('34', ['20261008', '20261009', '20261010'])
                 + results('27', old_dates, missing_video=missing_video) + '</tr>')
    # Public structure observed in K's past_racecard_table: three cells after
    # score are current, previous and previous-previous; each li has four spans.
    return card() + '<table class="racecard_table past_racecard_table none">' + header + rows + '</table>'


class PreviousMeetingsTests(unittest.TestCase):
    def test_two_actual_source_columns_are_older_first_and_keep_exact_times_and_links(self):
        rows = parse_previous(Document(markup()).root, URL, PLAYERS, STAMP)
        old, recent = rows[0]['meetings']
        self.assertEqual((old['venue'], recent['venue']), ('京王閣', '川崎'))
        self.assertEqual((old['position'], recent['position']), ('previous_previous', 'previous'))
        self.assertEqual([r['slot'] for r in old['days']], [1, 2, 3, 4])
        self.assertEqual([r['final_half_record'] for r in old['days']], ['11.0', '11.1', '11.2', '11.3'])
        self.assertEqual(recent['days'][-1]['race_id'], '083420261010')
        self.assertEqual(old['days'][0]['player_id'], '015101')
        self.assertTrue(all(r['home'] is None and r['back'] is None for r in old['days']))
        self.assertEqual(len(recent['days']), 3)

    def test_missing_days_and_longer_meetings_are_preserved_without_fabricating_results(self):
        rows = parse_previous(Document(markup(old_dates=['20261001', '20261003'])).root, URL, PLAYERS, STAMP)
        records = rows[0]['meetings'][0]['days']
        self.assertEqual([r['slot'] for r in records], [1, 2])
        self.assertEqual([r['meeting_day'] for r in records], [1, 3])
        rows = parse_previous(Document(markup(old_dates=['20261001', '20261002', '20261003', '20261004', '20261005'])).root, URL, PLAYERS, STAMP)
        self.assertEqual(len(rows[0]['meetings'][0]['days']), 5)

    def test_missing_history_table_or_video_is_unavailable_not_zero_or_fake_identity(self):
        rows = parse_previous(Document(card()).root, URL, PLAYERS, STAMP)
        self.assertEqual([p['meetings'] for p in rows], [[], [], []])
        rows = parse_previous(Document(markup(missing_video=True)).root, URL, PLAYERS, STAMP)
        result = rows[0]['meetings'][0]['days'][0]
        self.assertEqual(result['order'], 1)
        self.assertIsNone(result['race_id'])
        self.assertTrue(result['race_date_inferred'])

    def test_wrong_rider_or_video_date_and_host_are_rejected(self):
        bad = [markup().replace('選手1高知/30/101', '別人高知/30/101'),
               markup().replace('kaisaiDate=20261001', 'kaisaiDate=20261002'),
               markup().replace('https://keirin.kdreams.jp/stadium/digest/', 'https://example.invalid/stadium/digest/'),
               markup().replace('京王閣F1', '川崎F1')]
        for source in bad:
            with self.subTest(source=source[-150:]), self.assertRaises(ValueError):
                parse_previous(Document(source).root, URL, PLAYERS, STAMP)
        wrong = deepcopy(PLAYERS); wrong[0]['playerId'] = '999999'
        with self.assertRaises(ValueError):
            parse_previous(Document(markup()).root, URL, wrong, STAMP)

    def test_collection_keeps_original_observation_receipts_and_validates_target(self):
        calls = []
        def read(url):
            calls.append(url)
            return Document(markup()).root, STAMP
        data = collect([{'source': URL, 'players': PLAYERS}], '2026-10-18', read=read)
        self.assertEqual(calls, [URL])
        self.assertEqual(data['sources'][0]['observed_at'], STAMP)
        self.assertEqual(data['races'][0]['players'][0]['meetings'][0]['days'][0]['observed_at'], STAMP)
        with self.assertRaises(ValueError):
            collect([{'source': URL, 'players': PLAYERS}], '2026-10-19', read=read)


if __name__ == '__main__':
    unittest.main()
