from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from keirin_jp_provider import check_url, parse_cards, parse_program, parse_results, enrich_cards

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/keirin-jp-public-result.json').read_text())


class OfficialJpTests(unittest.TestCase):
    def cards(self, day):
        row = FIXTURE['previous' if day == '20261103' else 'current']
        return parse_cards({'raceInfo': [{'raceNo': row['raceNo'], 'shumokuName': row['shumokuName'], 'sensyuTypeInfo': row['players']}]})

    def test_actual_official_ids_flags_and_unrounded_times(self):
        entries = self.cards('20261103')[12]['players']
        rows = parse_results({'tyakujyunItemSubData': FIXTURE['result']}, '45', '20261103', 12, '20261102', entries)
        self.assertEqual(entries[2]['player_id'], '014534')
        self.assertEqual(rows['014534']['order'], 1)
        self.assertEqual(rows['014534']['final_half_record'], '11.0')
        self.assertEqual(rows['015744']['home'], True)
        self.assertEqual(rows['015744']['back'], True)
        self.assertIsNone(rows['015744']['start'])
        self.assertFalse(rows['014534']['home'])
        self.assertEqual(rows['014534']['result_url'], FIXTURE['source_url'])
        self.assertEqual(rows['014534']['meeting_day'], 2)

    def test_car_change_uses_registration_identity_and_preserves_input(self):
        current = self.cards('20261104')[12]['players']
        previous = self.cards('20261103')[12]['players']
        stamp = FIXTURE['observed_at']
        class Client:
            receipts = [{'provider': 'keirin.jp', 'url': FIXTURE['source_url'], 'observed_at': stamp}]
            def cards(_self, code, day):
                return ({12: {'race_type': 'S級決勝', 'players': current}} if day == '20261104' else
                        {12: {'players': previous}} if day == '20261103' else {}), stamp
            def results(_self, code, day, number, start, entries):
                return parse_results({'tyakujyunItemSubData': FIXTURE['result']}, code, day, number, start, entries)
        dataset = {'provider': 'kdreams', 'target_date': '2026-11-04', 'races': [{
            'race': 12, 'source': 'https://keirin.kdreams.jp/toyohashi/racedetail/4520261102030012/',
            'players': [{'no': p['no'], 'name': p['name'], 'period': p['period']} for p in current.values()]}]}
        saved = deepcopy(dataset)
        result = enrich_cards(dataset, Client())
        self.assertEqual(dataset, saved)
        fukaya = result['races'][0]['players'][0]
        self.assertEqual(fukaya['no'], 1)
        self.assertEqual(fukaya['player_id'], '014534')
        self.assertEqual(fukaya['meeting_results'][0]['order'], 1)
        self.assertEqual(fukaya['meeting_results'][0]['race_id'], '124520261103')
        self.assertEqual(fukaya['identity_source']['provider'], 'keirin.jp')

    def test_wrong_official_identity_or_incomplete_results_are_rejected(self):
        entries = self.cards('20261103')[12]['players']
        for key, value in [('sensyuName', '別の選手'), ('sensyuRegistNo', '015999'), ('sotugyouki', '99'), ('BH', 'S'), ('agari', '不明')]:
            rows = deepcopy(FIXTURE['result']); rows[0][key] = value
            with self.assertRaises(ValueError):
                parse_results({'tyakujyunItemSubData': rows}, '45', '20261103', 12, '20261102', entries)
        with self.assertRaises(ValueError):
            parse_results({'tyakujyunItemSubData': FIXTURE['result'][:-1]}, '45', '20261103', 12, '20261102', entries)

    def test_public_navigation_requires_the_requested_date_and_venue(self):
        data = {'C0201data': {'selKaisai': '20261103', 'selKjyoCd': '45', 'C0201race': [{'encParaR': 'public-navigation'}]}}
        page = "jsonData['PC0201'] = " + json.dumps(data) + ';'
        self.assertEqual(parse_program(page, '45', '20261103')['selKaisai'], '20261103')
        with self.assertRaises(ValueError): parse_program(page, '45', '20261104')
        with self.assertRaises(ValueError): parse_program(page, '44', '20261103')
        for url in ['https://example.com/pc/top', 'https://keirin.jp/pc/login',
                    'https://keirin.jp/pc/json?type=PRIVATE&encp=x',
                    'https://keirin.jp/pc/dfw/dataplaza/guest/raceresult?KCD=45&KBI=20261103&RNO=12&token=x']:
            with self.assertRaises(ValueError): check_url(url)


if __name__ == '__main__': unittest.main()
