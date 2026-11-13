"""Checked previous-two-meeting display history for current and future cards.

Each collection is an immutable site record.  A small checksummed pointer binds
it to the complete current race/rider identity, so ordinary odds and unchanged
hourly card checks reuse it without another history collection.
"""
from datetime import date,timedelta
import hashlib
import json
from pathlib import Path
import re
from copy import deepcopy
from datetime import datetime,timezone

from previous_flags import enrich
from previous_meetings import collect
from published_card import parse_page
from venues import identity

CUTOVER = '20261110'
PREFIX = 'previous-daily'


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def _day(value):
    raw = value.replace('-', '')
    if not re.fullmatch(r'\d{8}', raw):
        raise ValueError('Invalid daily history date')
    actual = date(int(raw[:4]), int(raw[4:6]), int(raw[6:]))
    return actual.strftime('%Y%m%d'), actual.isoformat()


def _identities(races, *, history=False):
    records = []
    seen = set()
    for race in races:
        source = race['source_url' if history else 'source']
        if source in seen or identity(source)['provider'] != 'kdreams':
            raise ValueError('Duplicate or nonofficial daily history race')
        seen.add(source)
        players = []
        cars = set()
        for player in race['players']:
            no = player['no']
            player_id = player['player_id' if history else 'playerId']
            if (type(no) is not int or not 1 <= no <= 9 or no in cars
                    or not isinstance(player_id, str) or not re.fullmatch(r'\d{6}', player_id)):
                raise ValueError('Invalid daily history rider identity')
            cars.add(no)
            players.append((no, player['name'], str(player['period']), player_id))
        if not players:
            raise ValueError('Empty daily history race')
        records.append((source, sorted(players)))
    if not records:
        raise ValueError('Empty daily history card')
    return sorted(records)


def identity_digest(races, *, history=False):
    return hashlib.sha256(encode(_identities(races, history=history)).encode()).hexdigest()


def validate_data(data, page):
    races = parse_page(page)
    _, target = _day(data['target_date'])
    if (data.get('schema_version') != 1 or data.get('provider') != 'kdreams'
            or any(identity(race['source'])['date'] != target.replace('-', '') for race in races)):
        raise ValueError('Daily history date/provider differs')
    if _identities(data['races'], history=True) != _identities(races):
        raise ValueError('Daily history rider identity differs')
    return data


def summary(data):
    days = [day for race in data['races'] for player in race['players']
            for meeting in player['meetings'] for day in meeting['days']]
    return {'races': len(data['races']),
            'riders': sum(len(race['players']) for race in data['races']),
            'results': len(days),
            'recorded_results': sum(not day.get('unavailable', False) for day in days),
            'flag_results': sum(any(day.get(flag) is True for flag in ('home', 'back', 'start'))
                                for day in days)}


def _read_checked(site, day):
    raw, target = _day(day)
    site = Path(site)
    pointer_path = site / PREFIX / raw / 'latest.json'
    if not pointer_path.exists():
        return None
    pointer = json.loads(pointer_path.read_text())
    expected = PREFIX + '/' + raw + '/runs/' + str(pointer.get('revision')) + '.json'
    if (pointer.get('schema_version') != 1 or pointer.get('provider') != 'kdreams'
            or pointer.get('target_date') != target or pointer.get('path') != expected
            or not re.fullmatch(r'run-\d+-\d+', str(pointer.get('revision')))):
        raise ValueError('Invalid checked daily history pointer')
    payload = (site / expected).read_bytes()
    if hashlib.sha256(payload).hexdigest() != pointer.get('sha256'):
        raise ValueError('Daily history checksum differs')
    data = json.loads(payload)
    if (data.get('schema_version') != 1 or data.get('provider') != 'kdreams'
            or data.get('target_date') != target
            or identity_digest(data['races'], history=True) != pointer.get('identity_sha256')):
        raise ValueError('Daily history record identity differs')
    return pointer, data


def load_daily(site, day, page):
    """Return the exact checked date history, or None before a date opts in."""
    checked = _read_checked(site, day)
    if checked is None:
        return None
    _, data = checked
    return validate_data(data, page)


