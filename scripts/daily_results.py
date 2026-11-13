"""Read-only all-entry indexes; reuse date-pinned, checksummed histories.

Never call a collector or advance a source pointer here. One optional rider's
failure must not remove any entry or another feature's checked results.
"""
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

from published_card import parse_page
from previous_daily import load_daily, _read_checked
from previous_presentation import _archive_types
from rider_history import load_snapshot, read_player
from ten_preview import validate as validate_ten
from venues import identity

BASE = '/keirin-lineup2/'
CUTOVER = '20261114'


def require(value, message):
    if not value:
        raise ValueError(message)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n'


def iso_day(day):
    require(isinstance(day, str) and re.fullmatch(r'\d{8}', day), 'Invalid result index day')
    return date(int(day[:4]), int(day[4:6]), int(day[6:])).isoformat()


def checked_ten(site, day, page):
    try:
        return load_snapshot(site, day, page)
    except (ValueError, OSError, KeyError, TypeError):
        # load_snapshot hydrates all players. Independently verify its immutable
        # manifest so a damaged player file/roster row only affects that player.
        meta = json.loads((site/'ten-daily'/day/'latest.json').read_text())
        path = meta.get('path', '')
        require(meta.get('schema_version') == 1 and meta.get('target_date') == iso_day(day)
                and re.fullmatch('ten-daily/'+day+r'/runs/run-\d+-\d+\.json', path), 'Invalid ten manifest')
        payload = (site/path).read_bytes()
        require(hashlib.sha256(payload).hexdigest() == meta.get('sha256'), 'Ten manifest checksum differs')
        data = json.loads(payload)
        require(data.get('schema_version') == 1 and data.get('target_date') == iso_day(day)
                and data.get('history_storage') == 'rider-master', 'Ten manifest date/storage differs')
        return data


def checked_previous(site, day, page):
    try:
        return load_daily(site, day, page)
    except (ValueError, KeyError, TypeError):
        # The source run checksum and stored roster digest must still pass.
        # Individual rows are then matched to the current card below.
        checked = _read_checked(site, day)
        return checked[1] if checked else None


def optional(reader):
    try:
        data = reader()
        return data, 'ready' if data is not None else 'missing'
    except (ValueError, OSError, KeyError, TypeError):
        return None, 'error'


def matching_player(data, race, player):
    if not data:
        return None
    rows = [r for r in data.get('races', []) if r.get('source_url') == race['source']]
    if len(rows) != 1:
        return None
    members = [p for p in rows[0].get('players', []) if p.get('no') == player['no']]
    if len(members) != 1:
        return None
    saved = members[0]
    if (saved.get('name') != player['name'] or str(saved.get('period')) != str(player['period'])
            or saved.get('player_id') != player.get('playerId')):
        return None
    return saved


def validate_meetings(meetings, race, player, target, limit):
    # Reuse the strict historical race/date/link validator, scoped to one rider.
    require(isinstance(meetings, list) and len(meetings) <= limit, 'Invalid meeting count')
    if not meetings:
        return
    single = {**race, 'players': [player]}
    page = 'const races='+encode([single]).strip()+';\nconst body=null;'
    data = {'schema_version': 1, 'provider': 'mixed', 'target_date': target,
            'races': [{'source_url': race['source'], 'players': [{
                'no': player['no'], 'name': player['name'], 'period': player['period'],
                'player_id': player['playerId'], 'meetings': meetings}]}]}
    validate_ten(data, page)
    for meeting in meetings:
        for record in meeting['days']:
            for flag in ('start', 'home', 'back'):
                require(record.get(flag) is None or type(record[flag]) is bool, 'Invalid individual flag')
            time = record.get('final_half_record')
            require(time is None or time == '' or isinstance(time, str)
                    and re.fullmatch(r'\d{1,2}\.\d{1,3}', time), 'Invalid individual time')


