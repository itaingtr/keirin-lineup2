"""Shared, immutable rider histories and small date-bound card references.

Current-race statistics/results stay in their existing daily card. Historical
meetings belong to JKA identities, not car numbers, races, or calendar pages.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from previous_daily import identity_digest,load_daily
from published_card import parse_page
from venues import identity,VENUES

CUTOVER='20261113'
PREFIX='rider-history'
DAILY='ten-daily'

def encode(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'

def require(value,message):
    if not value:raise ValueError(message)

def person(player):
    return (player.get('player_id') or player.get('playerId'),player['name'],str(player['period']))

def context(race):
    row=identity(race.get('source') or race['source_url'])
    return row['code']+':'+row['start']

def _write_immutable(path,payload):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():require(path.read_bytes()==payload,'Immutable rider history differs')
    else:
        with path.open('xb') as handle:handle.write(payload)

def read_index(site):
    path=Path(site)/PREFIX/'current.json'
    if not path.exists():return {'schema_version':1,'players':{}}
    data=json.loads(path.read_text())
    require(data.get('schema_version')==1 and isinstance(data.get('players'),dict),'Invalid rider catalogue')
    return data

def read_player(site,entry):
    identifier=entry['player_id'];path=entry['path']
    require(re.fullmatch(r'\d{6}',identifier) and re.fullmatch(PREFIX+'/'+identifier+r'/[0-9a-f]{64}\.json',path),
            'Invalid immutable rider history path')
    payload=(Path(site)/path).read_bytes()
    require(hashlib.sha256(payload).hexdigest()==entry['sha256'],'Rider history checksum differs')
    data=json.loads(payload)
    require(data.get('schema_version')==1 and person(data)==person(entry),'Rider history identity differs')
    return data

def save_player(site,index,player,meetings,*,checked=(),pending=()):
    identifier,name,period=person(player)
    require(isinstance(identifier,str) and re.fullmatch(r'\d{6}',identifier),'Invalid shared rider identity')
    body={'schema_version':1,'player_id':identifier,'name':name,'period':int(period),'meetings':meetings}
    payload=encode(body).encode();digest=hashlib.sha256(payload).hexdigest()
    relative=PREFIX+'/'+identifier+'/'+digest+'.json'
    _write_immutable(Path(site)/relative,payload)
    index['players'][identifier]={'player_id':identifier,'name':name,'period':int(period),
        'path':relative,'sha256':digest,'checked_contexts':sorted(set(checked)),
        'pending_contexts':sorted(set(pending)-set(checked))}
    return index['players'][identifier]

def _bootstrap(site,index):
    pointer=Path(site)/'ten-preview/current.json'
    if not pointer.exists():return False
    meta=json.loads(pointer.read_text());relative=meta['path']
    require(re.fullmatch(r'ten-preview/\d{8}/runs/run-\d+-\d+\.json',relative),'Invalid bootstrap history path')
    payload=(Path(site)/relative).read_bytes();page=(Path(site)/'ten-preview/index2.html').read_bytes()
    require(hashlib.sha256(payload).hexdigest()==meta['sha256']
            and hashlib.sha256(page).hexdigest()==meta['page_sha256'],'Bootstrap history checksum differs')
    from ten_preview import validate
    data=validate(json.loads(payload),page.decode());current={r['source']:r for r in parse_page(page.decode())}
    profile_sources={r['url']:r for r in data.get('sources',[]) if r.get('kind')=='ten_meeting_profile'}
    changed=False
    for race in data['races']:
        ctx=context(current[race['source_url']])
        for player in race['players']:
            identifier=player['player_id']
            if identifier in index['players']:continue
            meetings=deepcopy(player['meetings'])
            source=profile_sources.get('https://keirin.jp/pc/racerprofile?snum='+identifier)
            for meeting in meetings:
                meeting['provider']='keirin.jp'
                if source:meeting['rank_source']=source
            save_player(site,index,player,meetings,checked=[ctx]);changed=True
    return changed

def _dates(meeting):
    return {r['race_date'] for r in meeting['days'] if not r.get('unavailable')}

def _same_meeting(a,b):
    if a['venue_code']!=b['venue_code']:return False
    ai={d['race_id'] for d in a['days'] if d.get('race_id')}
    bi={d['race_id'] for d in b['days'] if d.get('race_id')}
    return bool(ai&bi) or a['start_date']==b['start_date']


class HistoryConflict(ValueError):
    pass


def _identified_starts(meeting):
    return sum(bool(d.get('race_id')) and d.get('race_date_inferred') is not True for d in meeting['days'])


def _resolved_meetings(meetings):
    """An inferred profile date must not duplicate an identified race."""
    result=[]
    for incoming in sorted(deepcopy(meetings),key=lambda m:(min(_dates(m)),m['start_date'])):
        conflicts=[m for m in result if not (max(_dates(m))<min(_dates(incoming)) or max(_dates(incoming))<min(_dates(m)))]
        discard=False
        for old in conflicts:
            a,b=_identified_starts(old),_identified_starts(incoming)
            if a and not b:discard=True;break
            if b and not a:continue
            raise HistoryConflict('Conflicting historical meetings with equal race evidence')
        if discard:continue
        result=[m for m in result if m not in conflicts]+[incoming]
    for a,b in zip(result,result[1:]):
        if a['start_date']>=b['start_date']:raise HistoryConflict('Historical meeting starts are ambiguous')
    return result

def merge_meetings(old,new):
    """Append new completed meetings; preserve richer verified older rows."""
    result=deepcopy(old)
    for incoming in new:
        if not incoming.get('days'):continue
        matches=[i for i,m in enumerate(result) if _same_meeting(m,incoming)]
        require(len(matches)<=1,'Ambiguous shared historical meeting')
        if not matches:result.append(deepcopy(incoming));continue
        i=matches[0];existing=result[i]
        if _identified_starts(existing) and not _identified_starts(incoming):continue
        known={d.get('race_id'):(d.get('order'),d.get('accident','')) for d in existing['days'] if d.get('race_id')}
        fresh={d.get('race_id'):(d.get('order'),d.get('accident','')) for d in incoming['days'] if d.get('race_id')}
        if (set(fresh)<=set(known) and all(known[k]==v for k,v in fresh.items())
                and _dates(incoming)<=_dates(existing)):
            if (incoming.get('provider')=='keirin.jp' and existing.get('provider')!='keirin.jp'
                    and set(known)<=set(fresh)):
                result[i]=deepcopy(incoming)
            continue
        # A newly observed correction keeps its actual provider. Race types
        # remain independent of a placing and can reuse exact verified IDs.
        updated=deepcopy(incoming);old_rows={d.get('race_id'):d for d in existing['days'] if d.get('race_id')}
        for row in updated['days']:
            prior=old_rows.get(row.get('race_id'),{})
            for key in ('race_type','highlight_rank','semifinal_rank','race_type_source_url','race_type_observed_at'):
                if key not in row and key in prior:row[key]=prior[key]
            if not row.get('race_type') and prior.get('race_type'):
                for key in ('race_type','highlight_rank','semifinal_rank','race_type_source_url','race_type_observed_at'):
                    if key in prior:row[key]=prior[key]
        # A recent-results source may contain only one corrected start from
        # an older, fully checked meeting. Keep its other actual starts.
        if (fresh and set(fresh)<set(known) and len(fresh)==len(updated['days'])
                and _dates(incoming)<=_dates(existing)):
            replacements={d['race_id']:d for d in updated['days']}
            updated['days']=[replacements.get(d.get('race_id'),deepcopy(d)) for d in existing['days']]
            updated['calendar_sequence_verified']=existing.get('calendar_sequence_verified',False)
        if existing.get('start_date_inferred') is not True:
            updated['start_date']=existing['start_date'];updated['start_date_inferred']=False
        result[i]=updated
    return _resolved_meetings(result)[-10:]

def _previous_meetings(player):
    meetings=[]
    for source in player.get('meetings',[]):
        rows=[]
        for raw in source['days']:
            if raw.get('unavailable'):continue
            row=deepcopy(raw);row['provider']='kdreams'
            row['race_type']=row.get('race_type') or ''
            if row.get('race_date_inferred'):
                row.update(race_id=None,race_number=None,video_url=None)
            rows.append(row)
        if not rows:continue
        meeting=deepcopy(source);meeting['days']=rows;meeting['provider']='kdreams'
        # Literal digest links observed in K Dreams already identify each
        # actual date; they do not rely on compact profile ordinal positions.
        meeting['calendar_sequence_verified']=all(not d.get('video_url') or not d.get('race_date_inferred') for d in rows)
        meetings.append(meeting)
    return meetings

def _eligible(meetings,race):
    raw=identity(race['source'])['start'];before=raw[:4]+'-'+raw[4:6]+'-'+raw[6:]
    return [deepcopy(m) for m in meetings if m['start_date']<before
            and all(d['race_date']<before for d in m['days'])][-10:]

def ensure(site,card,races,run_key):
    """Build a reference-only date snapshot without a historical source read."""
    site=Path(site);day=card['target_date'].replace('-','')
    if day<CUTOVER:return {'changed':False,'pending':0}
    require(re.fullmatch(r'run-\d+-\d+',run_key),'Invalid shared-history run')
    require(identity_digest(parse_page(card['html']))==identity_digest(races),'Shared-history card differs')
    index=read_index(site);before_index=encode(index);_bootstrap(site,index)
    previous=load_daily(site,day,card['html'])
    require(previous is not None,'Checked previous meetings missing for shared history')
    recent={r['source_url']:{p['player_id']:p for p in r['players']} for r in previous['races']}
    try:prepared=load_snapshot(site,day,card['html'])
    except (ValueError,FileNotFoundError):prepared=None
    prepared_refs={person(p):p['history_ref'] for r in (prepared or {}).get('races',[]) for p in r['players']}
    output=[];full=[];pending=0
    for race in races:
        ctx=context(race);players=[];full_players=[]
        for player in race['players']:
            identifier,name,period=person(player);entry=index['players'].get(identifier)
            same=entry is not None and person(entry)==person(player)
            cached=read_player(site,entry)['meetings'] if same else []
            checked=entry.get('checked_contexts',[]) if same else []
            waiting=entry.get('pending_contexts',[]) if same else []
            fallback=None
            try:
                count_before=len(cached)
                cached=merge_meetings(cached,[] if ctx in checked else _previous_meetings(recent[race['source']][identifier]))
                if len(cached)<count_before:checked=[x for x in checked if x!=ctx]
            except HistoryConflict as error:
                print('SHARED HISTORY RIDER PENDING',identifier,ctx,str(error),flush=True)
                checked=[x for x in checked if x!=ctx]
                old_ref=prepared_refs.get(person(player))
                fallback=(read_player(site,{**player,'player_id':identifier,**old_ref})['meetings'] if old_ref else [])
            if ctx not in checked:waiting=sorted(set(waiting+[ctx]))
            entry=save_player(site,index,player,cached,checked=checked,pending=waiting)
            view=_eligible(cached if fallback is None else fallback,race)
            if view!=cached:
                temporary={'players':{}}
                ref=save_player(site,temporary,player,view)
            else:ref=entry
            needs=ctx not in checked
            pending+=int(needs)
            base={'no':player['no'],'name':name,'period':int(period),'player_id':identifier}
            players.append({**base,'history_ref':{k:ref[k] for k in ('path','sha256')},'pending':needs})
            full_players.append({**base,'meetings':view})
        output.append({'source_url':race['source'],'players':players})
        full.append({'source_url':race['source'],'players':full_players})
    providers=sorted({m.get('provider','keirin.jp') for r in full for p in r['players'] for m in p['meetings']})
    data={'schema_version':1,'provider':'mixed' if 'kdreams' in providers else 'keirin.jp',
          'history_storage':'rider-master','target_date':card['target_date'],'source_providers':providers,'races':output}
    from ten_preview import validate,summary
    complete={**data,'races':full};validate(complete,card['html']);data['summary']={**summary(complete),'pending_riders':pending}
    relative=DAILY+'/'+day+'/runs/'+run_key+'.json';pointer_path=site/DAILY/day/'latest.json'
    payload=encode(data).encode();digest=hashlib.sha256(payload).hexdigest()
    changed=True
    if pointer_path.exists():
        prior=json.loads(pointer_path.read_text())
        prior_payload=(site/prior['path']).read_bytes()
        require(hashlib.sha256(prior_payload).hexdigest()==prior['sha256'],'Shared daily history checksum differs')
        changed=prior['sha256']!=digest
    if changed:
        _write_immutable(site/relative,payload)
        pointer={'schema_version':1,'target_date':card['target_date'],'path':relative,'sha256':digest,
                 'identity_sha256':identity_digest(races)}
        pointer_path.parent.mkdir(parents=True,exist_ok=True);pointer_path.write_text(encode(pointer))
    if encode(index)!=before_index:
        (site/PREFIX).mkdir(parents=True,exist_ok=True);(site/PREFIX/'current.json').write_text(encode(index))
    print('SHARED RIDER HISTORY READY',card['target_date'],'riders',sum(len(r['players']) for r in output),
          'catalogue',len(index['players']),'pending',pending,'historical_source_reads',0,flush=True)
    return {'changed':changed or encode(index)!=before_index,'pending':pending,'summary':data['summary']}

def load_snapshot(site,day,page):
    site=Path(site);pointer=site/DAILY/day/'latest.json'
    if not pointer.exists():return None
    meta=json.loads(pointer.read_text());path=meta.get('path','')
    require(re.fullmatch(DAILY+'/'+day+r'/runs/run-\d+-\d+\.json',path),'Invalid shared daily history path')
    payload=(site/path).read_bytes()
    require(hashlib.sha256(payload).hexdigest()==meta.get('sha256'),'Shared daily history checksum differs')
    require(meta.get('identity_sha256')==identity_digest(parse_page(page)),'Shared date history identity differs')
    data=json.loads(payload);hydrate(site,data,page)
    return data

def hydrate(site,data,page):
    full=deepcopy(data)
    for race in full['races']:
        for player in race['players']:
            entry={**player,**player['history_ref']}
            record=read_player(site,entry)
            player['meetings']=record['meetings']
    from ten_preview import validate
    return validate(full,page)

def export_daily(site,output,page,day):
    data=load_snapshot(site,day,page)
    if data is None:return page,None
    from export_pages import BASE
    page,n=re.subn(r'<body\b','<body data-ten-meetings="true"',page,count=1)
    require(n==1,'Shared-history page body missing')
    for name in ('ten-meetings.css','ten-meetings.js'):
        content=(Path(site)/name).read_bytes()
        from direct_replay import history_asset
        name,content=history_asset(name,content,day)
        version=hashlib.sha256(content).hexdigest()[:12]
        (Path(output)/name).write_bytes(content)
        tag=(f'<link rel="stylesheet" href="{BASE}{name}?v={version}">' if name.endswith('.css')
             else f'<script src="{BASE}{name}?v={version}"></script>')
        closing='</head>' if name.endswith('.css') else '</body>'
        page=page.replace(closing,tag+closing,1)
    for race in data['races']:
        for player in race['players']:
            relative=player['history_ref']['path'];destination=Path(output)/relative
            destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes((Path(site)/relative).read_bytes())
    relative='data/'+day+'/ten-meetings.json';destination=Path(output)/relative
    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(encode(data))
    return page,{'data_path':relative,'target_date':data['target_date'],**data['summary']}

def refresh_subset(site,races):
    index=read_index(site);selected=[]
    for race in races:
        ctx=context(race);members=[]
        for player in race['players']:
            entry=index['players'].get(person(player)[0])
            if not entry or person(entry)!=person(player) or ctx not in entry.get('checked_contexts',[]):members.append(player)
        if members:selected.append({**race,'players':members})
    return selected

def known_histories(site,races):
    index=read_index(site);known={}
    for race in races:
        for player in race['players']:
            entry=index['players'].get(person(player)[0])
            if entry and person(entry)==person(player):known[person(player)[0]]=read_player(site,entry)['meetings']
    return known

def apply_official(site,data,races):
    """Merge a completed batch against latest main, keeping every old revision."""
    require(data.get('provider')=='keirin.jp','Shared refresh needs actual official observations')
    require(identity_digest(data['races'],history=True)==identity_digest(races),'Shared refresh identities differ')
    site=Path(site);index=read_index(site);changed=False
    sources={r['url']:r for r in data.get('sources',[]) if r.get('kind')=='ten_meeting_profile'}
    for race in data['races']:
        ctx=context(race)
        for player in race['players']:
            identifier=person(player)[0];entry=index['players'].get(identifier)
            same=entry is not None and person(entry)==person(player)
            old=read_player(site,entry)['meetings'] if same else []
            newer=deepcopy(player['meetings'])
            for m in newer:
                m.setdefault('provider','keirin.jp')
                source=sources.get('https://keirin.jp/pc/racerprofile?snum='+identifier)
                if source:m['rank_source']=source
            try:merged=merge_meetings(old,newer)
            except HistoryConflict as error:
                print('SHARED HISTORY RIDER PENDING',identifier,ctx,str(error),flush=True)
                continue
            checked=(entry.get('checked_contexts',[]) if same else [])+[ctx]
            current=save_player(site,index,player,merged,checked=checked,pending=[])
            changed=changed or current!=entry
    if changed:(site/PREFIX/'current.json').write_text(encode(index))
    return changed