def _matching_preview(site, target, page):
    site = Path(site)
    pointer_path = site / 'previous-preview/current.json'
    if not pointer_path.exists():
        return None
    pointer = json.loads(pointer_path.read_text())
    if pointer.get('target_date') != target:
        return None
    raw = target.replace('-', '')
    if (pointer.get('schema_version') != 1
            or not re.fullmatch('previous-preview/' + raw + r'/runs/run-\d+-\d+\.json', str(pointer.get('path')))):
        raise ValueError('Invalid checked previous preview pointer')
    payload = (site / pointer['path']).read_bytes()
    frozen_page = (site / 'index2.html').read_bytes()
    if (hashlib.sha256(payload).hexdigest() != pointer.get('sha256')
            or hashlib.sha256(frozen_page).hexdigest() != pointer.get('page_sha256')):
        raise ValueError('Previous preview checksum differs')
    data = validate_data(json.loads(payload), frozen_page.decode())
    if _identities(data['races'], history=True) != _identities(parse_page(page)):
        return None
    return validate_data(data, page)


def _meeting_person(source,player):
    row=identity(source)
    return (row['code'],row['start'],player.get('player_id') or player.get('playerId'),player['name'],str(player['period']))


def _seed_data(card,races,site):
    """Carry prepared rider history through every day/race/car of one meeting."""
    raw,target=_day(card['target_date']);today=date.fromisoformat(target)
    first=min(identity(r['source'])['start'] for r in races)
    wanted={_meeting_person(r['source'],p) for r in races for p in r['players']}
    old={}
    for offset in range(6):
        day=(today-timedelta(days=offset)).strftime('%Y%m%d')
        if day<max(first,CUTOVER):break
        checked=_read_checked(site,day)
        if checked is None:continue
        saved=checked[1];pending={p['player_id'] for p in saved.get('pending_history',[])}
        for row in saved['races']:
            for p in row['players']:
                key=_meeting_person(row['source_url'],p)
                if key not in wanted:continue
                waiting=p['player_id'] in pending or bool(p.get('unavailable_meetings'))
                score=(sum(not d.get('unavailable',False) for m in p['meetings'] for d in m['days']),len(p['meetings']),not waiting)
                if key not in old or score>old[key][0]:old[key]=(score,p,saved.get('sources',[]),waiting)
    data={'schema_version':1,'provider':'kdreams','target_date':target,
          'checked_at':datetime.now(timezone.utc).isoformat(),
          'sources':[],'races':[],'pending_history':[]}
    sources={}
    for race in races:
        players=[]
        for p in race['players']:
            identifier=p.get('playerId') or p.get('player_id')
            cached=old.get(_meeting_person(race['source'],p))
            if cached is None:
                row={'no':p['no'],'name':p['name'],'period':int(p['period']),'player_id':identifier,'meetings':[]}
            else:
                row=deepcopy(cached[1]);row['no']=p['no']
                for receipt in cached[2]:sources[encode(receipt)]=receipt
            if cached is None or cached[3]:
                data['pending_history'].append({'source_url':race['source'],'player_id':identifier})
            players.append(row)
        data['races'].append({'source_url':race['source'],'players':players})
    data['sources']=deepcopy(list(sources.values()))
    if not data['pending_history']:data.pop('pending_history')
    return data


def _same_display(a,b):
    def clean(value):
        if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ('observed_at','checked_at','start_observed_at','flags_observed_at')}
        if isinstance(value,list):return [clean(v) for v in value]
        return value
    return clean([a['races'],a.get('pending_history',[])])==clean([b['races'],b.get('pending_history',[])])


def seed_daily(card,races,run_key,site):
    """Bind prepared meeting history to today's roster without source reads."""
    raw,target=_day(card['target_date'])
    if raw<CUTOVER:return {'changed':False,'data':None,'path':None,'summary':None}
    checked=_read_checked(site,raw);data=_seed_data(card,races,site)
    if checked is not None and checked[0]['identity_sha256']==identity_digest(races) and _same_display(checked[1],data):
        return {'changed':False,'data':checked[1],'path':checked[0]['path'],'summary':summary(checked[1])}
    return _save_daily(card,races,run_key,site,data)