def current_results(player, race, target, grades, types):
    results = deepcopy(player.get('meetingResults', []))
    require(isinstance(results, list), 'Invalid current results')
    ident = identity(race['source'])
    for record in results:
        actual = date.fromisoformat(record['race_date'])
        number = record.get('race_number')
        require(record.get('player_id') == player.get('playerId') and type(number) is int and 1 <= number <= 12
                and record.get('race_id') == f'{number:02}'+ident['code']+actual.strftime('%Y%m%d')
                and iso_day(ident['start']) <= actual.isoformat() < target, 'Current result identity differs')
        if record['race_id'] in types:
            record.setdefault('race_type', types[record['race_id']]['race_type'])
        # Only a checked exact K result URL and the saved meeting grade permit
        # conversion; no guessed race numbers, dates or meeting starts.
        grade = grades.get(ident['code']+ident['start'])
        source = record.get('start_source_url')
        if source and grade is not None:
            parsed = urlsplit(source)
            source_ident = identity(parsed._replace(query='').geturl())
            if source_ident == {**ident, 'date': actual.strftime('%Y%m%d'), 'race': number}:
                record['video_url'] = ('https://keirin.kdreams.jp/stadium/digest/?kyogijoCd='+ident['code']
                    +'&kaisaiDate='+actual.strftime('%Y%m%d')+'&gradeCd='+str(grade)+'&raceNo='+str(number))
    return results


def build_index(site, output, day, *, source_commit=None, types=None):
    site, output = Path(site), Path(output)
    target = iso_day(day)
    page = (output/('line'+day+'.html')).read_text()
    races = parse_page(page)
    previous, previous_state = optional(lambda: checked_previous(site, day, page))
    ten, ten_state = optional(lambda: checked_ten(site, day, page))
    assets = {}
    for key, name in (('rider_identities', 'rider-identities.json'), ('rider_details', 'rider-details.json')):
        relative = 'data/'+day+'/'+name
        if (output/relative).is_file():
            assets[key] = relative
    if previous is not None:
        relative = 'data/'+day+'/previous-daily.json'
        if not (output/relative).exists():
            # A malformed optional roster can disable its normal page reader;
            # expose the original checked run once, without rewriting it.
            meta = json.loads((site/'previous-daily'/day/'latest.json').read_text())
            relative = meta['path']
            destination = output/relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes((site/relative).read_bytes())
        assets['previous'] = {'path': relative, 'sha256': hashlib.sha256((output/relative).read_bytes()).hexdigest()}
    if ten is not None:
        assets['ten'] = 'data/'+day+'/ten-meetings.json' if (output/'data'/day/'ten-meetings.json').exists() else None
    grades_match = re.search(r'const videoGrades=([^;]+);', page)
    grades = json.loads(grades_match[1]) if grades_match else {}
    types = _archive_types(site) if types is None else types
    output_races, seen_races, seen_entries = [], set(), set()
    for race in races:
        ident = identity(race['source'])
        require(ident['date'] == day and race['venueCode'] == ident['code'] and race['race'] == ident['race'],
                'Entry race date/identity differs')
        race_id = f"{ident['race']:02}"+ident['code']+day
        require(race_id not in seen_races, 'Duplicate entry race')
        seen_races.add(race_id)
        row = {'race_id': race_id, 'venue_code': ident['code'], 'venue': race['venue'],
               'meeting_start': iso_day(ident['start']), 'meeting_day': race.get('meetingDay'),
               'race_number': ident['race'], 'race_type': race.get('raceType'),
               'grade_code': int(grades[ident['code']+ident['start']]) if ident['code']+ident['start'] in grades else None,
               'start_time': race.get('startTime'), 'source_url': race['source'],
               'groups': deepcopy(race.get('groups', [])), 'players': []}
        cars = set()
        for player in race['players']:
            number = player['no']
            require(number not in cars, 'Duplicate entry car')
            cars.add(number)
            identifier = player.get('playerId')
            identified = isinstance(identifier, str) and re.fullmatch(r'\d{6}', identifier) is not None
            # Legacy IDs remain legacy; never label them as JKA registrations.
            identifier = identifier if identified else None
            entry = target+':'+race_id+':'+(identifier or 'unidentified-car-'+str(number))
            require(entry not in seen_entries, 'Duplicate entry')
            seen_entries.add(entry)
            current, current_state = optional(lambda: current_results(player, race, target, grades, types))
            state = {'identity': 'ready' if identified else 'missing', 'current': current_state,
                     'previous': previous_state, 'ten': ten_state}
            member = {'entry_id': entry, 'player_id': identifier, 'car_number': number,
                      'name': player['name'], 'period': player['period'],
                      'prefecture': player.get('prefecture'), 'age': player.get('age'),
                      'score_raw': player.get('rawScore'), 'mark': player.get('mark'),
                      'absent': player.get('absent', False),
                      'stats': dict(zip(('s', 'b', 'nige', 'makuri', 'sashi', 'mark'), player.get('stats', []))),
                      'identity_source': player.get('identitySource'),
                      'current_meeting_prior_results': current or [], 'data_status': state}
            prev = matching_player(previous, race, player) if identified else None
            if prev is not None:
                _, status = optional(lambda: validate_meetings(prev.get('meetings'), race, player, target, 2))
                state['previous'] = ('ready' if prev['meetings'] else 'pending') if status != 'error' else 'error'
            elif previous is not None:
                state['previous'] = 'mismatch'
            prior = matching_player(ten, race, player) if identified else None
            if prior is not None:
                try:
                    ref = prior['history_ref']
                    record = read_player(site, {**prior, **ref})
                    validate_meetings(record['meetings'], race, player, target, 10)
                    destination = output/ref['path']
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    payload = (site/ref['path']).read_bytes()
                    if destination.exists():
                        require(destination.read_bytes() == payload, 'Immutable output differs')
                    else:
                        destination.write_bytes(payload)
                    member['history_ref'] = ref
                    state['ten'] = 'pending' if prior.get('pending') or not record['meetings'] else 'ready'
                    member['ten_meeting_count'] = len(record['meetings'])
                except (ValueError, OSError, KeyError, TypeError):
                    state['ten'] = 'error'
            elif ten is not None:
                state['ten'] = 'mismatch'
            row['players'].append(member)
        output_races.append(row)
    players = [p for r in output_races for p in r['players']]
    summary = {'races': len(races), 'entries': len(players),
               'absent': sum(p['absent'] is True for p in players),
               'identified': sum(p['player_id'] is not None for p in players),
               'previous_ready': sum(p['data_status']['previous'] == 'ready' for p in players),
               'ten_ready': sum(p['data_status']['ten'] == 'ready' for p in players)}
    return {'schema_version': 1, 'kind': 'all_rider_results', 'target_date': target,
            'timezone': 'Asia/Tokyo', 'generated_at': datetime.now(timezone.utc).isoformat(),
            'source_commit': source_commit, 'card_href': BASE+'line'+day+'.html',
            'assets': assets, 'summary': summary, 'races': output_races}


