"""Keep dispatching timed updates while an Actions runner is alive."""
import argparse
from datetime import datetime,timedelta,timezone
import json
import os
import time
from urllib.error import HTTPError,URLError
from urllib.request import Request,urlopen
from zoneinfo import ZoneInfo

JST=ZoneInfo('Asia/Tokyo')
REPOSITORY='itaingtr/keirin-lineup2'


def card_request(now):
    local=now.astimezone(JST)
    target=local.date()+timedelta(days=int(local.hour>=21))
    return {'mode':'cards','date':target.isoformat()}


def slot_request(now):
    local=now.astimezone(JST)
    if local.minute==0:return card_request(now)
    minute=local.hour*60+local.minute
    if local.minute%15==0 and 8*60<=minute<=20*60+30:
        return {'mode':'odds','date':''}
    return None


def quarter(now):
    return now.replace(minute=now.minute//15*15,second=0,microsecond=0)


def dispatch(inputs,opener=urlopen):
    if os.environ.get('GITHUB_REPOSITORY')!=REPOSITORY:
        raise ValueError('Wrong heartbeat repository')
    payload=json.dumps({'ref':'main','inputs':inputs}).encode()
    request=Request('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/update.yml/dispatches',
                    data=payload,method='POST',headers={
                        'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],
                        'Accept':'application/vnd.github+json',
                        'Content-Type':'application/json',
                        'X-GitHub-Api-Version':'2022-11-28'})
    for attempt in range(3):
        try:
            with opener(request,timeout=30) as response:
                if response.status!=204:raise ValueError('Unexpected workflow dispatch status')
            print('HEARTBEAT DISPATCH ACCEPTED 204',json.dumps(inputs),flush=True)
            return
        except (HTTPError,URLError,TimeoutError) as error:
            if attempt==2 or isinstance(error,HTTPError) and error.code not in (408,429,500,502,503,504):raise
            retry=error.headers.get('Retry-After','') if isinstance(error,HTTPError) and error.headers else ''
            time.sleep(min(60,int(retry)) if retry.isdigit() else (2,5)[attempt])


def run(send=dispatch,clock=lambda:datetime.now(timezone.utc),monotonic=time.monotonic,
        sleep=time.sleep,duration=350*60):
    end=monotonic()+duration
    last=quarter(clock())
    print('HEARTBEAT RUNNING: hourly cards, quarter-hour odds, 350-minute handoff',flush=True)
    while monotonic()<end:
        now=clock();slot=quarter(now)
        if slot>last:
            last=slot
            inputs=slot_request(slot)
            if inputs:
                try:send(inputs)
                except Exception as error:
                    # A transient dispatch failure must not kill all later
                    # quarters. Failed calls are visible, without token data.
                    print('::error::HEARTBEAT DISPATCH FAILED',type(error).__name__,
                          inputs['mode'],slot.isoformat(),flush=True)
        sleep(min(20,max(0,end-monotonic())))
    print('HEARTBEAT HANDOFF: watchdog continuation can start',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    if args.once:dispatch(card_request(datetime.now(timezone.utc)))
    else:run()


if __name__=='__main__':main()
