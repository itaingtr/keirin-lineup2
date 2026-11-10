"""Verified K Dreams previous-two-meeting display fields for index2 only."""
from datetime import date, datetime, timedelta, timezone
import re
import time
from urllib.parse import parse_qsl, urlsplit

from kdreams_provider import (HOSTS, RIDER, _doc_read, _title, classes, compact,
                             fetch, parse_players, race_identity, require)
from source_http import Document, Node, cells
from venues import VENUES

PROVIDER = 'kdreams'
HEADERS = ['枠番', '車番', '選手名府県/年齢/期別', '競走得点',
           '今場所成績', '前場所成績', '前々場所成績']
ACCIDENTS = {'欠': '欠', '欠場': '欠', '欠車': '欠', '落': '落', '落車': '落',
             '落棄': '落', '落再': '落', '失': '失', '失格': '失',
             '故': '故', '故棄': '故', '故再': '故', '棄': '棄', '棄権': '棄',
             '除': '除', '除外': '除', '中止': '棄'}


def _profile(value):
    text = re.sub(r'\((?:欠車|欠場|出走取消|取消)\)$', '', compact(value))
    match = RIDER.fullmatch(text)
    require(match is not None, 'Previous-meeting rider profile is invalid')
    return match[1], int(match[2])


def _video(item):
    """Read a literal public video URL; never execute source JavaScript."""
    urls = set()
    for anchor in item.find_all('a'):
        href = anchor.attrs.get('href', '')
        if href.startswith('https://'):
            urls.add(href)
        call = re.search(r'''windowOpen\(\s*(['"])(https://[^'"]+)\1''',
                         anchor.attrs.get('onclick', ''))
        if call:
            urls.add(call[2])
    require(len(urls) <= 1, 'Ambiguous historical race video')
    if not urls:
        return None
    url = urls.pop(); parsed = urlsplit(url)
    pairs = parse_qsl(parsed.query, keep_blank_values=True); query = dict(pairs)
    require(parsed.scheme == 'https' and parsed.hostname in HOSTS
            and parsed.path == '/stadium/digest/'
            and not (parsed.username or parsed.password or parsed.port or parsed.fragment)
            and len(pairs) == len(query)
            and {'kyogijoCd', 'gradeCd', 'kaisaiDate', 'raceNo'} <= set(query)
            and set(query) <= {'kyogijoCd', 'gradeCd', 'kaisaiDate', 'raceNo', 'l-id'},
            'Unexpected previous-meeting video URL')
    code = query['kyogijoCd']
    require(code in VENUES and re.fullmatch(r'[1-6]', query['gradeCd'])
            and re.fullmatch(r'\d{8}', query['kaisaiDate'])
            and re.fullmatch(r'\d{1,4}', query['raceNo'])
            and 1 <= int(query['raceNo']) <= 12, 'Invalid historical video identity')
    actual = datetime.strptime(query['kaisaiDate'], '%Y%m%d').date()
    return {'url': url, 'date': actual, 'code': code,
            'grade': int(query['gradeCd']), 'race': int(query['raceNo'])}


def _past_date(label, before):
    match = re.fullmatch(r'(\d{1,2})/(\d{1,2})', compact(label))
    require(match is not None, 'Previous-meeting date label is invalid')
    for year in (before.year, before.year - 1):
        try:
            value = date(year, int(match[1]), int(match[2]))
        except ValueError:
            continue
        if value < before:
            return value
    raise ValueError('Previous-meeting date cannot precede the current meeting')


def _meeting(cell, before, player_id, source, observed):
    items = list(cell.find_all('li'))
    if not items:
        # Empty history is legitimate for a new or long-absent rider.
        return None
    records = []; videos = []
    for item in items:
        spans = [n for n in item.children if isinstance(n, Node) and n.tag == 'span']
        require(len(spans) >= 4, 'Incomplete previous-meeting placing/time fields')
        label, kind, rank, agari = [compact(n.text()) for n in spans[:4]]
        require(bool(kind), 'Previous-meeting race type is missing')
        blank = ('', '-', '—', '―', '−')
        unavailable = rank in blank and agari in blank
        placing = re.fullmatch(r'([1-9])着', rank)
        accident = '' if placing or unavailable else ACCIDENTS.get(rank.removesuffix('着'))
        require(unavailable or placing is not None or accident is not None,
                'Unknown previous-meeting placing/accident: '+repr([label,kind,rank,agari]))
        if agari in blank:
            agari = None
        else:
            require(re.fullmatch(r'\d{1,2}\.\d', agari), 'Invalid previous-meeting individual time')
        video = _video(item)
        inferred = _past_date(label, before)
        actual = video['date'] if video else inferred
        require(actual < before and (actual.month, actual.day) == (inferred.month, inferred.day),
                'Historical video date differs from its visible result')
        require(compact(label) == f'{actual.month}/{actual.day}'
                or tuple(map(int, compact(label).split('/'))) == (actual.month, actual.day),
                'Historical date label differs')
        if video:
            videos.append(video)
        # A schedule/video placeholder does not establish that this rider
        # participated. Keep the date/slot, but provide no result identity that
        # could attach another rider's flags, video or shared condition note.
        own_result = video if not unavailable else None
        records.append({'race_date': actual.isoformat(), 'race_date_inferred': video is None,
                        'race_number': own_result['race'] if own_result else None,
                        'race_id': f'{own_result["race"]:02}{own_result["code"]}{actual:%Y%m%d}' if own_result else None,
                        'order': int(placing[1]) if placing else None, 'accident': accident,
                        'final_half_record': agari, 'race_type': kind, 'unavailable': unavailable,
                        # K's recent-results column has no verified H/B field.
                        'home': None, 'back': None, 'start': None,
                        'video_url': own_result['url'] if own_result else None,
                        'result_url': own_result['url'] if own_result else None,
                        'player_id': player_id, 'provider': PROVIDER,
                        'source_url': source, 'observed_at': observed})
    require(len({r['race_date'] for r in records}) == len(records),
            'Ambiguous multiple historical rides on one date')
    records.sort(key=lambda row: row['race_date'])
    first = date.fromisoformat(records[0]['race_date'])
    require((date.fromisoformat(records[-1]['race_date']) - first).days < 6,
            'Mixed previous meetings in one history column')
    codes = {v['code'] for v in videos}; grades = {v['grade'] for v in videos}
    require(len(codes) <= 1 and len(grades) <= 1, 'Historical meeting venue/grade differs')
    code = next(iter(codes), None)
    if code:
        prefix = compact(cell.text()).split(compact(items[0].text()), 1)[0]
        require(VENUES[code][0] in prefix, 'Historical meeting heading/video venue differs')
    for slot, row in enumerate(records, 1):
        row['slot'] = slot
        row['meeting_day'] = (date.fromisoformat(row['race_date']) - first).days + 1
    return {'start_date': first.isoformat(), 'start_date_inferred': True,
            'venue': VENUES[code][0] if code else None, 'venue_code': code,
            'grade_code': next(iter(grades), None), 'days': records}