def export_results(site, output, dates):
    site, output = Path(site), Path(output)
    if not (site/'daily-results/index.html').is_file():
        return None
    destination = output/'daily-results'
    destination.mkdir(parents=True, exist_ok=True)
    for file in sorted((site/'daily-results').iterdir()):
        require(not file.is_symlink() and file.is_file(), 'Unexpected daily results asset')
        (destination/file.name).write_bytes(file.read_bytes())
    # Reuse only the public board client initialization, without loading the
    # comment forms, copying auth identities, or modifying archived clients.
    script = (site/'comments-passphrase.js').read_text()
    prefix = script.split('const BOARD_EMAIL =', 1)[0]
    require(prefix.startswith('(async () => {\n') and 'const supabase = createClient(' in prefix
            and prefix != script, 'Board client initialization differs')
    (destination/'board-client.js').write_text(prefix+"\nwindow.keirinResultsBoard = {client:supabase};\n"
        +"window.dispatchEvent(new Event('keirin-results-board-ready'));\n})().catch(() => {});\n")
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=site.parent, capture_output=True, text=True)
    source_commit = revision.stdout.strip() if revision.returncode == 0 else None
    types = _archive_types(site)
    reports = {}
    for day in dates:
        data = build_index(site, output, day, source_commit=source_commit, types=types)
        relative = 'data/'+day+'/all-rider-results.json'
        (output/relative).write_text(encode(data))
        reports[day] = data['summary']
    return {'href': BASE+'daily-results/index.html', 'days': reports}
