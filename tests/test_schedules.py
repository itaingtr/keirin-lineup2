from datetime import date,datetime,timedelta,timezone
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from prepare_next_card import scheduled_target,can_publish,display_card
from refresh_exacta import should_collect,ODDS_SCHEDULES
from update_publication import requested_mode,morning_recovery_date
from collect_sources import parse_card
from test_sources import fixture,doc,URL,OBSERVED


class ScheduleTests(unittest.TestCase):
    def test_next_day_for_both_slots_and_midnight_delay(self):
        for time,cron in [('2026-10-24T12:01:00+00:00','0 12 * * *'),
                          ('2026-10-24T14:31:00+00:00','30 14 * * *'),
                          ('2026-10-24T15:15:00+00:00','30 14 * * *')]:
            self.assertEqual(scheduled_target(datetime.fromisoformat(time),cron),date(2026,10,25))

    def test_odds_only_on_race_day_08_to_2030(self):
        for timestamp,allowed in [('2026-10-24T22:59:59+00:00',False),
                                  ('2026-10-24T23:00:00+00:00',True),
                                  ('2026-10-25T00:00:00+00:00',True),
                                  ('2026-10-25T11:30:59+00:00',True),
                                  ('2026-10-25T11:31:00+00:00',False),
                                  ('2026-10-25T11:45:00+00:00',False)]:
            now=datetime.fromisoformat(timestamp)
            self.assertEqual(should_collect('2026-10-25',now),allowed)
            self.assertFalse(should_collect('2026-10-26',now))
            self.assertFalse(should_collect('2026-10-24',now))

    def test_scheduling_has_one_resident_heartbeat_and_no_duplicate_direct_crons(self):
        import re
        root=Path(__file__).parents[1]
        workflow=(root/'.github/workflows/update.yml').read_text()
        heartbeat=(root/'.github/workflows/heartbeat.yml').read_text()
        self.assertEqual(re.findall(r"- cron: '([^']+)'",workflow),[])
        self.assertEqual(re.findall(r"- cron: '([^']+)'",heartbeat),['7 * * * *'])
        self.assertIn('actions: write',heartbeat)
        self.assertIn('timeout-minutes: 360',heartbeat)
        self.assertEqual(requested_mode('push',mode='odds'),'publish')
        self.assertEqual(requested_mode('workflow_dispatch',mode='odds'),'odds')
        self.assertEqual(requested_mode('workflow_dispatch',mode='cards'),'cards')

    def test_hourly_card_date_switches_at_21_and_survives_midnight(self):
        for stamp,expected in [('2026-11-08T11:59:00+00:00',date(2026,11,8)),
                               ('2026-11-08T12:00:00+00:00',date(2026,11,9)),
                               ('2026-11-08T14:59:00+00:00',date(2026,11,9)),
                               ('2026-11-08T15:05:00+00:00',date(2026,11,9)),
                               ('2026-11-09T11:00:00+00:00',date(2026,11,9))]:
            self.assertEqual(scheduled_target(datetime.fromisoformat(stamp),'0 * * * *'),expected)

    def test_delayed_final_slot_keeps_the_race_day_and_has_a_limit(self):
        last=ODDS_SCHEDULES[1]
        self.assertFalse(should_collect('2026-10-25',datetime.fromisoformat('2026-10-25T10:59:00+00:00'),last))
        for stamp in ('2026-10-25T11:32:00+00:00','2026-10-25T12:15:00+00:00'):
            self.assertTrue(should_collect('2026-10-25',datetime.fromisoformat(stamp),last))
        for stamp in ('2026-10-25T12:31:00+00:00','2026-10-25T15:05:00+00:00'):
            self.assertFalse(should_collect('2026-10-25',datetime.fromisoformat(stamp),last))

    def test_recovery_only_adds_missing_today_from_eight_including_later_slots(self):
        for stamp,expected in [('2026-10-31T22:59:00+00:00',''),
                               ('2026-10-31T23:00:00+00:00','2026-11-01'),
                               ('2026-10-31T23:59:00+00:00','2026-11-01'),
                               ('2026-11-01T00:00:00+00:00','2026-11-01'),
                               ('2026-11-01T05:47:00+00:00','2026-11-01'),
                               ('2026-11-01T14:59:00+00:00','2026-11-01')]:
            now=datetime.fromisoformat(stamp)
            self.assertEqual(morning_recovery_date('2026-10-31',now),expected)
            self.assertFalse(morning_recovery_date('2026-11-01',now))
            self.assertFalse(morning_recovery_date('2026-11-02',now))

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
