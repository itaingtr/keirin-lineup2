"""Isolated, checksummed index2 experiment for ten previous meetings.

The normal card and both older source previews remain untouched. The two-
meeting data is frozen alongside the new history so a later same-day roster
change cannot silently rebind the experiment to another set of riders.
"""
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import parse_qsl,urlsplit

from previous_daily import _identities,load_daily,validate_data as validate_previous
from published_card import parse_page
from venues import VENUES,identity

PREFIX='ten-preview'
FEATURES=('previous-meetings.css','previous-meetings.js','ten-meetings.css','ten-meetings.js')


def encode(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'


def require(value,message):
    if not value:raise ValueError(message)


def checked_date(value):
    require(isinstance(value,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',value),'Invalid ten-meeting date')
    return date.fromisoformat(value)


def validate(data,page):
    """Reject date/roster mismatches and invented video identities before export."""
    from export_pages import page_date
    races=parse_page(page);target=checked_date(data.get('target_date'))
    require(data.get('schema_version')==1 and data.get('provider')=='keirin.jp'
            and target.strftime('%Y%m%d')==page_date(page),'Ten-meeting date/provider differs')
    require(_identities(data['races'],history=True)==_identities(races),'Ten-meeting rider identity differs')
    current={race['source']:race for race in races}
    for race in data['races']:
        ident=identity(current[race['source_url']]['source'])
        start=date.fromisoformat(ident['start'][:4]+'-'+ident['start'][4:6]+'-'+ident['start'][6:])
        for player in race['players']:
            meetings=player.get('meetings')
            require(isinstance(meetings,list) and len(meetings)<=10,'Invalid ten-meeting count')
            previous_end=None
            for meeting in meetings:
                code=meeting.get('venue_code');grade=meeting.get('grade_code')
                require(code in VENUES and isinstance(meeting.get('venue'),str) and 0<len(meeting['venue'])<=24,
                        'Invalid ten-meeting venue')
                require(grade is None or type(grade) is int and 1<=grade<=6,'Invalid ten-meeting grade')
                first=checked_date(meeting.get('start_date'))
                require(first<start and (previous_end is None or previous_end<first),'Ten meetings are not chronological')
                days=meeting.get('days');require(isinstance(days,list) and 1<=len(days)<=8,'Invalid ten-meeting starts')
                last=None;seen=set()
                for result in days:
                    actual=checked_date(result.get('race_date'))
                    require(first<=actual<start and (last is None or last<=actual),'Ten-meeting result date differs')
                    last=actual
                    require(result.get('player_id',player['player_id'])==player['player_id'],'Ten-meeting result rider differs')
                    order=result.get('order');accident=result.get('accident','')
                    require(order is None or type(order) is int and 0<=order<=9,'Invalid ten-meeting rank')
                    require(isinstance(accident,str) and len(accident)<=8,'Invalid ten-meeting accident')
                    require(isinstance(result.get('race_type',''),str) and len(result.get('race_type',''))<=80,
                            'Invalid ten-meeting race type')
                    number=result.get('race_number');race_id=result.get('race_id');video=result.get('video_url')
                    if number is None:
                        require(race_id is None and not video,'Unknown ten-meeting race has a link')
                    else:
                        require(type(number) is int and 1<=number<=12,'Invalid ten-meeting race number')
                        expected=f'{number:02}{code}{actual.strftime("%Y%m%d")}'
                        require(race_id is None and not video or race_id==expected,'Ten-meeting race ID differs')
                    key=(actual,number)
                    require(key not in seen,'Duplicate ten-meeting start');seen.add(key)
                    if video:
                        parsed=urlsplit(video);pairs=parse_qsl(parsed.query);query=dict(pairs)
                        require(parsed.scheme=='https' and parsed.hostname in ('keirin.kdreams.jp','my.keirin.kdreams.jp')
                                and parsed.path=='/stadium/digest/' and not(parsed.username or parsed.password or parsed.port or parsed.fragment)
                                and len(query)==len(pairs) and set(query)<= {'kyogijoCd','kaisaiDate','gradeCd','raceNo','l-id'}
                                and grade is not None and query.get('kyogijoCd')==code
                                and query.get('kaisaiDate')==actual.strftime('%Y%m%d')
                                and query.get('raceNo')==str(number) and query.get('gradeCd')==str(grade),
                                'Ten-meeting video identity differs')
                previous_end=last
    return data


def summary(data):
    players=[p for r in data['races'] for p in r['players']]
    meetings=[m for p in players for m in p['meetings']]
    days=[d for m in meetings for d in m['days']]
    return {'races':len(data['races']),'riders':len(players),'meetings':len(meetings),
            'results':len(days),'linked_results':sum(bool(d.get('video_url')) for d in days),
            'riders_with_ten':sum(len(p['meetings'])==10 for p in players)}


def _asset_link(page,name,version):
    """Keep one scoped asset link, refreshed without rewriting frozen source."""
    from export_pages import BASE
    expression=r'(/'+re.escape(name)+r')(?:\?[^"\s]*)?'
    if re.search(expression,page):
        page,count=re.subn(expression,lambda m:m[1]+'?v='+version,page)
        require(count==1,'Duplicate ten-preview feature asset')
        return page
    tag=(f'<link rel="stylesheet" href="{BASE}{name}?v={version}">' if name.endswith('.css')
         else f'<script src="{BASE}{name}?v={version}"></script>')
    closing='</head>' if name.endswith('.css') else '</body>'
    require(page.count(closing)==1,'Ten-preview document structure differs')
    return page.replace(closing,tag+closing,1)


def prepare(card,races,target,run_key,site,*,collector=None):
    """Collect one explicit trial, then atomically advance its display pointer."""
    from export_pages import public_html
    site=Path(site);checked_date(target)
    require(re.fullmatch(r'run-\d+-\d+',run_key),'Invalid immutable ten-preview run key')
    require(card['target_date']==target and _identities(parse_page(card['html']))==_identities(races),
            'Ten-preview card differs')
    previous=load_daily(site,target,card['html'])
    require(previous is not None,'Checked two-meeting history is required before the ten-meeting preview')
    if collector is None:
        from ten_meetings import collect
        collector=collect
    collected=collector(races,target)
    if os.environ.get('TEN_CHECKPOINT_DIR'):
        checkpoint=Path(os.environ['TEN_CHECKPOINT_DIR'])
        checkpoint.mkdir(parents=True,exist_ok=True)
        with (checkpoint/('collected-'+run_key+'.json')).open('x') as handle:
            handle.write(encode(collected))
    data=validate(collected,card['html'])
    data=dict(data);data['summary']=summary(data)
    require(data['summary']['results']>0,'No verified ten-meeting results; preserve the previous experiment')
    day=target.replace('-','')
    page=public_html(card['html'],day,json.loads(card['assets']['rakuten-marks.json']),
                     json.loads(card['assets']['rider-identities.json']),json.loads(card['assets']['rider-details.json']))
    page,count=re.subn(r'<body\b','<body data-ten-meetings="true" data-previous-meetings="true"',page,count=1)
    require(count==1,'Ten-preview body is missing')
    for name in FEATURES:
        version=hashlib.sha256((site/name).read_bytes()).hexdigest()[:12]
        page=_asset_link(page,name,version)
    validate(data,page);validate_previous(previous,page)
    relative=PREFIX+'/'+day+'/runs/'+run_key+'.json'
    previous_path=PREFIX+'/'+day+'/runs/'+run_key+'-previous.json'
    destination=site/relative;prior_destination=site/previous_path
    require(not destination.exists() and not prior_destination.exists(),'Immutable ten-preview run already exists')
    payload=encode(data).encode();prior_payload=encode(previous).encode()
    pointer={'schema_version':1,'target_date':target,'path':relative,'sha256':hashlib.sha256(payload).hexdigest(),
             'previous_path':previous_path,'previous_sha256':hashlib.sha256(prior_payload).hexdigest(),
             'page_sha256':hashlib.sha256(page.encode()).hexdigest()}
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('xb') as handle:handle.write(payload)
    with prior_destination.open('xb') as handle:handle.write(prior_payload)
    (site/PREFIX/'index2.html').write_text(page)
    (site/PREFIX/'current.json').write_text(encode(pointer))
    print('TEN MEETING PREVIEW READY',target,encode(data['summary']).strip(),flush=True)
    return pointer


def export_ten_preview(site,output):
    """Export the checked trial without changing normal/date artifacts."""
    site,output=Path(site),Path(output);pointer_path=site/PREFIX/'current.json'
    if not pointer_path.exists():return None
    pointer=json.loads(pointer_path.read_text());target=pointer.get('target_date');day=checked_date(target).strftime('%Y%m%d')
    expression=PREFIX+'/'+day+r'/runs/(run-\d+-\d+)\.json'
    match=re.fullmatch(expression,str(pointer.get('path')))
    require(pointer.get('schema_version')==1 and match is not None,'Invalid checked ten-preview pointer')
    expected_previous=PREFIX+'/'+day+'/runs/'+match[1]+'-previous.json'
    require(pointer.get('previous_path')==expected_previous,'Invalid checked ten-preview two-meeting pointer')
    payload=(site/pointer['path']).read_bytes();prior_payload=(site/expected_previous).read_bytes()
    page=(site/PREFIX/'index2.html').read_bytes()
    require(hashlib.sha256(payload).hexdigest()==pointer.get('sha256')
            and hashlib.sha256(prior_payload).hexdigest()==pointer.get('previous_sha256')
            and hashlib.sha256(page).hexdigest()==pointer.get('page_sha256'),'Ten-preview checksum differs')
    data=validate(json.loads(payload),page.decode());previous=validate_previous(json.loads(prior_payload),page.decode())
    from previous_presentation import enrich
    previous=enrich(previous,site,parse_page(page.decode()))
    rendered=page.decode();output.mkdir(parents=True,exist_ok=True)
    for name in FEATURES:
        content=(site/name).read_bytes();rendered=_asset_link(rendered,name,hashlib.sha256(content).hexdigest()[:12])
        (output/name).write_bytes(content)
    (output/'index2.html').write_text(rendered)
    data_path='data/'+day+'/previous-meetings.json';ten_data_path='data/'+day+'/ten-meetings.json'
    for relative,value in ((data_path,previous),(ten_data_path,data)):
        path=output/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(encode(value))
    return {'target_date':target,'data_path':data_path,'ten_data_path':ten_data_path,
            **data.get('summary',summary(data))}
