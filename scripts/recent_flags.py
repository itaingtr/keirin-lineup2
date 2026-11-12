"""Shared exact-race SHB evidence for the previous two meetings.

H/B come from KEIRIN.JP results. Its public result has no S field; S comes
only from a separately matched K Dreams result reached through its calendar.
"""
from concurrent.futures import ThreadPoolExecutor,as_completed
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from decimal import Decimal
import hashlib,json
from pathlib import Path
import re,time
from urllib.parse import urlsplit

from keirin_jp_provider import OfficialClient,result_url
from kdreams_provider import _doc_read,fetch,parse_schedule,race_identity,compact
from kdreams_history import parse_result_flags
from previous_flags import _race,_person,_placing,_stamp,_time

PREFIX='result-flags'
CUTOVER='20261113'
FIELDS=('start','home','back')

def encode(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'
def require(value,message):
    if not value:raise ValueError(message)

def read_index(site):
    path=Path(site)/PREFIX/'current.json'
    data=json.loads(path.read_text()) if path.exists() else {'schema_version':1,'races':{}}
    require(data.get('schema_version')==1 and isinstance(data.get('races'),dict),'Invalid shared result-flag index')
    return data

def validate_record(data):
    race=_race(data);require(race is not None and data.get('schema_version')==1,'Invalid exact-race flag identity')
    require(_stamp(data.get('checked_at')) is not None,'Invalid result-flag check time')
    people=set();cars=set()
    for player in data['players']:
        person=_person(player,'player_id');require(person is not None and person[0] not in people,'Duplicate result-flag rider')
        people.add(person[0]);car=player['no'];require(type(car) is int and 1<=car<=9 and car not in cars,'Invalid flag car')
        cars.add(car);require(_placing(player) is not None and _time(player.get('final_half_record')) is not False,'Invalid flag placing/time')
        for field in FIELDS:
            value=player.get(field);require(value is None or type(value) is bool,'Invalid SHB flag')
            if value is None:continue
            source=player.get('flag_sources',{}).get(field,{})
            require(_stamp(source.get('observed_at')) is not None,'Missing flag observation receipt')
            if field in ('home','back'):
                require(source.get('provider')=='keirin.jp' and source.get('url')==result_url(*race),'Wrong official flag receipt')
            else:
                from kdreams_provider import check_url
                require(source.get('provider')=='kdreams','S needs an actual independently published source')
                check_url(source['url']);parsed=urlsplit(source['url']);ident=race_identity(source['url'])
                require(parsed.query=='pageType=showResult' and (ident['code'],ident['date'],ident['race'])==race,'Wrong S result receipt')
        require(type(player.get('home')) is bool and type(player.get('back')) is bool,'Official H/B evidence missing')
    require(bool(people),'Empty result-flag race')
    return data

def read_record(site,entry):
    path=entry['path'];require(re.fullmatch(PREFIX+r'/\d{12}/[0-9a-f]{64}\.json',path),'Invalid shared flag path')
    payload=(Path(site)/path).read_bytes()
    require(hashlib.sha256(payload).hexdigest()==entry['sha256'],'Result-flag checksum differs')
    return validate_record(json.loads(payload))

def wanted(data):
    if data['target_date'].replace('-','')<CUTOVER:return {}
    result={}
    for race in data['races']:
        for player in race['players']:
            for meeting in player['meetings']:
                for day in meeting['days']:
                    if _race(day) is None or day.get('race_date_inferred') or day.get('unavailable'):continue
                    if day.get('player_id')!=player['player_id']:continue
                    result.setdefault(day['race_id'],[]).append((player,day))
    return result

def same_result(a,b):
    at,bt=_time(a.get('final_half_record')),_time(b.get('final_half_record'))
    if at is False or bt is False:return False
    return _placing(a)==_placing(b) and (at is None and bt is None or at is not None and bt is not None and Decimal(at)==Decimal(bt))

def pending(data,site,now=None):
    now=now or datetime.now(timezone.utc);index=read_index(site);out={}
    for identifier,rows in wanted(data).items():
        entry=index['races'].get(identifier)
        if entry is None:out[identifier]=rows;continue
        record=read_record(site,entry)
        if all(type(p.get('start')) is bool for p in record['players']):continue
        # Missing/unavailable supplementary S evidence is retried hourly,
        # without a publication/worker dispatch loop.
        if now>=datetime.fromisoformat(record['checked_at'])+timedelta(hours=1):out[identifier]=rows
    return out

def enrich(data,site):
    result=deepcopy(data);index=read_index(site);cache={};attached=0;unmatched=0
    for identifier,rows in wanted(result).items():
        entry=index['races'].get(identifier)
        if entry is None:continue
        record=cache.setdefault(identifier,read_record(site,entry))
        require(record['race_id']==identifier,'Shared flags point to another race')
        people={_person(p,'player_id'):p for p in record['players']}
        for player,day in rows:
            actual=people.get(_person(player,'player_id'))
            if actual is None or not same_result(day,actual):unmatched+=1;continue
            for field in FIELDS:
                if type(actual.get(field)) is not bool:continue
                if type(day.get(field)) is bool:
                    require(day[field]==actual[field],'Saved and newly checked SHB flags disagree')
                source=actual['flag_sources'][field]
                if day.get(field)!=actual[field] or day.get('flag_sources',{}).get(field)!=source:attached+=1
                day[field]=actual[field];day.setdefault('flag_sources',{})[field]=deepcopy(source)
                if field=='start':day.update(start_source_url=source['url'],start_observed_at=source['observed_at'])
                else:day.update(flags_provider='keirin.jp',flags_source_url=source['url'],flags_observed_at=source['observed_at'])
    if attached or unmatched:print('RECENT SHB ATTACHED',attached,'verified individual fields;',unmatched,'placing/time mismatches left unchanged',flush=True)
    return result

def collect_day(raw,identifiers,known,client_factory=OfficialClient,read=fetch):
    """One ordinary session per worker; all races on a day share calendars."""
    client=client_factory();records=[];errors=[];calendar=None;calendar_error=None
    try:
        url='https://keirin.kdreams.jp/racecard/'+raw[:4]+'/'+raw[4:6]+'/'+raw[6:]+'/'
        doc,_=_doc_read(url,read);calendar={}
        for meeting in parse_schedule(doc,url,raw[:4]+'-'+raw[4:6]+'-'+raw[6:]):
            for source in meeting['urls']:
                ident=race_identity(source);key=f"{ident['race']:02}{ident['code']}{raw}"
                require(key not in calendar,'Ambiguous historical K result coordinate');calendar[key]=source+'?pageType=showResult'
    except Exception as error:calendar_error=type(error).__name__+': '+str(error)[:180]
    failed_venues={}
    for identifier in sorted(identifiers):
        code=identifier[2:4];number=int(identifier[:2]);previous=known.get(identifier)
        try:
            if previous is not None:record=deepcopy(previous)
            else:
                if code in failed_venues:raise ValueError(failed_venues[code])
                try:cards,_=client.cards(code,raw)
                except Exception as error:
                    failed_venues[code]=str(error)[:180];raise
                require(number in cards,'Historical official race missing')
                entries=cards[number]['players']
                # The flags cache does not store inferred meeting-day numbers.
                official=client.results(code,raw,number,raw,entries)
                record={'schema_version':1,'race_id':identifier,'race_date':raw[:4]+'-'+raw[4:6]+'-'+raw[6:],
                        'race_number':number,'players':[]}
                for no,member in entries.items():
                    actual=official.get(member['player_id'])
                    if actual is None:continue
                    source={'provider':'keirin.jp','url':actual['result_url'],'observed_at':actual['observed_at']}
                    record['players'].append({'no':no,'name':member['name'],'period':member['period'],
                        'player_id':member['player_id'],'order':actual['order'],'accident':actual['accident'],
                        'final_half_record':actual['final_half_record'],'home':actual['home'],'back':actual['back'],
                        'start':None,'flag_sources':{'home':deepcopy(source),'back':deepcopy(source)}})
            # Never fabricate K meeting starts from a rider's first actual ride.
            # Only an exact date/code/race URL read from its calendar is used.
            if any(p.get('start') is None for p in record['players']):
                try:
                    require(calendar is not None and identifier in calendar,calendar_error or 'Historical K calendar race missing')
                    url=calendar[identifier];time.sleep(.5);doc,observed=_doc_read(url,read)
                    krows=parse_result_flags(doc,url)
                    for player in record['players']:
                        row=krows.get(player['no'])
                        if row is None or compact(row['name'])!=compact(player['name']) or str(row['period'])!=str(player['period']):continue
                        candidate={'order':int(row['rank']) if re.fullmatch(r'[1-9]',row['rank']) else 0,
                                   'accident':'' if re.fullmatch(r'[1-9]',row['rank']) else row['rank'],
                                   'final_half_record':row['time']}
                        if not same_result(player,candidate) or row['back']!=player['back']:continue
                        player['start']=row['start'];player['flag_sources']['start']={'provider':'kdreams','url':url,'observed_at':observed}
                except Exception as error:
                    print('RECENT S SOURCE UNAVAILABLE',identifier,type(error).__name__,str(error)[:180],flush=True)
            record['checked_at']=datetime.now(timezone.utc).isoformat();validate_record(record);records.append(record)
        except Exception as error:
            diagnostic={'race_id':identifier,'error':type(error).__name__+': '+str(error)[:220]};errors.append(diagnostic)
            print('RECENT OFFICIAL FLAG SOURCE FAILED',json.dumps(diagnostic),flush=True)
        print('RECENT SHB RACE CHECKED',identifier,len(records),'verified',flush=True)
    return records,errors

def collect(data,site,checkpoint=None,*,client_factory=OfficialClient,read=fetch,workers=2):
    planned=pending(data,site);index=read_index(site);known={}
    for identifier in planned:
        if identifier in index['races']:known[identifier]=read_record(site,index['races'][identifier])
    groups={}
    for identifier in planned:groups.setdefault(identifier[4:],[]).append(identifier)
    records=[];errors=[]
    print('RECENT SHB PLAN',len(planned),'new/incomplete races;',len(groups),'calendar days',flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures={pool.submit(collect_day,raw,ids,known,client_factory,read):raw for raw,ids in sorted(groups.items())}
        for future in as_completed(futures):
            batch,failures=future.result();records.extend(batch);errors.extend(failures)
            if checkpoint:
                folder=Path(checkpoint);folder.mkdir(parents=True,exist_ok=True)
                for record in batch:(folder/(record['race_id']+'.json')).write_text(encode(record))
            print('RECENT SHB PROGRESS',len(records),'/',len(planned),'races;',len(errors),'errors',flush=True)
    return {'schema_version':1,'records':records,'errors':errors,'requested_races':len(planned)}

def apply(site,batch):
    site=Path(site);index=read_index(site);changed=False
    for data in batch['records']:
        validate_record(data);identifier=data['race_id'];entry=index['races'].get(identifier)
        if entry:
            previous=read_record(site,entry)
            if datetime.fromisoformat(previous['checked_at'])>=datetime.fromisoformat(data['checked_at']):continue
        payload=encode(data).encode();digest=hashlib.sha256(payload).hexdigest();relative=PREFIX+'/'+identifier+'/'+digest+'.json'
        path=site/relative;path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists():require(path.read_bytes()==payload,'Immutable flag race revision differs')
        else:
            with path.open('xb') as handle:handle.write(payload)
        index['races'][identifier]={'path':relative,'sha256':digest};changed=True
    if changed:(site/PREFIX/'current.json').write_text(encode(index))
    print('RECENT SHB CACHE READY',len(index['races']),'races',flush=True)
    return changed
