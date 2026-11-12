"""Checked previous-two-meeting display history for current and future cards.

Each collection is an immutable site record.  A small checksummed pointer binds
it to the complete current race/rider identity, so ordinary odds and unchanged
hourly card checks reuse it without another history collection.
"""
from datetime import date
import hashlib
import json
from pathlib import Path
import re

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


def ensure_daily(card, races, run_key, site, *, collector=None):
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
    if checked is not None and checked[0]['identity_sha256'] == expected:
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
            data = enrich((collector or collect)(races, target), site)
        from recent_flags import enrich as enrich_recent_flags
        data = enrich_recent_flags(data, site)
    validate_data(data, page)
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
