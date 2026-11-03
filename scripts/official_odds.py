"""K Dreams exacta snapshots, isolated from retained legacy-provider feeds."""
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from venues import identity

PROVIDER = 'kdreams'
ODDS_PREFIX = 'fallback/kdreams/exacta'
ODDS_SCHEDULES = ('*/15 23,0-10 * * *', '0,15,30 11 * * *')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def should_collect(target, now, schedule=''):
    local = now.astimezone(ZoneInfo('Asia/Tokyo'))
    if target != local.date().isoformat():
        return False
    minute = local.hour * 60 + local.minute
    if not schedule:
        return 8 * 60 <= minute <= 20 * 60 + 30
    require(schedule in ODDS_SCHEDULES, 'Unknown odds schedule')
    slots = (range(8 * 60, 20 * 60, 15) if schedule == ODDS_SCHEDULES[0]
             else (20 * 60, 20 * 60 + 15, 20 * 60 + 30))
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    due = [midnight + timedelta(minutes=slot) for slot in slots if slot <= minute]
    return bool(due) and local - due[-1] <= timedelta(hours=1)


def quote_url(race):
    require(identity(race['source'])['provider'] == PROVIDER, 'Official odds require a K Dreams card')
    return 'https://keirin.kdreams.jp' + urlsplit(race['source']).path + '?pageType=odds'


def _time(value):
    observed = datetime.fromisoformat(value)
    require(observed.tzinfo is not None and observed <= datetime.now(timezone.utc), 'Invalid quote observation time')
    return observed


def validate_quote(snapshot, race):
    """Validate identity and direction without transposing or rounding version 2."""
    numbers = sorted(p['no'] for p in race['players'])
    require(snapshot['provider'] == PROVIDER and snapshot['bet_type'] == 'exacta'
            and snapshot['parser_version'] == 2, 'Wrong exacta provider/version')
    require(snapshot['source_url'] == quote_url(race)
            and snapshot['race_key'] == urlsplit(race['source']).path
            and snapshot['rider_numbers'] == numbers, 'Wrong exacta race identity')
    require(snapshot['status'] in ('snapshot', 'unavailable', 'closed'), 'Invalid quote status')
    if 'observed_at' in snapshot:
        _time(snapshot['observed_at'])
    if snapshot['status'] == 'snapshot':
        _time(snapshot['observed_at'])
    if snapshot['status'] == 'snapshot' or 'odds' in snapshot:
        pairs = set()
        for item in snapshot['odds']:
            a, b, value = item['first'], item['second'], item['value']
            require(type(a) is int and type(b) is int, 'Invalid quote car number')
            require((a, b) not in pairs, 'Duplicate exacta pair')
            pairs.add((a, b))
            require(value is None or type(value) in (int, float) and math.isfinite(value) and value > 0,
                    'Invalid exacta price')
        require(pairs == {(a, b) for a in numbers for b in numbers if a != b}, 'Incomplete exacta matrix')
        if snapshot['status'] == 'snapshot':
            require(any(item['value'] is not None for item in snapshot['odds']), 'Empty snapshot is unavailable')
    return snapshot


def valid_saved(snapshot, race):
    try:
        require(snapshot['status'] == 'snapshot', 'No successful saved quote')
        return validate_quote(snapshot, race)
    except (ValueError, KeyError, TypeError):
        return None


def blank_feed(races, target, checked_at):
    """A new card has no odds until its own first successful race-day read."""
    _time(checked_at)
    results = []
    for race in races:
        require(identity(race['source'])['date'] == target.replace('-', ''), 'Blank feed race date differs')
        results.append({'ok': True, 'snapshot': {
            'provider': PROVIDER, 'parser_version': 2, 'bet_type': 'exacta',
            'source_url': quote_url(race), 'race_key': urlsplit(race['source']).path,
            'rider_numbers': sorted(p['no'] for p in race['players']),
            'status': 'unavailable', 'unavailable_reason': 'not_collected',
            'fetched_at': checked_at}})
    return {'schema_version': 1, 'provider': PROVIDER, 'target_date': target,
            'checked_at': checked_at, 'results': results}


def refresh(races, previous=None, *, collector=None, pause=1):
    if collector is None:
        from kdreams_provider import collect_quote
        collector = collect_quote
    previous = previous or {}
    require(not previous or previous.get('provider') == PROVIDER, 'Never reuse another provider feed')
    old = {row['snapshot']['race_key']: row['snapshot'] for row in previous.get('results', [])
           if row.get('ok') and isinstance(row.get('snapshot'), dict)}
    results = []
    stats = {'observations': 0, 'fresh_snapshots': 0, 'unavailable': 0, 'retained': 0, 'failed': 0}
    for race in races:
        key = urlsplit(race['source']).path
        prior = valid_saved(old.get(key), race)
        if pause:
            time.sleep(pause)
        try:
            snapshot = validate_quote(collector(race), race)
            stats['observations'] += 1
            if snapshot['status'] == 'snapshot':
                stats['fresh_snapshots'] += 1
                if prior and _time(snapshot['observed_at']) < _time(prior['observed_at']):
                    results.append({'ok': True, 'snapshot': prior, 'last_check_status': 'source_older'})
                    stats['retained'] += 1
                else:
                    results.append({'ok': True, 'snapshot': snapshot})
            else:
                stats['unavailable'] += 1
                if prior:
                    results.append({'ok': True, 'snapshot': prior, 'last_check_status': snapshot['status']})
                    stats['retained'] += 1
                else:
                    results.append({'ok': True, 'snapshot': snapshot})
        except Exception as error:
            stats['failed'] += 1
            message = type(error).__name__ + ': ' + str(error)[:180]
            if prior:
                results.append({'ok': True, 'snapshot': prior, 'last_check_error': message})
                stats['retained'] += 1
            else:
                results.append({'ok': False, 'race_key': key, 'source_url': quote_url(race), 'error': message})
        print('K Dreams exacta', race['venue'], race['race'], 'R',
              results[-1].get('snapshot', {}).get('status', 'failed'), flush=True)
    return {'schema_version': 1, 'provider': PROVIDER,
            'checked_at': datetime.now(timezone.utc).isoformat(), 'results': results}, stats


def stage_feed(feed, target, run_key, output):
    require(re.fullmatch(r'run-\d+-\d+', run_key), 'Invalid immutable run key')
    require(feed.get('provider') == PROVIDER, 'Wrong staged feed provider')
    require(feed.get('target_date', target) == target, 'Wrong staged feed date')
    feed = {**feed, 'target_date': target}
    prefix = Path(output) / ODDS_PREFIX / target.replace('-', '')
    (prefix / 'runs').mkdir(parents=True, exist_ok=True)
    payload = json.dumps(feed, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
    with (prefix / 'runs' / (run_key + '.json')).open('x') as handle:
        handle.write(payload)
    path = prefix / 'latest.json'
    path.write_text(payload)
    return path
