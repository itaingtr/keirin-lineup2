"""Refresh only verified K Dreams line units, preserving all saved race values."""
from copy import deepcopy
from datetime import datetime, timezone
import re
import time

from kdreams_provider import _doc_read, _title, compact, fetch, parse_lineup, parse_players, require
from published_card import parse_page
from render_races import parse_lineup as normalize_lineup, script_json
from venues import identity


def refresh_lineups(card, reader=fetch, pause=.5):
    require(card.get('provider')=='kdreams','Lineup refresh requires official source cards')
    result=deepcopy(card);races=parse_page(result['html']);receipts=[];changed=[]
    for race in races:
        ident=identity(race['source'])
        require(ident['provider']=='kdreams' and ident['date']==card['target_date'].replace('-',''),
                'Lineup source date/provider differs')
        if pause:time.sleep(pause)
        doc,observed=_doc_read(race['source'],reader);_title(doc,race['source'])
        actual={p['no']:p for p in parse_players(doc)}
        expected={p['no']:p for p in race['players']}
        require(set(actual)==set(expected),'Lineup source cars differ')
        for number,player in expected.items():
            source=actual[number]
            require(compact(source['name'])==compact(player['name']) and str(source['period'])==str(player['period']),
                    'Lineup source car/name/period differs')
            identifier=player.get('playerId')
            require(not identifier or not source.get('player_id') or identifier==source['player_id'],
                    'Lineup source registration differs')
        lineup=parse_lineup(doc,list(expected))
        groups=normalize_lineup(lineup,list(expected))
        if groups!=race['groups']:changed.append(race['source'])
        race['groups']=groups
        receipts.append({'provider':'kdreams','source_url':race['source'],'observed_at':observed,
                         'lineup':lineup,'parser_version':2})
        print('LINEUP VERIFIED',race['venue'],race['race'],'R',lineup,flush=True)
    page=result['html']
    require(len(re.findall(r'<body\b[^>]*>',page))==1,'Unexpected lineup page wrapper')
    page,count=re.subn(r'const races=(.*);\nconst body=',lambda _: 'const races='+script_json(races)+';\nconst body=',page,count=1)
    require(count==1,'Lineup page dataset is missing')
    if 'data-contest-odds="true"' not in page:
        page=re.sub(r'<body\b','<body data-contest-odds="true"',page,count=1)
    result['html']=page
    result['checked_at']=datetime.now(timezone.utc).isoformat()
    result['lineup_sources']=receipts
    result.setdefault('summary',{})['lineup_parser_version']=2
    result['summary']['lineup_changes']=len(changed)
    return result,races
