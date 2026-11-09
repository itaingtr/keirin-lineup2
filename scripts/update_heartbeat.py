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


def dispatch_workflow(workflow,inputs,opener=urlopen):
    if os.environ.get('GITHUB_REPOSITORY')!=REPOSITORY:
        raise ValueError('Wrong heartbeat repository')
    if workflow not in ('update.yml','heartbeat.yml'):
        raise ValueError('Unexpected heartbeat workflow')
    payload=json.dumps({'ref':'main','inputs':inputs}).encode()
    request=Request('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/'+workflow+'/dispatches',
                    data=payload,method='POST',headers={
                        'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],
                        'Accept':'application/vnd.github+json',
                        'Content-Type':'application/json',
                        'X-GitHub-Api-Version':'2022-11-28'})
    for attempt in range(3):
        try:
            with opener(request,timeout=30) as response:
                if response.status!=204:raise ValueError('Unexpected workflow dispatch status')
            print('HEARTBEAT DISPATCH ACCEPTED 204',workflow,json.dumps(inputs),flush=True)
            return
        except (HTTPError,URLError,TimeoutError) as error:
            if attempt==2 or isinstance(error,HTTPError) and error.code not in (408,429,500,502,503,504):raise
            retry=error.headers.get('Retry-After','') if isinstance(error,HTTPError) and error.headers else ''
            time.sleep(min(60,int(retry)) if retry.isdigit() else (2,5)[attempt])


def dispatch(inputs,opener=urlopen):
    dispatch_workflow('update.yml',inputs,opener)


def renew_heartbeat(opener=urlopen):
    # Never copy a short live-probe duration into the successor. Empty inputs
    # select the workflow's normal 350/300-minute production defaults.
    dispatch_workflow('heartbeat.yml',{},opener)


def validate_window(duration,renew_after):
    if not (0<duration<=350*60 and 0<=renew_after<duration):
        raise ValueError('Heartbeat duration must be1..21000seconds with renewal before its end')


def run(send=dispatch,clock=lambda:datetime.now(timezone.utc),monotonic=time.monotonic,
        sleep=time.sleep,duration=350*60,renew_after=300*60,renewal=renew_heartbeat):
    validate_window(duration,renew_after)
    started=monotonic();end=started+duration
    next_renewal=started+renew_after
    renewed=False
    last=quarter(clock())
    print('HEARTBEAT RUNNING: hourly cards, quarter-hour odds, duration_seconds=',duration,
          'renew_after_seconds=',renew_after,flush=True)
    while monotonic()<end:
        elapsed=monotonic()
        if not renewed and elapsed>=next_renewal:
            try:
                renewal()
                renewed=True
                print('HEARTBEAT SUCCESSOR ACCEPTED: production defaults queued before handoff',flush=True)
            except Exception as error:
                print('::warning::HEARTBEAT RENEWAL RETRY',type(error).__name__,flush=True)
                next_renewal=monotonic()+30
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
        remaining=max(0,end-monotonic())
        renewal_wait=max(0,next_renewal-monotonic()) if not renewed else remaining
        sleep(min(20,remaining,renewal_wait))
    if not renewed:
        print('::error::HEARTBEAT HANDOFF FAILED: no successor was accepted',flush=True)
        raise RuntimeError('Heartbeat successor dispatch failed before handoff')
    print('HEARTBEAT HANDOFF COMPLETE: accepted successor can take over',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--duration-seconds',type=int,default=350*60)
    parser.add_argument('--renew-after-seconds',type=int,default=300*60)
    args=parser.parse_args()
    if args.once:dispatch(card_request(datetime.now(timezone.utc)))
    else:
        validate_window(args.duration_seconds,args.renew_after_seconds)
        run(duration=args.duration_seconds,renew_after=args.renew_after_seconds)


if __name__=='__main__':main()
