from datetime import date,datetime,timezone
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from prepare_next_card import scheduled_target,can_publish,display_card
from refresh_exacta import should_collect
from collect_sources import parse_card
from test_sources import fixture,doc,URL,OBSERVED


class ScheduleTests(unittest.TestCase):
    def test_next_day_for_both_slots_and_midnight_delay(self):
        for time,cron in [('2026-10-24T12:01:00+00:00','0 12 * * *'),
                          ('2026-10-24T14:31:00+00:00','30 14 * * *'),
                          ('2026-10-24T15:15:00+00:00','30 14 * * *')]:
            self.assertEqual(scheduled_target(datetime.fromisoformat(time),cron),date(2026,10,25))

    def test_odds_only_on_race_day_09_to_20(self):
        for timestamp,allowed in [('2026-10-24T23:59:00+00:00',False),
                                  ('2026-10-25T00:00:00+00:00',True),
                                  ('2026-10-25T11:59:00+00:00',True),
                                  ('2026-10-25T12:00:00+00:00',False)]:
            now=datetime.fromisoformat(timestamp)
            self.assertEqual(should_collect('2026-10-25',now),allowed)
            self.assertFalse(should_collect('2026-10-26',now))
            self.assertFalse(should_collect('2026-10-24',now))

    def test_never_rewrite_past_or_in_progress_card(self):
        now=datetime(2026,10,25,1,tzinfo=timezone.utc)
        self.assertFalse(can_publish(date(2026,10,24),now))
        self.assertFalse(can_publish(date(2026,10,25),now))
        self.assertFalse(can_publish(date(2026,10,26),now,'2026-10-27'))
        self.assertTrue(can_publish(date(2026,10,26),now,'2026-10-25'))

    def test_card_does_not_require_or_parse_odds(self):
        card,odds=fixture()
        broken={'exacta':[{'odds':-1}]}
        parsed,feed=parse_card(doc(card,broken),URL,OBSERVED,include_odds=False)
        self.assertTrue(parsed['players'])
        self.assertEqual(feed['status'],'unavailable')
        self.assertNotIn('odds',feed)
        dataset={'schema_version':1,'provider':'winticket','target_date':'2026-10-22','expected_races':1,'races':[parsed]}
        payload=display_card(dataset,{'checked_at':OBSERVED,'provider':'winticket','results':[{'ok':True,'snapshot':feed}]})
        self.assertIn('<base href="/line20261022.html/">',payload['html'])
        self.assertIn('&card=20261022',payload['html'])
        self.assertNotIn('value="/line20261023.html/"',payload['html'])
        self.assertFalse(payload['summary']['odds_collected'])


if __name__=='__main__':unittest.main()
