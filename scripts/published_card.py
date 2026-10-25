"""Read validated display-only cards from the shared feed branch."""
from datetime import date
import hashlib
import json
import re
import subprocess


def git_read(ref, path, *, optional=False):
    result=subprocess.run(['git','show',ref+':'+path],capture_output=True)
    if optional and result.returncode:
        return None
    if result.returncode:
        raise ValueError('Saved display card is unavailable: '+path)
    return result.stdout


def parse_page(page):
    match=re.search(r'const races=(.*);\nconst body=',page)
    if not match:
        raise ValueError('Published card missing')
    races=json.loads(match[1])
    if not isinstance(races,list) or not races:
        raise ValueError('Empty published card')
    return races


def read_published(ref):
    raw=git_read(ref,'fallback/cards/current.json',optional=True)
    if raw is None:
        return None
    pointer=json.loads(raw)
    target=date.fromisoformat(pointer['target_date'])
    expected='fallback/cards/'+target.strftime('%Y%m%d')+'/runs/'+pointer['revision']+'.json'
    if (pointer.get('schema_version')!=1 or pointer.get('provider')!='winticket'
            or not re.fullmatch(r'run-\d+-\d+',pointer['revision']) or pointer['path']!=expected):
        raise ValueError('Invalid saved card pointer')
    payload=git_read(ref,expected)
    if hashlib.sha256(payload).hexdigest()!=pointer['sha256']:
        raise ValueError('Saved card checksum differs')
    card=json.loads(payload)
    if card.get('schema_version')!=1 or card.get('provider')!='winticket' or card.get('target_date')!=target.isoformat():
        raise ValueError('Saved card date/provider differs')
    races=parse_page(card['html'])
    from venues import identity
    if any(identity(r['source'])['date']!=target.strftime('%Y%m%d') for r in races):
        raise ValueError('Saved card has another race date')
    return card,races,target.isoformat()
