from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from export_pages import public_html
from published_card import parse_page
from rider_details_page import apply_details,DETAILS_FUNCTIONS,DETAILS_EVENTS

ROOT=Path(__file__).parents[1]


class RiderDetailsPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory=ROOT/'site/line20261104.html'
        cls.before=public_html((directory/'index.html').read_text(),'20261104',
            json.loads((directory/'rakuten-marks.json').read_text()),
            json.loads((directory/'rider-identities.json').read_text()))
        cls.original=parse_page(cls.before)
        stamp='2026-11-04T00:00:00+00:00'
        cls.details={'schema_version':1,'provider':'kdreams','target_date':'2026-11-04','checked_at':stamp,
            'races':[{'source_url':r['source'],'observed_at':stamp,
                'players':[{'no':p['no'],'name':p['name'],'period':str(p['period']),
                            'prefecture':'神奈川','age':36} for p in r['players']]} for r in cls.original]}
        cls.page,cls.races=apply_details(cls.before,cls.details)

    def node(self,code,input):
        done=subprocess.run(['node','-e',code],input=json.dumps(input),text=True,
                            capture_output=True,check=True,timeout=10)
        return done.stdout

    def test_overlay_changes_only_verified_profile_fields_and_not_the_source_page(self):
        for old,new in zip(self.original,self.races):
            stripped=deepcopy(new)
            for p in stripped['players']:
                self.assertEqual(p.pop('prefecture'),'神奈川')
                self.assertEqual(p.pop('age'),36)
            self.assertEqual(stripped,old)
        self.assertEqual(parse_page(self.before),self.original)
        self.assertEqual(parse_page(self.page),self.races)
        self.assertIn('data-official-results="true"',self.page)
        self.assertIn('data-rider-appearance="red"',self.page)

    def test_shared_time_metric_keeps_flags_and_condition_at_one_fixed_start(self):
        self.assertIn('padding-left:calc((22px - 4ch)/2)',self.page)
        self.assertIn('.meeting-time-value{display:block;width:4ch;margin-inline:auto;text-align:left}',self.page)
        self.assertIn('.meeting-time{font-size:8px;font-variant-numeric:tabular-nums}',self.page)
        self.assertIn('class="meeting-time-value"',self.page)
        self.assertIn('justify-content:flex-start;gap:0',self.page)
        self.assertIn('flex:0 0 22px;',self.page)
        self.assertNotIn('flex-basis:30px',self.page)

    def test_period_is_a_native_toggle_and_profile_uses_two_horizontal_rows(self):
        code=r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const context={escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
vm.createContext(context);vm.runInContext(input.functions,context);
const p=input.player,r=input.race;
const first=context.riderProfileMarkup(p,r);
assert.match(first,/<button type="button" class="period period-toggle"/);
assert.match(first,/aria-expanded="false"/);assert.match(first,/>96<\/button>/);
assert.match(first,/class="rider-profile" hidden/);
assert.match(first,/>神奈<\/span><span class="rider-age"[^>]*>36<\/span>/);
assert.match(first,/title="神奈川"/);
assert.match(first,/aria-label="年齢 36歳"/);
process.stdout.write(first);
'''
        p=deepcopy(self.races[0]['players'][0]);p['period']='96'
        markup=self.node(code,{'functions':DETAILS_FUNCTIONS,'player':p,'race':self.races[0]})
        self.assertIn('aria-controls="rider-details-',markup)
        self.assertIn('.rider-profile[hidden]{display:none}',self.page)
        self.assertNotIn('visibility:hidden',self.page)
        self.assertIn('writing-mode:horizontal-tb',self.page)

    def test_any_member_toggles_the_entire_race_and_preserves_rerender_state(self):
        code=r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const listeners={},profiles=new Map(),toggles=[];
function raceRow(){return {toggles:[],classList:{enabled:false,toggle(name,value){assert.equal(name,'rider-details-open');this.enabled=value;}},
 querySelectorAll(selector){assert.equal(selector,'.period-toggle');return this.toggles;}};}
function button(row,key,id){const profile={hidden:true};profiles.set(id,profile);
 const b={dataset:{detailsKey:key,riderName:'表示選手'},attrs:{'aria-expanded':'false','aria-controls':id},
  closest(selector){return selector==='tr'?row:this;},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;}};
 toggles.push(b);row.toggles.push(b);return b;}
const context={escapeHtml:String,body:{contains:t=>toggles.includes(t),addEventListener:(name,handler)=>listeners[name]=handler},
 document:{getElementById:id=>profiles.get(id)}};
vm.createContext(context);vm.runInContext(input.functions+'\n'+input.events,context);
const p=input.player,r=input.race,otherPlayer={...p,playerId:'999999'},otherRace={...r,source:r.source+'different',race:r.race+1};
const key=context.riderDetailsKey(p,r),id=context.riderDetailsId(p,r),otherId=context.riderDetailsId(otherPlayer,r);
assert.equal(key,context.riderDetailsKey(otherPlayer,r));
assert.notEqual(key,context.riderDetailsKey(p,otherRace));
const row=raceRow(),elsewhere=raceRow();
const a=button(row,key,id),b=button(row,key,otherId),c=button(elsewhere,context.riderDetailsKey(p,otherRace),context.riderDetailsId(p,otherRace));let prevented=0;
const click=target=>listeners.click({target,preventDefault(){prevented++;}});
click(a);assert.equal(a.attrs['aria-expanded'],'true');assert.equal(b.attrs['aria-expanded'],'true');
assert.equal(profiles.get(id).hidden,false);assert.equal(profiles.get(otherId).hidden,false);assert.equal(row.classList.enabled,true);
assert.equal(c.attrs['aria-expanded'],'false');assert.equal(elsewhere.classList.enabled,false);
assert.match(context.riderProfileMarkup(p,r),/aria-expanded="true"/);assert.doesNotMatch(context.riderProfileMarkup(p,r),/class="rider-profile" hidden/);
assert.match(context.riderProfileMarkup(otherPlayer,r),/aria-expanded="true"/);
click(c);assert.equal(c.attrs['aria-expanded'],'true');
click(b);assert.equal(a.attrs['aria-expanded'],'false');assert.equal(b.attrs['aria-expanded'],'false');
assert.equal(profiles.get(id).hidden,true);assert.equal(profiles.get(otherId).hidden,true);assert.equal(row.classList.enabled,false);
assert.equal(c.attrs['aria-expanded'],'true');assert.equal(elsewhere.classList.enabled,true);
assert.match(context.riderProfileMarkup(p,r),/class="rider-profile" hidden/);
click(b);assert.match(context.riderProfileMarkup(p,r),/aria-expanded="true"/);
click(a);assert.equal(a.attrs['aria-expanded'],'false');assert.equal(b.attrs['aria-expanded'],'false');
assert.equal(prevented,5);
process.stdout.write('toggle pass');
'''
        out=self.node(code,{'functions':DETAILS_FUNCTIONS,'events':DETAILS_EVENTS,
                            'player':self.races[0]['players'][0],'race':self.races[0]})
        self.assertEqual(out,'toggle pass')
        self.assertNotIn('fetch(',DETAILS_EVENTS)
        self.assertNotIn('draw(',DETAILS_EVENTS)
        self.assertNotIn('localStorage',DETAILS_EVENTS)

    def test_bad_or_duplicate_adapter_and_wrong_profile_identity_are_rejected(self):
        with self.assertRaises(ValueError):apply_details(self.page,self.details)
        with self.assertRaises(ValueError):apply_details(self.before.replace('class="period"','class="missing-period"'),self.details)
        wrong=deepcopy(self.details);wrong['races'][0]['players'][0]['period']='999'
        with self.assertRaises(ValueError):apply_details(self.before,wrong)


if __name__=='__main__':unittest.main()
