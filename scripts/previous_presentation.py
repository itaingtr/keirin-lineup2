"""Read-only, verified race-type metadata for opted-in card presentation."""
from copy import deepcopy
from datetime import date
from pathlib import Path
import re
import unicodedata

from published_card import parse_page
from venues import identity, VENUES


def compact(value):
    if not isinstance(value,str):return ''
    return re.sub(r'\s+','',unicodedata.normalize('NFKC',value))


def highlight(race_type,meeting_day):
    kind=compact(race_type)
    if any(value in kind for value in ('初日特選','初特選','初特')):return True
    if kind.endswith(('決勝','決勝戦')) and '準' not in kind:return True
    return meeting_day==1 and kind.endswith('特選')


def semifinal(race_type):
    return bool(re.search(r'準決勝(?:戦)?$',compact(race_type)))


def _archive_types(site):
    found={};conflicts=set()
    for path in sorted(Path(site).glob('line*.html/index.html')):
        match=re.fullmatch(r'line(\d{8})\.html',path.parent.name)
        if not match:continue
        try:races=parse_page(path.read_text())
        except (ValueError,OSError,UnicodeError):continue
        for race in races:
            try:
                ident=identity(race['source'])
                if ident['provider']!='kdreams' or ident['date']!=match[1]:continue
                if 'race' in race and race['race']!=ident['race']:continue
                if 'venueCode' in race and race['venueCode']!=ident['code']:continue
                kind=compact(race.get('raceType'))
                if not kind or len(kind)>64:continue
                actual=date.fromisoformat(ident['date'][:4]+'-'+ident['date'][4:6]+'-'+ident['date'][6:])
                start=date.fromisoformat(ident['start'][:4]+'-'+ident['start'][4:6]+'-'+ident['start'][6:])
                day=(actual-start).days+1
                key=f"{ident['race']:02}{ident['code']}{ident['date']}"
                value={'race_type':kind,'meeting_day':day,'source_url':race['source']}
                if key in found and (found[key]['race_type'],found[key]['meeting_day'])!=(kind,day):conflicts.add(key)
                else:found[key]=value
            except (ValueError,KeyError,TypeError,AttributeError):continue
    return {key:value for key,value in found.items() if key not in conflicts}


def _result_key(result,player_id):
    if result.get('unavailable') or result.get('race_date_inferred') is True:return None
    key=result.get('race_id');day=result.get('race_date');number=result.get('race_number')
    if (not isinstance(key,str) or not re.fullmatch(r'\d{12}',key)
            or not isinstance(day,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day)
            or type(number) is not int or not 1<=number<=12
            or key[:2]!=f'{number:02}' or key[2:4] not in VENUES
            or key[4:]!=day.replace('-','') or result.get('player_id')!=player_id):return None
    try:date.fromisoformat(day)
    except ValueError:return None
    return key


def enrich(data,site,current_races=None):
    """Add derived presentation fields without changing any saved observations."""
    result=deepcopy(data);types=_archive_types(site);current={}
    for race in current_races or []:
        for player in race.get('players',[]):
            player_id=player.get('playerId')
            if not isinstance(player_id,str) or not re.fullmatch(r'\d{6}',player_id):continue
            for record in player.get('meetingResults',[]):
                key=_result_key(record,player_id)
                if key in types:current[key]=types[key]['race_type']
    result['current_result_types']=current
    for race in result.get('races',[]):
        for player in race.get('players',[]):
            player_id=player.get('player_id')
            for meeting in player.get('meetings',[]):
                for record in meeting.get('days',[]):
                    key=_result_key(record,player_id)
                    if key in types:
                        metadata=types[key]
                        record['highlight_rank']=highlight(metadata['race_type'],metadata['meeting_day'])
                        record['semifinal_rank']=semifinal(metadata['race_type'])
                        record['race_type_source_url']=metadata['source_url']
    return result
