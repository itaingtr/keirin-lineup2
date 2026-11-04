"""Verified prefecture and age display fields from public K Dreams cards."""
from datetime import date, datetime, timezone
import json
from pathlib import Path
import re
import time

from kdreams_provider import PREFECTURES, _doc_read, _title, compact, fetch, parse_players, require
from venues import identity

PROVIDER = 'kdreams'


def _stamp(value):
    observed = datetime.fromisoformat(value)
    require(observed.tzinfo is not None and observed <= datetime.now(timezone.utc), 'Invalid rider detail observation time')
    return value


def _target(target):
    require(isinstance(target,str) and date.fromisoformat(target).isoformat()==target, 'Invalid rider detail date')
    return target.replace('-','')


def _row(race, source_players, observed):
    expected={p['no']:p for p in race['players']}
    actual={p['no']:p for p in source_players}
    require(1<=len(expected)<=9 and len(actual)==len(source_players) and len(expected)==len(race['players'])
            and set(actual)==set(expected), 'Rider detail cars differ')
    players=[]
    for number in sorted(expected):
        p,saved=actual[number],expected[number]
        require(compact(p['name'])==compact(saved['name']) and str(p['period'])==str(saved['period']),
                'Rider detail name or period differs')
        expected_id=saved.get('player_id',saved.get('playerId'))
        require(not expected_id or not p.get('player_id') or p['player_id']==expected_id,
                'Rider detail registration identity differs')
        players.append({'no':number,'name':saved['name'],'period':str(saved['period']),
                        'prefecture':p['prefecture'],'age':p['age']})
    return {'source_url':race['source'],'observed_at':_stamp(observed),'players':players}


def validate_details(data,races,target):
    day=_target(target)
    require(isinstance(races,list) and bool(races),'Rider detail card is empty')
    require(isinstance(data,dict) and data.get('schema_version')==1
            and data.get('provider')==PROVIDER and data.get('target_date')==target,
            'Wrong rider detail provider/date')
    _stamp(data['checked_at'])
    rows=data.get('races')
    require(isinstance(rows,list),'Rider detail races are unavailable')
    mapped={r['source_url']:r for r in rows}
    require(len(mapped)==len(rows)==len(races) and set(mapped)=={r['source'] for r in races},
            'Incomplete rider detail races')
    for race in races:
        ident=identity(race['source'])
        require(ident['provider']==PROVIDER and ident['date']==day,'Rider detail source date/provider differs')
        row=mapped[race['source']];_stamp(row['observed_at'])
        expected={p['no']:p for p in race['players']}
        players=row.get('players')
        require(isinstance(players,list),'Rider detail players are unavailable')
        by_number={p['no']:p for p in players}
        require(len(by_number)==len(players)==len(expected) and set(by_number)==set(expected),
                'Incomplete rider detail players')
        for number,p in by_number.items():
            saved=expected[number]
            require(type(number) is int and 1<=number<=9 and p.get('name')==saved['name']
                    and p.get('period')==str(saved['period']),'Rider detail car/name/period differs')
            require(p.get('prefecture') in PREFECTURES,'Invalid rider prefecture')
            require(type(p.get('age')) is int and 18<=p['age']<=100,'Invalid rider age')
    return data


def collect_details(races,target,reader=fetch,pause=.5):
    """Read only verified profile fields; never replace saved race values."""
    day=_target(target);rows=[]
    for race in races:
        ident=identity(race['source'])
        require(ident['provider']==PROVIDER and ident['date']==day,'Rider detail source date/provider differs')
        if pause:time.sleep(pause)
        doc,observed=_doc_read(race['source'],reader)
        _title(doc,race['source'])
        rows.append(_row(race,parse_players(doc),observed))
        print('RIDER DETAILS',ident['code'],ident['race'],'R verified',flush=True)
    result={'schema_version':1,'provider':PROVIDER,'target_date':target,
            'checked_at':datetime.now(timezone.utc).isoformat(),'races':rows}
    return validate_details(result,races,target)


def details_from_dataset(dataset):
    """Reuse new card observations for future nightly cards without extra reads."""
    require(dataset.get('provider')==PROVIDER,'Details require a fresh K Dreams dataset')
    sources={r['url']:r['observed_at'] for r in dataset.get('sources',[]) if r.get('provider')==PROVIDER}
    races=dataset['races'];rows=[]
    for race in races:
        require(race['source'] in sources,'Rider details lack a source observation receipt')
        rows.append(_row(race,race['players'],sources[race['source']]))
    result={'schema_version':1,'provider':PROVIDER,'target_date':dataset['target_date'],
            'checked_at':datetime.now(timezone.utc).isoformat(),'races':rows}
    return validate_details(result,races,dataset['target_date'])


def stage_details(data,run_key,output):
    """Append a fresh metadata run and advance only the latest display copy."""
    require(re.fullmatch(r'run-\d+-\d+',run_key) is not None,'Invalid immutable rider detail run key')
    races=[{'source':r['source_url'],'players':r['players']} for r in data['races']]
    validate_details(data,races,data['target_date'])
    prefix=Path(output)/'fallback/details'/data['target_date'].replace('-','')
    runs=prefix/'runs';runs.mkdir(parents=True,exist_ok=True)
    payload=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'
    with (runs/(run_key+'.json')).open('x') as handle:
        handle.write(payload)
    (prefix/'latest.json').write_text(payload)
    return payload
