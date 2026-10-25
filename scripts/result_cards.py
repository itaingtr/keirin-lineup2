"""Display only verified official result rows, preserving the original strings."""
from datetime import datetime, timezone
from urllib.parse import urlsplit

from collect_sources import require
from venues import identity, VENUES


def normalize_result(data, source, observed_at):
    card_url=source.replace('/raceresult/','/racecard/')
    ident=identity(card_url)
    race,schedule=data['race'],data['schedule']
    expected=f"{ident['race']:02}{ident['code']}{ident['date']}"
    require(race['id']==expected and race['number']==ident['race'] and race['scheduleId']==schedule['id']
            and schedule['cupId']==ident['start']+ident['code'] and schedule['date']==ident['date'], 'Wrong result-card identity')
    players={p['id']:p for p in data['players']}
    entries={e['playerId']:e for e in data['entries']}
    results=data['results']
    require(isinstance(results,list), 'Missing official result list')
    require(not results or len(results)==len(entries), 'Incomplete official result table')
    rows=[];seen=set()
    for result in results:
        pid=result['playerId']
        require(result['raceId']==expected and pid in entries and pid not in seen, 'Wrong or duplicate result rider')
        seen.add(pid)
        require(type(result['order']) is int and 0<=result['order']<=9, 'Invalid result order')
        require(type(result['back']) is bool and type(result['standing']) is bool, 'Invalid result flags')
        require(type(result['hasAccident']) is bool, 'Invalid result accident flag')
        rows.append({'player_id':pid,'number':entries[pid]['number'],'name':players[pid]['name'],
                     'order':result['order'],'has_accident':result['hasAccident'],'accident':result['accident'],
                     'accident_name':result['accidentName'],'back':result['back'],'standing':result['standing'],
                     'final_half_record':result['finalHalfRecord'],'margin':result['margin'],'factor':result['factor']})
    return {'source_url':card_url.replace('/racecard/','/raceresult/'),'observed_at':observed_at,
            'venue':VENUES[ident['code']][0],'venue_code':ident['code'],'venue_slug':VENUES[ident['code']][1],
            'meeting_start':ident['start'],'meeting_day':schedule['index'],'race':ident['race'],
            'race_id':expected,'date':ident['date'],'race_type':race['class']+race['raceType3'],
            'rows':sorted(rows,key=lambda r:(r['order'] if r['order'] else 99,r['number']))}
