from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from render_races import order_races


class MeetingOrderTests(unittest.TestCase):
    def test_grade_wins_over_time_and_day_meetings_precede_night_meetings(self):
        races = [
            {'venueCode':'27', 'meetingStart':'20261028', 'race':7, 'startTime':'18:00'},
            {'venueCode':'36', 'meetingStart':'20261028', 'race':6, 'startTime':'11:00'},
            {'venueCode':'43', 'meetingStart':'20261028', 'race':7, 'startTime':'13:30'},
            {'venueCode':'27', 'meetingStart':'20261028', 'race':6, 'startTime':'17:30'},
            {'venueCode':'43', 'meetingStart':'20261028', 'race':6, 'startTime':'13:00'},
        ]
        original = deepcopy(races)
        ordered = order_races(races, {'2720261028':'3', '4320261028':'3', '3620261028':'2'})
        self.assertEqual([(r['venueCode'], r['race']) for r in ordered],
                         [('43',6), ('43',7), ('27',6), ('27',7), ('36',6)])
        self.assertEqual(races, original)

    def test_missing_times_do_not_put_an_unknown_meeting_before_a_day_meeting(self):
        races = [{'venueCode':'27', 'meetingStart':'20261028', 'race':6, 'startTime':''},
                 {'venueCode':'43', 'meetingStart':'20261028', 'race':6, 'startTime':'13:00'}]
        ordered = order_races(races, {'2720261028':'2', '4320261028':'2'})
        self.assertEqual([r['venueCode'] for r in ordered], ['43', '27'])


if __name__ == '__main__':
    unittest.main()
