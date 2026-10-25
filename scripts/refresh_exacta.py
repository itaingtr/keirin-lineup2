"""Update display-only WINTICKET quotes; retain earlier successful observations."""
import argparse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import json
import os
import math
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlsplit
from collect_sources import parse_odds, query, require
from source_http import fetch
from venues import identity
from published_card import read_published


def should_collect(target,now):
    local=now.astimezone(ZoneInfo('Asia/Tokyo'))
    return target==local.date().isoformat() and 9<=local.hour<=20


def load_card(page):
    match=re.search(r'const races=(.*);\nconst body=',Path(page).read_text())
    require(match is not None,'Published card missing')
    races=json.loads(match[1]);require(bool(races),'Empty card')
    dates={identity(r['source'])['date'] for r in races}
    require(len(dates)==1,'Mixed race dates')
    day=dates.pop()
    return races,f'{day[:4]}-{day[4:6]}-{day[6:]}'


def valid_saved(snapshot,race):
    try:
        numbers=sorted(p['no'] for p in race['players'])
        require(snapshot['status']=='snapshot' and snapshot['provider']=='winticket' and snapshot['bet_type']=='exacta','Wrong saved type')
        require(snapshot['source_url']==race['source'] and snapshot['race_key']==urlsplit(race['source']).path and snapshot['rider_numbers']==numbers,'Wrong saved identity')
        observed=datetime.fromisoformat(snapshot['observed_at'])
        require(observed.tzinfo is not None and observed<=datetime.now(timezone.utc),'Invalid saved time')
        pairs=set()
        for item in snapshot['odds']:
            pair=item['first'],item['second'];value=item['value']
            require(pair not in pairs,'Duplicate pair');pairs.add(pair)
            require(value is None or type(value) in (int,float) and math.isfinite(value) and value>0,'Invalid price')
        require(pairs=={(a,b) for a in numbers for b in numbers if a!=b},'Incomplete matrix')
        return snapshot
    except (ValueError,KeyError,TypeError):return None


def read_snapshot(race,read=fetch):
    source=race['source'];ident=identity(source)
    require(ident['provider']=='winticket','Wrong provider')
    day=int(urlsplit(source).path.rstrip('/').split('/')[-2])
    params={'cupId':ident['start']+ident['code'],'index':day,'raceNumber':ident['race']}
    doc,observed=read(source,[]);data=query(doc,'FETCH_KEIRIN_RACE',params)
    schedule,card=data['schedule'],data['race'];race_id=f"{ident['race']:02}{ident['code']}{ident['date']}"
    require(schedule['cupId']==params['cupId'] and schedule['index']==day and schedule['date']==ident['date'],'Wrong schedule')
    require(card['id']==race_id and card['number']==ident['race'] and card['scheduleId']==schedule['id'],'Wrong race')
    players={p['id']:p['name'] for p in data['players']};entries=data['entries']
    require(all(e['raceId']==race_id for e in entries),'Wrong entries')
    actual={e['number']:players[e['playerId']] for e in entries}
    require(len(actual)==len(entries) and actual=={p['no']:p['name'] for p in race['players']},'Cars or rider names changed')
    return parse_odds(query(doc,'FETCH_KEIRIN_RACE_ODDS',params),race_id,source,sorted(actual),observed)


def refresh(races,previous=None,*,read=fetch,pause=1):
    old={x['snapshot']['race_key']:x['snapshot'] for x in (previous or {}).get('results',[]) if x.get('ok') and isinstance(x.get('snapshot'),dict)}
    results=[];stats={'observations':0,'fresh_snapshots':0,'unavailable':0,'retained':0,'failed':0}
    for race in races:
        key=urlsplit(race['source']).path;prior=valid_saved(old.get(key),race)
        if pause:time.sleep(pause)
        try:
            snapshot=read_snapshot(race,read);stats['observations']+=1
            if snapshot['status']=='snapshot':
                require(valid_saved(snapshot,race) is not None,'Invalid fresh snapshot')
                stats['fresh_snapshots']+=1
                if prior and datetime.fromisoformat(snapshot['observed_at'])<datetime.fromisoformat(prior['observed_at']):
                    results.append({'ok':True,'snapshot':prior,'last_check_status':'source_older'});stats['retained']+=1
                else:results.append({'ok':True,'snapshot':snapshot})
            else:
                stats['unavailable']+=1
                if prior:results.append({'ok':True,'snapshot':prior,'last_check_status':'unavailable'});stats['retained']+=1
                else:results.append({'ok':True,'snapshot':snapshot})
        except Exception as error:
            stats['failed']+=1;message=f'{type(error).__name__}: {str(error)[:180]}'
            if prior:results.append({'ok':True,'snapshot':prior,'last_check_error':message});stats['retained']+=1
            else:results.append({'ok':False,'race_key':key,'source_url':race['source'],'error':message})
        print('Exacta check',race['venue'],race['race'],'R',results[-1].get('snapshot',{}).get('status','failed'),flush=True)
    return {'schema_version':1,'provider':'winticket','checked_at':datetime.now(timezone.utc).isoformat(),'results':results},stats


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--page',type=Path,required=True);p.add_argument('--previous-ref',required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--run-key',required=True)
    args=p.parse_args();require(re.fullmatch(r'run-\d+-\d+',args.run_key) is not None,'Invalid run key')
    saved=read_published(args.previous_ref)
    races,target=(saved[1],saved[2]) if saved else load_card(args.page)
    args.output.mkdir(parents=True,exist_ok=True)
    if not should_collect(target,datetime.now(timezone.utc)):
        (args.output/'report.json').write_text(json.dumps({'skipped':True,'target_date':target,'reason':'race_day_09_to_20_jst','database_writes':0}))
        if os_path:=__import__('os').environ.get('GITHUB_OUTPUT'):
            with open(os_path,'a') as handle:handle.write('publish=false\n')
        print('EXACTA SKIPPED: collection starts at 09:00 JST on the race date',flush=True)
        return
    prefix='fallback/exacta/'+target.replace('-','')
    restored=subprocess.run(['git','show',args.previous_ref+':'+prefix+'/latest.json'],text=True,capture_output=True)
    previous=json.loads(restored.stdout) if restored.returncode==0 else {}
    require(not previous or previous.get('target_date')==target,'Previous feed has another date')
    feed,stats=refresh(races,previous);require(stats['observations']>0,'All reads failed; latest feed preserved')
    feed['target_date']=target;output=args.output/prefix;(output/'runs').mkdir(parents=True,exist_ok=True)
    run=output/'runs'/f'{args.run_key}.json';require(not run.exists(),'Immutable run already exists')
    payload=json.dumps(feed,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'
    run.write_text(payload);(output/'latest.json').write_text(payload)
    report={'target_date':target,'races':len(races),**stats,'database_writes':0,
            'endpoint':'https://raw.githubusercontent.com/'+os.environ.get('GITHUB_REPOSITORY','itaingtr/keirin-lineup2')+'/odds-diagnostics/'+prefix+'/latest.json',
            'local_feed':str(output/'latest.json')}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if os_path:=__import__('os').environ.get('GITHUB_OUTPUT'):
        with open(os_path,'a') as handle:handle.write('publish=true\n')
    print('EXACTA REFRESH',json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