def parse_previous(doc, source, expected, observed):
    if isinstance(doc, str):
        doc = Document(doc).root
    ident = race_identity(source); _title(doc, source)
    before = datetime.strptime(ident['start'], '%Y%m%d').date()
    known = {p['no']: p for p in expected}
    require(len(known) == len(expected), 'Duplicate expected current car')
    current = {p['no']: p for p in parse_players(doc)}
    require(set(current) == set(known), 'Previous-meeting current cars differ')
    for number, player in known.items():
        require(compact(current[number]['name']) == compact(player['name'])
                and current[number]['period'] == int(player['period']),
                'Previous-meeting current rider identity differs')
        identifier = player.get('playerId') or player.get('player_id')
        require(isinstance(identifier, str) and re.fullmatch(r'\d{6}', identifier),
                'Previous-meeting rider lacks a verified registration ID')
        require(not current[number].get('player_id') or current[number]['player_id'] == identifier,
                'Previous-meeting public registration ID differs')
    tables = [t for t in doc.find_all('table') if 'past_racecard_table' in classes(t)]
    require(len(tables) <= 1, 'Ambiguous K Dreams previous-meeting table')
    output = {no: {'no': no, 'name': p['name'], 'period': int(p['period']),
                   'player_id': p.get('playerId') or p.get('player_id'), 'meetings': []}
              for no, p in known.items()}
    if not tables:
        return [output[no] for no in sorted(output)]
    table = tables[0]
    require(any([compact(c.text()) for c in cells(row)] == HEADERS for row in table.find_all('tr')),
            'K Dreams previous-meeting column meanings differ')
    seen = set()
    for row in table.find_all('tr'):
        values = cells(row)
        numbers = [compact(c.text()) for c in values if 'num' in classes(c)]
        if not numbers:
            continue
        require(len(numbers) == 1 and re.fullmatch(r'[1-9]', numbers[0]), 'Invalid previous-meeting car')
        number = int(numbers[0])
        require(number in known and number not in seen, 'Previous-meeting rider set differs')
        seen.add(number)
        indexes = [i for i, cell in enumerate(values) if 'rider' in classes(cell)]
        require(len(indexes) == 1 and len(values) >= indexes[0] + 5,
                'Incomplete previous-meeting rider/history cells')
        index = indexes[0]; name, period = _profile(values[index].text())
        require(name == compact(known[number]['name']) and period == int(known[number]['period']),
                'Previous-meeting table car/name/period differs')
        meetings = []
        # The source is [current, previous, previous-previous]. Show older first.
        for position, cell in (('previous_previous', values[index + 4]), ('previous', values[index + 3])):
            meeting = _meeting(cell, before, output[number]['player_id'], source, observed)
            if meeting:
                meeting['position'] = position
                meetings.append(meeting)
        require(all(max(d['race_date'] for d in a['days']) < min(d['race_date'] for d in b['days'])
                    for a, b in zip(meetings, meetings[1:])), 'Historical meetings overlap or are reversed')
        output[number]['meetings'] = meetings
    require(seen == set(known), 'K Dreams previous-meeting riders are incomplete')
    return [output[no] for no in sorted(output)]


def collect(races, target, read=fetch):
    target_day = date.fromisoformat(target)
    output = []; sources = []; cache = {}
    for race in races:
        source = race['source']; ident = race_identity(source)
        require(ident['date'] == target_day.strftime('%Y%m%d'), 'Previous-meeting target date differs')
        if source not in cache:
            if read is fetch and cache:
                time.sleep(1)
            cache[source] = _doc_read(source, read)
        doc, observed = cache[source]
        players = parse_previous(doc, source, race['players'], observed)
        output.append({'source_url': source, 'players': players})
        sources.append({'provider': PROVIDER, 'url': source, 'observed_at': observed,
                        'kind': 'previous_meetings'})
    require(bool(output), 'No current races for previous-meeting collection')
    return {'schema_version': 1, 'provider': PROVIDER, 'target_date': target,
            'checked_at': datetime.now(timezone.utc).isoformat(), 'sources': sources, 'races': output}
