from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))

from oddspark_provider import (list_url, parse_history_slot, race_url,
                              source_identity, validate_page_identity)
from source_http import Document


class PublicRouteTests(unittest.TestCase):
    def test_only_validated_public_race_routes_are_accepted(self):
        card = race_url('83', '2026-02-17', 11)
        self.assertEqual(source_identity(card),
                         {'code': '83', 'date': '20260217', 'race': 11, 'kind': 'card'})
        self.assertEqual(source_identity(race_url('21', '20260926', 4, result=True))['kind'],
                         'result')
        self.assertIsNone(source_identity(list_url('83', '20260217'))['race'])

    def test_login_other_hosts_and_ambiguous_identities_are_rejected(self):
        base = 'https://sp.oddspark.com/keirin/SpRaceInfo.do?joCd=83&kaisaiBi=20260217&raceNo=11'
        invalid = (
            base.replace('https:', 'http:'),
            base.replace('sp.oddspark.com', 'sp.oddspark.com.example'),
            base.replace('sp.oddspark.com', 'user@sp.oddspark.com'),
            base.replace('sp.oddspark.com', 'sp.oddspark.com:444'),
            base.replace('SpRaceInfo.do', 'SpLogin.do'),
            base.replace('20260217', '20260230'),
            base.replace('joCd=83', 'joCd=99'),
            base.replace('raceNo=11', 'raceNo=13'),
            base + '&joCd=21',
            base + '&joCode=21',
            base + '&token=private',
            base + '#unexpected',
        )
        for value in invalid:
            with self.subTest(url=value), self.assertRaises(ValueError):
                source_identity(value)


class OfficialHistorySlotTests(unittest.TestCase):
    def test_official_combinations_keep_each_flag_independent(self):
        # Public Sasebo/Takeo/Kurume cards contain these combinations.
        for label, expected in (('１ SHB', (1, True, True, True)),
                                ('２ SB', (2, True, False, True)),
                                ('７ H', (7, False, True, False)),
                                ('４ HB', (4, False, True, True)),
                                ('３', (3, False, False, False))):
            result = parse_history_slot(label)
            self.assertEqual(tuple(result[k] for k in ('order', 'start', 'home', 'back')),
                             expected)

    def test_blank_days_supplements_and_rank_decorations_are_retained(self):
        self.assertIsNone(parse_history_slot(' '))
        self.assertIsNone(parse_history_slot('―'))
        self.assertEqual(parse_history_slot('４補')['order'], 4)
        self.assertEqual(parse_history_slot('②B')['display_type'], 1)
        self.assertEqual(parse_history_slot('❸S')['display_type'], 2)
        self.assertEqual(parse_history_slot('落')['accident'], '落')
        for label in ('1BS', '1HH', '1X', '0', '10', '別の結果'):
            with self.subTest(label=label), self.assertRaises(ValueError):
                parse_history_slot(label)


class PageIdentityTests(unittest.TestCase):
    def test_official_title_must_match_date_venue_and_race(self):
        title = 'Ｓ級予選｜2026年2月17日（火） 久留米競輪 11R出走表｜オッズパーク競輪'
        url = race_url('83', '20260217', 11)
        def page(value):
            return Document('<title>' + value + '</title>').root
        self.assertEqual(validate_page_identity(page(title), url)['race'], 11)
        for value in (title.replace('17日', '18日'), title.replace('久留米', '別府'),
                      title.replace('11R', '10R')):
            with self.subTest(title=value), self.assertRaises(ValueError):
                validate_page_identity(page(value), url)


if __name__ == '__main__':
    unittest.main()
