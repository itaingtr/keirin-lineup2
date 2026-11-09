from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import os
import sys
import unittest
from contextlib import redirect_stdout
import io
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from update_heartbeat import card_request,slot_request,dispatch,run,renew_heartbeat,validate_window
from official_odds import should_collect


class HeartbeatTests(unittest.TestCase):
    def test_day_has_24_card_checks_and_51_odds_periods_with_anchored_dates(self):
        first=datetime.fromisoformat('2026-11-08T15:00:00+00:00')
        cards=[];odds=[]
        for minute in range(24*60):
            now=first+timedelta(minutes=minute)
            request=slot_request(now)
            if not request:continue
            if request['mode']=='cards':
                cards.append(minute)
                self.assertEqual(request['date'],'2026-11-09' if minute<21*60 else '2026-11-10')
            if should_collect('2026-11-09',now):odds.append(minute)
        self.assertEqual(cards,list(range(0,24*60,60)))
        self.assertEqual(odds,list(range(8*60,20*60+31,15)))

    def test_dispatch_uses_main_and_explicit_card_date(self):
        observed=[]
        class Response:
            status=204
            def __enter__(self):return self
            def __exit__(self,*args):pass
        def open_request(request,timeout):
            self.assertEqual(request.full_url,'https://api.github.com/repos/itaingtr/keirin-lineup2/actions/workflows/update.yml/dispatches')
            observed.append(json.loads(request.data))
            return Response()
        inputs=card_request(datetime.fromisoformat('2026-11-08T12:00:00+00:00'))
        with patch.dict(os.environ,{'GITHUB_REPOSITORY':'itaingtr/keirin-lineup2','GITHUB_TOKEN':'unit-test-value'}):
            dispatch(inputs,opener=open_request)
        self.assertEqual(observed,[{'ref':'main','inputs':{'mode':'cards','date':'2026-11-09'}}])

    def test_successor_dispatch_does_not_repeat_a_short_probe_window(self):
        observed=[]
        class Response:
            status=204
            def __enter__(self):return self
            def __exit__(self,*args):pass
        def open_request(request,timeout):
            self.assertTrue(request.full_url.endswith('/workflows/heartbeat.yml/dispatches'))
            observed.append(json.loads(request.data))
            return Response()
        with patch.dict(os.environ,{'GITHUB_REPOSITORY':'itaingtr/keirin-lineup2','GITHUB_TOKEN':'unit-test-value'}):
            renew_heartbeat(opener=open_request)
        self.assertEqual(observed,[{'ref':'main','inputs':{}}])

    def test_renewal_is_queued_before_end_and_quarter_dispatch_continues(self):
        start=datetime.fromisoformat('2026-11-08T23:14:00+00:00')
        elapsed=[0];renewals=[];sent=[];output=io.StringIO()
        def sleep(seconds):elapsed[0]+=seconds
        with redirect_stdout(output):
            run(send=lambda request:sent.append((elapsed[0],request)),
                renewal=lambda:renewals.append(elapsed[0]),
                clock=lambda:start+timedelta(seconds=elapsed[0]),monotonic=lambda:elapsed[0],
                sleep=sleep,duration=180,renew_after=30)
        self.assertEqual(renewals,[30])
        self.assertEqual(sent,[(70,{'mode':'odds','date':''})])
        self.assertEqual(elapsed[0],180)
        self.assertIn('SUCCESSOR ACCEPTED',output.getvalue())
        self.assertIn('HANDOFF COMPLETE',output.getvalue())

    def test_failed_renewal_retries_while_quarter_updates_continue(self):
        start=datetime.fromisoformat('2026-11-08T23:14:20+00:00')
        elapsed=[0];attempts=[];sent=[];output=io.StringIO()
        def sleep(seconds):elapsed[0]+=seconds
        def renew():
            attempts.append(elapsed[0])
            if len(attempts)<3:raise TimeoutError('temporary')
        with redirect_stdout(output):
            run(send=lambda request:sent.append((elapsed[0],request)),renewal=renew,
                clock=lambda:start+timedelta(seconds=elapsed[0]),monotonic=lambda:elapsed[0],
                sleep=sleep,duration=120,renew_after=0)
        self.assertEqual(attempts,[0,30,60])
        self.assertEqual(sent,[(50,{'mode':'odds','date':''})])
        self.assertEqual(output.getvalue().count('RENEWAL RETRY'),2)
        self.assertIn('HANDOFF COMPLETE',output.getvalue())

    def test_permanent_renewal_failure_fails_visibly_after_keeping_time(self):
        elapsed=[0];attempts=[];output=io.StringIO()
        def sleep(seconds):elapsed[0]+=seconds
        def renew():attempts.append(elapsed[0]);raise TimeoutError('temporary')
        with redirect_stdout(output),self.assertRaisesRegex(RuntimeError,'successor dispatch failed'):
            run(send=lambda request:None,renewal=renew,
                clock=lambda:datetime(2026,11,9,tzinfo=timezone.utc)+timedelta(seconds=elapsed[0]),
                monotonic=lambda:elapsed[0],sleep=sleep,duration=90,renew_after=30)
        self.assertEqual(attempts,[30,60])
        self.assertIn('HANDOFF FAILED',output.getvalue())

    def test_worker_limits_leave_room_under_actions_six_hour_limit(self):
        validate_window(21000,18000)
        validate_window(90,30)
        for duration,renew_after in [(0,0),(21600,18000),(90,90),(90,-1)]:
            with self.assertRaises(ValueError):validate_window(duration,renew_after)

    def test_a_failed_dispatch_does_not_stop_later_quarters_or_replay_startup(self):
        start=datetime.fromisoformat('2026-11-08T22:59:00+00:00')
        seconds=[0];sent=[]
        def sleep(_):seconds[0]+=15*60
        def send(request):
            sent.append(request)
            if len(sent)==1:raise TimeoutError('transient')
        output=io.StringIO()
        with redirect_stdout(output):
            run(send=send,clock=lambda:start+timedelta(seconds=seconds[0]),
                monotonic=lambda:seconds[0],sleep=sleep,duration=40*60,renew_after=30*60,
                renewal=lambda:None)
        self.assertIn('DISPATCH FAILED',output.getvalue())
        self.assertEqual(sent,[{'mode':'cards','date':'2026-11-09'},{'mode':'odds','date':''}])


if __name__=='__main__':unittest.main()