def _fill_pending(data,races,reader,target):
    needed={p['source_url'] for p in data.get('pending_history',[])}
    selected=[r for r in races if r['source'] in needed]
    if not selected:return data
    fresh=reader(selected,target)
    validate_data(fresh,'const races='+json.dumps(selected,ensure_ascii=False)+';\nconst body=')
    result=deepcopy(data);incoming={r['source_url']:r for r in fresh['races']};pending=[]
    waiting={p['player_id'] for p in data.get('pending_history',[])}
    for race in result['races']:
        if race['source_url'] not in incoming:continue
        members={p['player_id']:p for p in incoming[race['source_url']]['players']}
        for p in race['players']:
            if p['player_id'] not in waiting:continue
            new=members[p['player_id']]
            def positions(rows):
                defaults=['previous_previous','previous'] if len(rows)==2 else ['previous']
                return {m.get('position',position):m for m,position in zip(rows,defaults)}
            known=positions(p['meetings']);known.update(positions(new['meetings']))
            groups=[known[k] for k in ('previous_previous','previous') if k in known]
            if len(groups)==2 and all(m['days'] for m in groups) and max(d['race_date'] for d in groups[0]['days'])>=min(d['race_date'] for d in groups[1]['days']):
                pending.append({'source_url':race['source_url'],'player_id':p['player_id']})
                continue
            p['meetings']=groups
            missing=[k for k in new.get('unavailable_meetings',[]) if k not in known]
            p.pop('unavailable_meetings',None)
            if missing:
                p['unavailable_meetings']=missing
                pending.append({'source_url':race['source_url'],'player_id':p['player_id']})
    result.pop('pending_history',None)
    if pending:result['pending_history']=pending
    sources={encode(s):s for s in [*data.get('sources',[]),*fresh.get('sources',[])]}
    result['sources']=list(sources.values())
    return result


def ensure_daily(card, races, run_key, site, *, collector=None, refresh=False,allow_partial=False):
    """Prepare one complete verified history before a card can be advanced."""
    raw, target = _day(card['target_date'])
    if raw < CUTOVER:
        return {'changed': False, 'data': None, 'path': None, 'summary': None}
    if not re.fullmatch(r'run-\d+-\d+', run_key):
        raise ValueError('Invalid immutable daily history run key')
    page = card['html']
    expected = identity_digest(races)
    if identity_digest(parse_page(page)) != expected:
        raise ValueError('Daily history card/races differ')
    checked = _read_checked(site, raw)
    reused_preview = False
    if refresh:
        reader=collector or (lambda rows,day:collect(rows,day,allow_partial=allow_partial))
        data=enrich(_fill_pending(_seed_data(card,races,site),races,reader,target),site)
        from recent_flags import enrich as enrich_recent_flags
        data=enrich_recent_flags(data,site)
        if checked is not None and checked[0]['identity_sha256']==expected and _same_display(checked[1],data):
            return {'changed':False,'data':checked[1],'path':checked[0]['path'],'summary':summary(checked[1])}
    elif checked is not None and checked[0]['identity_sha256'] == expected:
        pointer, data = checked
        validate_data(data, page)
        from recent_flags import enrich as enrich_recent_flags
        updated = enrich_recent_flags(data, site)
        if updated == data:
            return {'changed': False, 'data': data, 'path': pointer['path'], 'summary': summary(data)}
        data = updated
    else:
        data = _matching_preview(site, target, page)
        reused_preview = data is not None
        if data is None:
            reader=collector or (lambda rows,day:collect(rows,day,allow_partial=allow_partial))
            data = enrich(reader(races, target), site)
        from recent_flags import enrich as enrich_recent_flags
        data = enrich_recent_flags(data, site)
    return _save_daily(card,races,run_key,site,data,reused_preview=reused_preview)


def _save_daily(card,races,run_key,site,data,*,reused_preview=False):
    raw,target=_day(card['target_date']);expected=identity_digest(races)
    if not re.fullmatch(r'run-\d+-\d+',run_key):raise ValueError('Invalid immutable daily history run key')
    validate_data(data, card['html'])
    # A rider with no prior starts legitimately contributes no result rows.
    data = dict(data)
    data['summary'] = summary(data)
    payload = encode(data).encode()
    relative = PREFIX + '/' + raw + '/runs/' + run_key + '.json'
    destination = Path(site) / relative
    if destination.exists():
        raise ValueError('Immutable daily history run already exists')
    pointer = {'schema_version': 1, 'provider': 'kdreams', 'target_date': target,
               'revision': run_key, 'path': relative,
               'sha256': hashlib.sha256(payload).hexdigest(), 'identity_sha256': expected}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as handle:
        handle.write(payload)
    (Path(site) / PREFIX / raw / 'latest.json').write_text(encode(pointer))
    print('DAILY PREVIOUS MEETINGS READY', target, encode(data['summary']).strip(),
          'reused_preview=' + str(reused_preview).lower(), flush=True)
    return {'changed': True, 'data': data, 'path': relative, 'summary': data['summary']}
