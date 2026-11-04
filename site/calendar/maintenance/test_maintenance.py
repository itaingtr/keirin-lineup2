"""Calendar-only checks; no external reads or publication."""
from datetime import date
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from update_schedule import collect, grade_period, period
from update_links import build

class CalendarMaintenanceTests(unittest.TestCase):
    def test_verified_month_horizon_and_unexpected_month(self):
        def html(month):
            return (f'<select name="cmdYearval"><option value="2026" selected>2026</option></select>'
                    f'<select name="cmdDayval"><option value="{month}" selected>{month}</option></select>')
        def reader(url):
            if '/pc/' in url:
                return '2026年度 開催日程' if '2026' in url else '開催日程 年選択'
            return html('10' if 'scym=10' in url else '11')
        row = {'id': 'test', 'start': '2026-11-01', 'end': '2026-11-03', 'code': '25', 'grade': 'F1'}
        with patch('update_schedule.parse_month', return_value=[row]), patch('update_schedule.parse_grades', return_value=[]):
            result = collect(date(2026, 11, 4), reader)
            self.assertEqual(result['monthly_coverage'], ['2026-10', '2026-11'])
        with self.assertRaises(ValueError):
            collect(date(2026, 11, 4), lambda _: html('09'))

    def test_official_month_and_year_boundaries(self):
        self.assertEqual(period('12/30(水)～01/01(金)', date(2027, 1, 1)), (date(2026, 12, 30), date(2027, 1, 1)))
        self.assertEqual(grade_period('第８１回日本選手権競輪平塚(30～05/05)', 5, 2027), ('35', date(2027, 4, 30), date(2027, 5, 5)))
        self.assertEqual(grade_period('宇都宮(29～06/01)', 5, 2027), ('24', date(2027, 5, 29), date(2027, 6, 1)))
        self.assertEqual(grade_period('高松(29～02/01)', 1, 2027), ('71', date(2028, 1, 29), date(2028, 2, 1)))
        with self.assertRaises(ValueError):period('11/03(火)～11/05(木)', date(2026, 12, 1))

    def test_last_race_is_verified_and_absent_anchor_is_not_invented(self):
        rows=[{'venue':'大宮','venueCode':'25','race':n,'source':f'https://keirin.kdreams.jp/omiya/racedetail/252026110401{n:04}/','players':[]} for n in (6,12,8)]
        html='<script>const races='+json.dumps(rows)+';\nconst body=null;</script>'
        index={'schema_version':1,'site_base':'/keirin-lineup2/','current_date':'2026-11-04','days':[{'date':'2026-11-04','href':'/keirin-lineup2/line20261104.html','race_count':3,'venues':[{'name':'大宮','code':'25','href':'/keirin-lineup2/line20261104.html','race_count':3}]}]}
        original=json.dumps(index)
        v=build(index,lambda _:html,'2026-11-04T10:00:00Z')['days'][0]['venues'][0]
        self.assertEqual(v['last_race'],12);self.assertFalse(v['anchored']);self.assertNotIn('#',v['href']);self.assertEqual(json.dumps(index),original)
        anchored=build(index,lambda _:html+'<tr id="race-25-12"></tr>','2026-11-04T10:00:00Z')
        self.assertEqual(anchored['days'][0]['venues'][0]['href'],'/keirin-lineup2/line20261104.html#race-25-12')
        index['days'][0]['venues'][0]['race_count']=4
        with self.assertRaises(ValueError):build(index,lambda _:html,'2026-11-04T10:00:00Z')

if __name__=='__main__':unittest.main()
