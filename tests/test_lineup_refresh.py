from copy import deepcopy
import json
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from lineup_refresh import refresh_lineups
from kdreams_provider import parse_card
from prepare_next_card import display_card
from published_card import parse_page
from source_http import Document
from test_kdreams_provider import URL,STAMP,MEETING,card


class LineupRefreshTests(unittest.TestCase):
    def saved(self):
        race=parse_card(Document(card()).root,URL,MEETING)
        data={'schema_version':1,'provider':'kdreams','target_date':'2026-10-18','expected_races':1,'races':[race]}
        return display_card(data,{'checked_at':STAMP,'results':[]})

    def changed_source(self):
        lineup='''<div class="line_position"><span class="icon_p"><i class="p001"></i></span><span class="icon_p bracket_open">(</span><span class="icon_p"><i class="p002"></i></span><span class="icon_p"><i class="p003"></i></span><span class="icon_p bracket_close">)</span></div>'''
        return re.sub(r'<div class="line_position">.*?</div>',lineup,card()).replace('101.25','102.75')

    def test_refresh_changes_only_source_verified_groups_and_preserves_observations(self):
        saved=self.saved();before=deepcopy(saved);calls=[]
        def reader(url):calls.append(url);return Document(self.changed_source()).root,STAMP
        updated,races=refresh_lineups(saved,reader,pause=0)
        self.assertEqual(saved,before)
        self.assertEqual(calls,[URL])
        self.assertEqual(races[0]['groups'],[[{'type':'riders','riders':[1]},{'type':'contest','riders':[2,3]}]])
        prior=parse_page(saved['html'])
        normalized=deepcopy(races);normalized[0]['groups']=prior[0]['groups']
        self.assertEqual(normalized,prior)
        self.assertEqual(updated['assets'],saved['assets'])
        self.assertEqual(updated['lineup_sources'][0]['lineup'],'1(23)')
        self.assertEqual(updated['lineup_sources'][0]['observed_at'],STAMP)
        self.assertIn('data-contest-odds="true"',updated['html'])
        self.assertEqual(updated['summary']['lineup_changes'],1)

    def test_wrong_rider_or_unbalanced_contest_leaves_the_saved_card_unchanged(self):
        saved=self.saved();before=deepcopy(saved)
        for markup in [self.changed_source().replace('選手1','別人'),
                       self.changed_source().replace('bracket_close','not_a_close'),
                       self.changed_source().replace('高知/30/101','高知/30/199')]:
            with self.assertRaises(ValueError):refresh_lineups(saved,lambda url:(Document(markup).root,STAMP),pause=0)
            self.assertEqual(saved,before)


if __name__=='__main__':unittest.main()
