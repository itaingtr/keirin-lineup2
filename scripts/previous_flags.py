"""Join saved official H/B/S evidence to the index2 previous-meeting rows.

Only display evidence already present in checked public archives is reused.
The original source rows, timestamps and archive files are never modified.
"""
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlsplit

from keirin_jp_provider import RESULT_PATH, check_url as check_official_url
from kdreams_provider import check_url as check_kdreams_url, compact
from published_card import parse_page
from venues import VENUES, identity


def _person(player, identifier_key):
    if not isinstance(player, dict):
        return None
    identifier = player.get(identifier_key)
    name, period = player.get('name'), player.get('period')
    if (not isinstance(identifier, str) or not re.fullmatch(r'\d{6}', identifier)
            or not isinstance(name, str) or not compact(name)
            or type(period) not in (str, int) or not re.fullmatch(r'\d{1,3}', str(period))
            or not 1 <= int(period) <= 999):
        return None
    return identifier, compact(name), int(period)


def _race(row):
    if not isinstance(row, dict):
        return None
    identifier = row.get('race_id')
    if not isinstance(identifier, str):
        return None
    match = re.fullmatch(r'(\d{2})(\d{2})(\d{8})', identifier)
    if match is None:
        return None
    number, code, raw = int(match[1]), match[2], match[3]
    try:
        actual = date.fromisoformat(row['race_date'])
    except (KeyError, TypeError, ValueError):
        return None
    if (not 1 <= number <= 12 or code not in VENUES
            or type(row.get('race_number')) is not int or row['race_number'] != number
            or actual.strftime('%Y%m%d') != raw):
        return None
    return code, raw, number


def _stamp(value):
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        return None
    return stamp


def _time(value):
    if value is None or value in ('', '-', '—', '―'):
        return None
    return value if isinstance(value, str) and re.fullmatch(r'\d{1,2}\.\d{1,3}', value) else False


def _accident(value):
    if value in ('', None):
        return ''
    if not isinstance(value, str):
        return None
    return {'欠': '欠', '欠場': '欠', '欠車': '欠', '取消': '欠',
            '落': '落', '落車': '落', '落棄': '落', '落再': '落',
            '落車棄権': '落', '落車再入': '落',
            '故': '故', '故棄': '故', '故再': '故', '故障棄権': '故', '故障再入': '故',
            '失': '失', '失格': '失', '棄': '棄', '棄権': '棄',
            '除': '除', '除外': '除'}.get(compact(value))


def _placing(row):
    order = row.get('order')
    accident = _accident(row.get('accident', ''))
    if accident is None:
        return None
    if type(order) is int and 1 <= order <= 9 and not accident:
        return order, ''
    if (order is None or type(order) is int and order == 0) and accident:
        return 0, accident
    return None


def _official(history, person):
    """Validate a saved result without accepting legacy-provider observations."""
    if not isinstance(history, dict) or history.get('provider') != 'keirin.jp':
        return None
    if history.get('player_id') != person[0]:
        return None
    race = _race(history)
    observed = _stamp(history.get('observed_at'))
    placing, timing = _placing(history), _time(history.get('final_half_record'))
    if race is None or observed is None or placing is None or timing is False:
        return None
    if (type(history.get('back')) is not bool
            or history.get('home') is not None and type(history['home']) is not bool
            or history.get('start') is not None and type(history['start']) is not bool):
        return None
    url = history.get('result_url')
    if not isinstance(url, str):
        return None
    try:
        check_official_url(url)
        parsed = urlsplit(url)
        query = dict(parse_qsl(parsed.query))
    except (TypeError, ValueError):
        return None
    code, raw, number = race
    if parsed.path != RESULT_PATH or query != {'KCD': code, 'KBI': raw, 'RNO': str(number)}:
        return None
    result = {'race': race, 'placing': placing, 'timing': timing,
              'stamp': observed, 'observed_at': history['observed_at'],
              'url': url, 'home': history.get('home'), 'back': history['back']}
    if type(history.get('start')) is bool:
        start_url = history.get('start_source_url')
        start_stamp = _stamp(history.get('start_observed_at'))
        try:
            check_kdreams_url(start_url)
            parsed_start = urlsplit(start_url)
            start_ident = identity(parsed_start._replace(query='').geturl())
            verified = (dict(parse_qsl(parsed_start.query)) == {'pageType': 'showResult'}
                        and start_ident['provider'] == 'kdreams'
                        and (start_ident['code'], start_ident['date'], start_ident['race']) == race)
        except (AttributeError, TypeError, ValueError):
            verified = False
        if verified and start_stamp is not None:
            result.update(start=history['start'], start_stamp=start_stamp,
                          start_observed_at=history['start_observed_at'], start_url=start_url)
    return result


