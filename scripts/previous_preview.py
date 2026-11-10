"""Create the isolated, fixed-date index2 preview from checked display fields."""
import hashlib
import json
from pathlib import Path
import re

from published_card import parse_page
from previous_meetings import collect
from previous_flags import enrich

PREFIX='previous-preview'
FEATURES=('previous-meetings.js','previous-meetings.css')


def encode(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'


def validate(data,page):
    from export_pages import page_date
    day=page_date(page)
    if data.get('schema_version')!=1 or data.get('provider')!='kdreams' or data.get('target_date','').replace('-','')!=day:
        raise ValueError('Previous preview date/provider differs')
    races=parse_page(page);rows={r['source_url']:r for r in data['races']}
    if set(rows)!={r['source'] for r in races}:raise ValueError('Previous preview races differ')
    for race in races:
        players={p['no']:p for p in rows[race['source']]['players']}
        if set(players)!={p['no'] for p in race['players']}:raise ValueError('Previous preview cars differ')
        for player in race['players']:
            p=players[player['no']]
            if (p['name']!=player['name'] or str(p['period'])!=str(player['period'])
                    or p['player_id']!=player['playerId']):raise ValueError('Previous preview rider identity differs')
    return data


def prepare(card,races,target,run_key,site):
    from export_pages import public_html,BASE
    if not re.fullmatch(r'run-\d+-\d+',run_key):raise ValueError('Invalid preview run key')
    site=Path(site);data=enrich(collect(races,target),site)
    data['summary']={'races':len(data['races']),
                     'riders':sum(len(r['players']) for r in data['races']),
                     'results':sum(len(m['days']) for r in data['races'] for p in r['players'] for m in p['meetings']),
                     'recorded_results':sum(not d.get('unavailable',False)
                                            for r in data['races'] for p in r['players'] for m in p['meetings'] for d in m['days']),
                     'flag_results':sum(any(d.get(f) is True for f in ('home','back','start'))
                                        for r in data['races'] for p in r['players'] for m in p['meetings'] for d in m['days'])}
    if not data['summary']['recorded_results']:
        raise ValueError('No verified previous results were found; preserve the previous preview')
    day=target.replace('-','')
    page=public_html(card['html'],day,json.loads(card['assets']['rakuten-marks.json']),
                     json.loads(card['assets']['rider-identities.json']),json.loads(card['assets']['rider-details.json']))
    page=re.sub(r'<body\b','<body data-previous-meetings="true"',page,count=1)
    page=page.replace('</head>',f'<link rel="stylesheet" href="{BASE}previous-meetings.css?v=20261110"></head>',1)
    page=page.replace('</body>',f'<script src="{BASE}previous-meetings.js?v=20261110"></script></body>',1)
    validate(data,page)
    relative=PREFIX+'/'+day+'/runs/'+run_key+'.json';path=site/relative
    path.parent.mkdir(parents=True,exist_ok=True)
    payload=encode(data).encode()
    with path.open('xb') as handle:handle.write(payload)
    pointer={'schema_version':1,'target_date':target,'path':relative,
             'sha256':hashlib.sha256(payload).hexdigest(),'page_sha256':hashlib.sha256(page.encode()).hexdigest()}
    (site/'index2.html').write_text(page)
    (site/PREFIX/'current.json').write_text(encode(pointer))
    print('PREVIOUS MEETINGS PREVIEW READY',target,json.dumps(data['summary']),flush=True)
    return pointer


def export_preview(site,output):
    site,output=Path(site),Path(output);pointer=site/PREFIX/'current.json'
    if not pointer.exists():return None
    meta=json.loads(pointer.read_text());day=meta['target_date'].replace('-','')
    if not re.fullmatch(r'\d{8}',day) or not re.fullmatch(PREFIX+'/'+day+r'/runs/run-\d+-\d+\.json',meta['path']):
        raise ValueError('Invalid checked previous preview pointer')
    payload=(site/meta['path']).read_bytes();page=(site/'index2.html').read_bytes()
    if hashlib.sha256(payload).hexdigest()!=meta['sha256'] or hashlib.sha256(page).hexdigest()!=meta['page_sha256']:
        raise ValueError('Previous preview checksum differs')
    data=validate(json.loads(payload),page.decode())
    from previous_presentation import enrich as presentation
    data=presentation(data,site,parse_page(page.decode()))
    rendered=page.decode()
    for name in FEATURES:
        content=(site/name).read_bytes();version=hashlib.sha256(content).hexdigest()[:12]
        rendered,count=re.subn(r'(/'+re.escape(name)+r')(?:\?[^"\s]*)?',
                               lambda match:match[1]+'?v='+version,rendered,count=1)
        if count!=1:raise ValueError('Previous preview asset link is missing')
        (output/name).write_bytes(content)
    (output/'index2.html').write_text(rendered)
    destination=output/'data'/day/'previous-meetings.json';destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(encode(data))
    return {'target_date':meta['target_date'],'data_path':'data/'+day+'/previous-meetings.json',**data['summary']}
