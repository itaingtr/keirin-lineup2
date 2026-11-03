"""Display contracts for compact official result flags and an empty S count."""
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from export_pages import public_html
from official_page import official_page

ROOT = Path(__file__).parents[1]


class VisibleText(HTMLParser):
    def __init__(self, markup):
        super().__init__()
        self.parts = []
        self.feed(markup)

    def handle_data(self, value):
        self.parts.append(value)


class OfficialPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # An immutable real card supplies the production render functions. No
        # fixture is written to a public card, feed, or database.
        directory = ROOT / 'site/line20261103.html'
        cls.before = public_html(
            (directory / 'index.html').read_text(), '20261103',
            json.loads((directory / 'rakuten-marks.json').read_text()),
            json.loads((directory / 'rider-identities.json').read_text()))
        cls.page = official_page(cls.before)
        meeting = re.search(r'function meetingMarkup\(p,r\)\{[\s\S]*?\n\}', cls.page)
        rider = re.search(r'function riderMarkup\(n,r,contestPosition=""\)\{[\s\S]*?\n\}', cls.page)
        if meeting is None or rider is None:
            raise AssertionError('Production render functions were not found')
        cls.functions = meeting[0] + '\n' + rider[0]

    def render(self, result=None, *, s=2, rating=2):
        code = r'''
const fs=require('node:fs'),vm=require('node:vm');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context={escapeHtml,webUrl:value=>value,meetingVideoUrl:()=> 'https://keirin.kdreams.jp/stadium/digest/',
 conditionDate:'2026-11-04',conditionRaceId:()=> '014520261104'};
vm.createContext(context);vm.runInContext(input.functions,context);
const player={no:3,name:'表示テスト',playerId:'014534',mark:'',score:'100',rawScore:100,period:'96',
 stats:[input.s,10,5,8,2,0],meetingResults:input.result?[input.result]:[]};
const race={players:[player],meetingDay:input.result?2:1,averageScore:100};
let markup=context.riderMarkup(3,race);
if(input.rating!==0)markup=markup.replace(/(<span class="condition-history"[^>]*>)(<\/span>)/,
 (_,open,close)=>open+input.rating+close);
process.stdout.write(markup);
'''
        data = {'functions': self.functions, 'result': result, 's': s, 'rating': rating}
        completed = subprocess.run(['node', '-e', code], input=json.dumps(data), text=True,
                                   capture_output=True, check=True, timeout=10)
        return completed.stdout

    @staticmethod
    def result(order=7, **flags):
        return {'meeting_day': 1, 'race_number': 1, 'race_date': '2026-11-03',
                'race_id': '014520261103', 'player_id': '014534', 'order': order,
                'display_type': 0, 'has_accident': False, 'accident': '', 'accident_name': '',
                'final_half_record': '11.5', 'start': False, 'home': False, 'back': False,
                **flags}

    def line(self, markup):
        line = re.search(r'<div class="meeting-order-line">(.*?)</div>', markup)
        self.assertIsNotNone(line)
        return ''.join(VisibleText(line[1]).parts)

    def test_verified_flags_are_tightly_ordered_before_the_condition(self):
        self.assertEqual(self.line(self.render(self.result(start=True, home=True, back=True))), '7SHB2')
        self.assertEqual(self.line(self.render(self.result(start=True, home=True, back=True), rating=-2)), '7SHB-2')
        self.assertEqual(self.line(self.render(self.result(6, back=True), rating=1)), '6B1')
        self.assertEqual(self.line(self.render(self.result(6), rating=1)), '61')
        self.assertEqual(self.line(self.render(self.result(back=True))), '7B2')

    def test_zero_condition_leaves_no_trailing_number(self):
        self.assertEqual(self.line(self.render(self.result(start=True, home=True, back=True), rating=0)), '7SHB')

    def test_s_count_zero_keeps_the_empty_row(self):
        self.assertIn('<span class="recent-s"></span><div class="stats">', self.render(s=0))
        self.assertIn('<span class="recent-s">2</span><div class="stats">', self.render(s=2))
        self.assertIn('.recent-s{display:block;width:22px;height:12px;', self.page)

    def test_alignment_and_existing_decorations_do_not_depend_on_flags(self):
        self.assertIn('justify-content:flex-start;gap:0', self.page)
        self.assertIn('min-width:0;width:auto;margin:0;padding:0', self.page)
        self.assertIn('.meeting-rank:not(.meeting-rank-circle):not(.meeting-rank-solid)', self.page)
        self.assertIn('width:22px;', self.page)
        circled = self.render(self.result(display_type=1, back=True))
        self.assertIn('class="meeting-rank meeting-rank-circle"', circled)
        self.assertIn('data-rider-appearance="red"', self.page)

    def test_wrong_or_duplicate_renderers_are_rejected(self):
        with self.assertRaises(ValueError):
            official_page(self.before.replace('aria-label="B取得"', 'aria-label="other"'))
        with self.assertRaises(ValueError):
            official_page(self.page)


if __name__ == '__main__':
    unittest.main()