def _latest(rows, field):
    stamp_key, url_key = ('start_stamp', 'start_url') if field == 'start' else ('stamp', 'url')
    rows = [row for row in rows if type(row.get(field)) is bool and stamp_key in row]
    if not rows:
        return None
    newest = max(row[stamp_key] for row in rows)
    rows = [row for row in rows if row[stamp_key] == newest]
    if len({row[field] for row in rows}) != 1:
        return None
    row = sorted(rows, key=lambda r: r[url_key])[0]
    observed_key = 'start_observed_at' if field == 'start' else 'observed_at'
    return row[field], {'provider': 'kdreams' if field == 'start' else 'keirin.jp',
                        'url': row[url_key], 'observed_at': row[observed_key]}


def enrich(dataset, site):
    """Return a deep copy with independently verified optional flags filled in."""
    result = deepcopy(dataset)
    wanted = {_person(player, 'player_id') for race in result.get('races', [])
              for player in race.get('players', [])}
    wanted.discard(None)
    evidence = {}
    for path in sorted(Path(site).glob('line*.html/index.html')):
        if not re.fullmatch(r'line\d{8}\.html', path.parent.name):
            continue
        try:
            archives = parse_page(path.read_text())
        except (OSError, UnicodeError, TypeError, ValueError):
            continue
        for race in archives:
            if not isinstance(race, dict) or not isinstance(race.get('players'), list):
                continue
            for player in race['players']:
                person = _person(player, 'playerId')
                if person not in wanted or not isinstance(player.get('meetingResults'), list):
                    continue
                for history in player['meetingResults']:
                    row = _official(history, person)
                    if row is not None:
                        evidence.setdefault((person, row['race']), []).append(row)
    attached = 0
    for race in result.get('races', []):
        for player in race.get('players', []):
            person = _person(player, 'player_id')
            if person is None:
                continue
            for meeting in player.get('meetings', []):
                for day in meeting.get('days', []):
                    key = _race(day)
                    if key is None or day.get('player_id') != person[0] or day.get('race_date_inferred') is True:
                        continue
                    placing, timing = _placing(day), _time(day.get('final_half_record'))
                    if placing is None or timing is False:
                        continue
                    matches = [row for row in evidence.get((person, key), [])
                               if row['placing'] == placing and row['timing'] == timing]
                    for flag in ('home', 'back', 'start'):
                        if day.get(flag) is not None:
                            continue
                        chosen = _latest(matches, flag)
                        if chosen is None:
                            continue
                        value, source = chosen
                        day[flag] = value
                        day.setdefault('flag_sources', {})[flag] = source
                        if flag == 'start':
                            day['start_source_url'] = source['url']
                            day['start_observed_at'] = source['observed_at']
                        else:
                            day.update(flags_provider='keirin.jp', flags_source_url=source['url'],
                                       flags_observed_at=source['observed_at'])
                        attached += 1
    print('PREVIOUS MEETING VERIFIED FLAGS', attached, 'individual flags attached', flush=True)
    return result
