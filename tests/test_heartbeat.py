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
from update_heartbeat import card_request,slot_request,dispatch,run
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
                monotonic=lambda:seconds[0],sleep=sleep,duration=40*60)
        self.assertIn('DISPATCH FAILED',output.getvalue())
        self.assertEqual(sent,[{'mode':'cards','date':'2026-11-09'},{'mode':'odds','date':''}])


if __name__=='__main__':unittest.main()
