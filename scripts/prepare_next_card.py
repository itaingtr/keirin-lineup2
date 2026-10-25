"""Prepare tomorrow's display card without collecting or storing odds/raw pages."""
import argparse
from datetime import datetime,timedelta,timezone
import hashlib
import json
import os
from pathlib import Path
import re
from zoneinfo import ZoneInfo
from collect_sources import collect,require
from render_races import render,validate
from published_card import git_read,read_published

JST=ZoneInfo('Asia/Tokyo')
ROOT=Path(__file__).resolve().parents[1]


def scheduled_target(now,cron):
    """Anchor delayed starts to the intended 21:00/23:30 slot, even after midnight."""
    require(cron in ('0 12 * * *','30 14 * * *'),'Unknown card schedule')
    minute,hour=map(int,cron.split()[:2])
    slot=now.astimezone(timezone.utc).replace(hour=hour,minute=minute,second=0,microsecond=0)
    if slot>now:
        slot-=timedelta(days=1)
    return slot.astimezone(JST).date()+timedelta(days=1)


def can_publish(target,now,previous=None):
    local=now.astimezone(JST)
    return (local.date()<=target<=local.date()+timedelta(days=1)
            and (target>local.date() or local.hour<9)
            and (previous is None or target.isoformat()>=previous))


def display_card(dataset,feed,known_dates=()):
    target,races,_=validate(dataset);compact=target.strftime('%Y%m%d')
    page=render(dataset,site=ROOT/'site')
    page,count=re.subn(r'<base href="\./"><script>.*?</script>',f'<base href="/line{compact}.html/">',page,count=1)
    require(count==1,'Unexpected page base')
    for asset in ('predictions.js','comments.css','comments.js','odds-current.js','odds-comparison.js'):
        page=page.replace('"./'+asset,'"/'+asset)
    page=page.replace('value="./line','value="/line')
    # Do not offer a link to an as-yet nonexistent next-day page.
    page=re.sub(r'<option value="/line'+(target+timedelta(days=1)).strftime('%Y%m%d')+r'\.html/"[^>]*>.*?</option>','',page)
    for raw in sorted(known_dates,reverse=True):
        if raw<compact and 'value="/line'+raw+'.html/"' not in page:
            day=datetime.strptime(raw,'%Y%m%d').date()
            option=f'<option value="/line{raw}.html/">{day.month}月{day.day}日</option>'
            page=page.replace('</select>',option+'</select>',1)
    page=page.replace("return '/open-web?to='+encodeURIComponent(source);",
                      "return '/open-web?to='+encodeURIComponent(source)+'&card="+compact+"';")
    media={'schema_version':1,'provider':'winticket','target_date':target.isoformat(),
           'checked_at':feed['checked_at'],'races':[{'source_url':r['source'],
           'players':[{k:p[k] for k in ('no','name','mark')} for p in r['players']]} for r in races]}
    encode=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    feed['target_date']=target.isoformat()
    return {'schema_version':1,'provider':'winticket','target_date':target.isoformat(),
            'checked_at':feed['checked_at'],'html':page,
            'assets':{'media.json':encode(media),'odds-config.json':encode({'endpoint':'./odds.json'}),
                      'odds.json':encode(feed)},
            'summary':{'races':len(races),'riders':sum(len(r['players']) for r in races),
                       'excluded_meetings':dataset.get('excluded_meetings',{}),
                       'odds_collected':False,'database_writes':0}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=('push','schedule','manual'),required=True)
    parser.add_argument('--schedule',default='');parser.add_argument('--date',default='')
    parser.add_argument('--previous-ref',required=True);parser.add_argument('--run-key',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();now=datetime.now(timezone.utc)
    require(re.fullmatch(r'run-\d+-\d+',args.run_key) is not None,'Invalid run key')
    from datetime import date
    target=(date.fromisoformat(args.date) if args.date else scheduled_target(now,args.schedule)
            if args.mode=='schedule' else now.astimezone(JST).date() if args.mode=='push'
            else now.astimezone(JST).date()+timedelta(days=1))
    saved=read_published(args.previous_ref)
    previous=saved[2] if saved else None
    publish=can_publish(target,now,previous)
    if args.mode!='push':
        require(publish,'Refusing to rewrite a past/in-progress card or regress the top page')
    dataset,feed=collect(target.isoformat(),include_odds=False)
    import subprocess
    names=subprocess.run(['git','ls-tree','--name-only',args.previous_ref+':fallback/cards'],text=True,capture_output=True).stdout.splitlines()
    card=display_card(dataset,feed,[x for x in names if re.fullmatch(r'\d{8}',x)])
    compact=target.strftime('%Y%m%d');prefix='fallback/cards/'+compact
    path=prefix+'/runs/'+args.run_key+'.json'
    require(git_read(args.previous_ref,path,optional=True) is None,'Immutable card run already exists')
    payload=(json.dumps(card,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
    pointer={'schema_version':1,'provider':'winticket','target_date':target.isoformat(),
             'revision':args.run_key,'path':path,'sha256':hashlib.sha256(payload).hexdigest(),
             'checked_at':card['checked_at']}
    output=args.output/path;output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(payload)
    if publish:
        encoded=json.dumps(pointer,separators=(',',':'))+'\n'
        (args.output/prefix/'latest.json').write_text(encoded)
        (args.output/'fallback/cards/current.json').write_text(encoded)
    report={**pointer,**card['summary'],'published':publish,'local_payload':str(output)}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('CARD PREPARED',json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
