"""Validated public K Dreams cards and exacta matrices, without legacy feeds."""
from datetime import date, datetime, timedelta, timezone
import math
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from source_http import Document, Node, cells
from venues import VENUES

PROVIDER = 'kdreams'
HOSTS = {'keirin.kdreams.jp', 'my.keirin.kdreams.jp'}
RACE_PATH = re.compile(r'/([a-z]+)/racedetail/(\d{2})(\d{8})(\d{2})(\d{4})/')
PREFECTURES = '北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄 外国'.split()
RIDER = re.compile(r'(.+?)(?:'+'|'.join(PREFECTURES)+r')/\d+/(\d+)')
RIDER_PROFILE = re.compile(r'(.+?)('+'|'.join(PREFECTURES)+r')/(\d{1,3})/(\d{1,3})')
MARKS = ('', '◎', '○', '◯', '▲', '△', '×', '注', '☆', '★', '穴')
KDREAMS_SLUGS = {code: ('iwakitaira' if code == '13' else item[1]) for code, item in VENUES.items()}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def classes(node):
    return node.attrs.get('class', '').split()


def check_url(url):
    p = urlsplit(url)
    require(p.scheme == 'https' and p.hostname in HOSTS and not (p.username or p.password or p.port or p.fragment), 'Unexpected K Dreams source host')
    require(RACE_PATH.fullmatch(p.path) is not None or re.fullmatch(r'/racecard/\d{4}/\d{2}/\d{2}/', p.path), 'Unexpected K Dreams source path')
    require(not p.query or parse_qs(p.query) in ({'pageType': ['odds']},{'pageType': ['showResult']}), 'Unexpected K Dreams source query')
    return url


class SourceRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        check_url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def fetch(url):
    """read(url) returns (Document.root, actual UTC observation time)."""
    check_url(url)
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'KeirinLineup2/1.0', 'Accept': 'text/html'})
            with build_opener(SourceRedirect()).open(request, timeout=30) as response:
                check_url(response.url)
                raw = response.read(6_000_001)
                require(len(raw) <= 6_000_000, 'K Dreams response exceeds size limit')
                text = raw.decode(response.headers.get_content_charset() or 'utf-8')
            return Document(text).root, datetime.now(timezone.utc).isoformat()
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == 2 or isinstance(error, HTTPError) and error.code not in (404, 408, 500, 502, 503, 504):
                raise
            time.sleep((2, 5)[attempt])


def race_identity(url):
    check_url(url)
    match = RACE_PATH.fullmatch(urlsplit(url).path)
    require(match is not None, 'Expected a K Dreams race URL')
    slug, code, start, day, number = match.groups()
    require(code in VENUES and KDREAMS_SLUGS[code] == slug and 1 <= int(day) <= 6 and 1 <= int(number) <= 12, 'K Dreams race identity differs')
    actual = datetime.strptime(start, '%Y%m%d').date() + timedelta(days=int(day)-1)
    return {'provider': PROVIDER, 'code': code, 'start': start, 'date': actual.strftime('%Y%m%d'), 'race': int(number), 'day': int(day), 'slug': slug}


def canonical_source(url):
    parsed=urlsplit(url)
    require(parsed.scheme=='https' and parsed.hostname in HOSTS and not (parsed.username or parsed.password or parsed.port or parsed.fragment), 'Unexpected K Dreams card URL')
    clean=urlunsplit((parsed.scheme,parsed.netloc,parsed.path,'',''))
    race_identity(clean)
    return 'https://keirin.kdreams.jp' + parsed.path


def _doc_read(url, read):
    doc, observed = read(url)
    if isinstance(doc, str):
        doc = Document(doc).root
    stamp = datetime.fromisoformat(observed)
    require(stamp.tzinfo is not None and stamp <= datetime.now(timezone.utc), 'Invalid source observation time')
    return doc, observed


def _canonical(doc, url):
    for link in doc.find_all('link'):
        if link.attrs.get('rel') == 'canonical':
            require(urlsplit(link.attrs.get('href', '')).path == urlsplit(url).path, 'K Dreams canonical race differs')


def _title(doc, url):
    _canonical(doc, url)
    title = next((n.text().strip() for n in doc.find_all('title')), '')
    ident = race_identity(url)
    number = re.search(r'\b(\d+)R\b', title)
    calendar = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', title)
    actual = ident['date']
    require(number is not None and int(number[1]) == ident['race'] and calendar is not None
            and tuple(map(int, calendar.groups())) == (int(actual[:4]), int(actual[4:6]), int(actual[6:])), 'K Dreams title race/date differs')
    return title


class MissingLineup(ValueError):
    pass


class MissingCardTable(ValueError):
    pass


def parse_schedule(doc, base, target):
    target = date.fromisoformat(target) if isinstance(target, str) else target
    containers = [n for n in doc.find_all('div') if 'raceinfo_table' in classes(n)]
    require(len(containers) == 1, 'Expected one requested-day K Dreams calendar')
    meetings = []
    for row in containers[0].find_all('tr'):
        links = []
        for anchor in row.find_all('a'):
            candidate = urljoin(base, anchor.attrs.get('href', ''))
            if urlsplit(candidate).hostname not in HOSTS or RACE_PATH.fullmatch(urlsplit(candidate).path) is None:
                continue
            source = canonical_source(candidate)
            require(race_identity(source)['date'] == target.strftime('%Y%m%d'), 'Calendar race date differs')
            links.append(source)
        if not links:
            continue
        codes = {race_identity(url)['code'] for url in links}
        require(len(codes) == 1, 'Mixed venues in calendar row')
        grades = {int(token[2:]) for node in row.find_all() for token in classes(node) if re.fullmatch(r'gr[1-6]', token)}
        require(len(grades) == 1, 'Missing or ambiguous calendar grade')
        code = codes.pop()
        values = cells(row)
        require(bool(values) and compact(values[0].text()).removesuffix('競輪') == VENUES[code][0], 'Calendar venue name differs')
        meetings.append({'venue': VENUES[code][0], 'grade_code': grades.pop(),
                         'night': any('s2' in classes(n) or 's3' in classes(n) for n in row.find_all()),
                         'urls': list(dict.fromkeys(links))})
    require(bool(meetings), 'No published K Dreams meetings')
    return meetings


def parse_lineup(doc, numbers):
    positions = [n for n in doc.find_all('div') if 'line_position' in classes(n)]
    if len(positions) != 1:
        raise MissingLineup('K Dreams lineup not published')
    groups, units, competing = [], [], None
    for node in positions[0].children:
        if not isinstance(node, Node):
            continue
        tokens = set(classes(node))
        riders = [int(token[1:]) for child in node.find_all() for token in classes(child) if re.fullmatch(r'p00[1-9]', token)]
        opening, closing = 'bracket_open' in tokens, 'bracket_close' in tokens
        if opening or closing:
            require('icon_p' in tokens and 'space' not in tokens and not riders and not (opening and closing),
                    'Invalid K Dreams competing-position marker')
            if opening:
                require(competing is None, 'Nested K Dreams competing positions are invalid')
                competing = []
            else:
                require(competing is not None, 'K Dreams competing position closes without opening')
                require(len(competing) >= 2, 'K Dreams competing position needs at least two riders')
                units.append('(' + ''.join(map(str, competing)) + ')')
                competing = None
            continue
        if 'space' in tokens:
            require(competing is None, 'K Dreams line break inside a competing position')
            if units:
                groups.append(''.join(units)); units = []
            continue
        if riders:
            require('icon_p' in tokens, 'Unexpected K Dreams lineup structure')
            require(not any(set(classes(c)) & {'bracket_open', 'bracket_close'} for c in node.find_all()),
                    'Nested K Dreams competing-position markers are invalid')
            if competing is not None:
                require(len(riders) == 1, 'Nested K Dreams competing rider groups are invalid')
                competing.extend(riders)
            else:
                # Older cards can put both riders in one icon. Current cards
                # use separate icons between bracket_open/bracket_close. An
                # isolated p113 (競り) icon must never be flattened silently.
                require(len(riders) > 1 or not any('p113' in classes(c) for c in node.find_all()),
                        'K Dreams competing rider lacks position brackets')
                units.append('(' + ''.join(map(str, riders)) + ')' if len(riders) > 1 else str(riders[0]))
        elif competing is not None:
            raise ValueError('Unexpected K Dreams node inside a competing position')
    require(competing is None, 'K Dreams competing position is not closed')
    if units:
        groups.append(''.join(units))
    if not groups:
        raise MissingLineup('K Dreams lineup not published')
    lineup = '/'.join(groups)
    from render_races import parse_lineup as validate_lineup
    validate_lineup(lineup, numbers)
    return lineup


def _player_id(cell):
    found = set()
    links=[]
    for node in [cell,*cell.find_all()]:
        for key in ('data-player-id','data-player-cd','data-racer-no','data-racer-cd'):
            value=node.attrs.get(key,'')
            if re.fullmatch(r'\d{6}',value):found.add(value)
        href=node.attrs.get('href','')
        if href:links.append(href)
        links.extend(re.findall(r'''["']((?:https://(?:my\.)?keirin\.kdreams\.jp)?/athlete/[^"']+)["']''',node.attrs.get('onclick','')))
    for link in links:
        url = urljoin('https://keirin.kdreams.jp/', link)
        parsed = urlsplit(url)
        if parsed.hostname not in HOSTS or 'athlete' not in parsed.path:
            continue
        for key in ('id', 'aid', 'playerId', 'playerCd', 'racerNo', 'racerCd'):
            for value in parse_qs(parsed.query).get(key, []):
                if re.fullmatch(r'\d{6}', value):
                    found.add(value)
        match = re.search(r'/(\d{6})/?$', parsed.path)
        if match:
            found.add(match[1])
    require(len(found) <= 1, 'Ambiguous public rider identity')
    return next(iter(found), None)


def parse_players(doc):
    tables = [t for t in doc.find_all('table') if 'racecard_table' in classes(t) and 'none' not in classes(t)
              and '直近4ヶ月の成績' in compact(t.text())]
    if not tables:
        raise MissingCardTable('K Dreams primary rider table missing')
    require(len(tables) == 1, 'Ambiguous K Dreams primary rider table')
    rows = list(tables[0].find_all('tr'))
    require(any([compact(c.text()) for c in cells(row)][:7] == ['競走得点', 'S', 'B', '逃', '捲', '差', 'マ'] for row in rows), 'K Dreams statistic column meanings differ')
    players, seen = [], set()
    for row in rows:
        values = cells(row)
        numbers = [compact(c.text()) for c in values if 'num' in classes(c)]
        if not numbers:
            continue
        require(len(numbers) == 1 and re.fullmatch(r'[1-9]', numbers[0]), 'Invalid K Dreams car number')
        number = int(numbers[0]);require(number not in seen, 'Duplicate K Dreams car');seen.add(number)
        indexes = [i for i,c in enumerate(values) if 'rider' in classes(c)]
        require(len(indexes) == 1, 'Missing K Dreams rider')
        index = indexes[0];rider = RIDER.fullmatch(compact(values[index].text()))
        require(rider is not None and len(values) >= index+11, 'Incomplete K Dreams rider/statistics')
        profile = RIDER_PROFILE.fullmatch(compact(values[index].text()))
        require(profile is not None and 18 <= int(profile[3]) <= 100, 'Missing/invalid K Dreams rider prefecture or age')
        score = compact(values[index+4].text())
        stats = [compact(c.text()) for c in values[index+5:index+11]]
        require(re.fullmatch(r'\d+(?:\.\d+)?', score) and all(re.fullmatch(r'\d+', v) for v in stats), 'Missing K Dreams numeric statistics')
        marks = [c.text().strip() for c in values if 'tip' in classes(c)]
        require(len(marks) == 1 and marks[0] in MARKS, 'Missing/invalid K Dreams prediction mark')
        explicit = [compact(c.text()) for c in values]
        absent = bool(set(classes(row)) & {'absent', 'withdrawal', 'cancel'}) or any(v in ('欠場','欠車','出走取消','取消','欠') for v in explicit)
        player = {'no': number, 'name': rider[1], 'score': float(score), 'period': int(rider[2]),
                  'mark': marks[0], 'stats': list(map(int, stats)), 'absent': absent, 'meeting_results': [],
                  'prefecture': profile[2], 'age': int(profile[3])}
        identifier = _player_id(values[index])
        if identifier:
            player['player_id'] = identifier
        players.append(player)
    require(bool(players), 'No published K Dreams riders')
    ids = [p['player_id'] for p in players if 'player_id' in p]
    require(len(ids) == len(set(ids)), 'Duplicate K Dreams rider ID')
    return sorted(players, key=lambda p:p['no'])


def parse_card(doc, url, meeting):
    title = _title(doc, url)
    kind = re.search(r'\b(\d+)R\s+([ＳS]級[^|]+?)\s*\|', title)
    if not kind:
        if re.search(r'\d+R\s+(?:[ＡAＬL]級|ガールズ|チャレンジ)', title):
            return None
        raise ValueError('Unrecognized K Dreams race class')
    players = parse_players(doc)
    lineup = parse_lineup(doc, [p['no'] for p in players])
    start = re.search(r'発走予定\s*(\d{1,2}:\d{2})', re.sub(r'\s+', ' ', doc.text()))
    require(start is not None and re.fullmatch(r'(?:[01]?\d|2[0-3]):[0-5]\d', start[1]), 'Missing K Dreams start time')
    return {'venue': meeting['venue'], 'race': int(kind[1]), 'source': canonical_source(url),
            'race_type': kind[2], 'grade_code': meeting['grade_code'], 'start_time': start[1].zfill(5),
            'lineup': lineup, 'players': players}


def collect_cards(target, read=fetch):
    day = date.fromisoformat(target)
    calendar = f'https://keirin.kdreams.jp/racecard/{day:%Y/%m/%d}/'
    doc, observed = _doc_read(calendar, read)
    meetings = parse_schedule(doc, calendar, day)
    races, sources, excluded = [], [{'url': calendar, 'observed_at': observed, 'provider': PROVIDER}], {}
    for meeting in meetings:
        if meeting['grade_code'] == 1:
            continue
        collected = []
        for url in meeting['urls']:
            if read is fetch:time.sleep(1)
            doc, observed = _doc_read(url, read)
            sources.append({'url': url, 'observed_at': observed, 'provider': PROVIDER})
            try:
                race = parse_card(doc, url, meeting)
            except MissingLineup as error:
                excluded[meeting['venue']] = str(error);collected = [];break
            if race is not None:
                collected.append(race)
        races.extend(collected)
    require(bool(races), 'No complete eligible K Dreams S-class meetings')
    require(len({r['source'] for r in races}) == len(races), 'Duplicate K Dreams race')
    return {'schema_version': 1, 'provider': PROVIDER, 'target_date': target, 'expected_races': len(races),
            'races': races, 'sources': sources, 'excluded_meetings': excluded}


def _number(node):
    number = next((int(c[1:]) for c in classes(node) if re.fullmatch(r'n[1-9]', c)), None)
    text = compact(node.text())
    return number if number is not None else int(text) if re.fullmatch(r'[1-9]', text) else None


def parse_exacta(doc, url, observed_at):
    if isinstance(doc, str):doc = Document(doc).root
    check_url(url);_canonical(doc, url)
    sections = [n for n in doc.find_all() if n.attrs.get('id') == 'JS_ODDSCONTENTS_2shatan']
    require(len(sections) == 1, 'K Dreams exacta section missing/ambiguous')
    tables = [n for n in sections[0].find_all('table') if 'odds_table' in classes(n)]
    require(len(tables) == 1, 'Expected one K Dreams exacta matrix')
    rows = list(tables[0].find_all('tr'));headers = []
    for row in rows:
        values = cells(row)
        found = [_number(c) for c in values if c.tag == 'th'];found = [n for n in found if n is not None]
        if len(found) >= 2 and not any(c.tag == 'td' for c in values):headers.append(found)
    require(bool(headers), 'K Dreams exacta column numbers missing')
    numbers = headers[0]
    require(2 <= len(numbers) <= 9 and len(set(numbers)) == len(numbers), 'Invalid/duplicate K Dreams exacta columns')
    pairs, seen = [], set()
    for row in rows:
        values = cells(row);head = [c for c in values if c.tag == 'th'];values = [c for c in values if c.tag == 'td']
        second = _number(head[0]) if head else None
        if second is None or not values:continue
        require(second in numbers and len(values) == len(numbers), 'K Dreams exacta dimensions differ')
        for first, cell in zip(numbers, values):
            if first == second:continue
            require((first,second) not in seen, 'Duplicate K Dreams exacta pair');seen.add((first,second))
            value = compact(cell.text()).replace(',', '')
            if re.fullmatch(r'\d+(?:\.\d+)?', value):
                value = float(value);require(math.isfinite(value) and value > 0, 'Invalid K Dreams price')
            elif value in ('-', '--', '―', '—', '欠場', '欠車', '発売なし', '未発売'):value = None
            else:raise ValueError('Unrecognized K Dreams quote; do not invent a price')
            pairs.append({'first': first, 'second': second, 'value': value})
    require(seen == {(a,b) for a in numbers for b in numbers if a != b}, 'Incomplete K Dreams exacta matrix')
    available = any(p['value'] is not None for p in pairs)
    result = {'provider': PROVIDER, 'race_key': urlsplit(url).path, 'bet_type': 'exacta',
              'status': 'snapshot' if available else 'unavailable', 'parser_version': 2,
              'observed_at': observed_at, 'source_url': url, 'rider_numbers': sorted(numbers), 'odds': pairs}
    if not available:result['unavailable_reason'] = 'no_published_prices'
    return result


def collect_quote(race, read=fetch):
    source = canonical_source(race['source'])
    odds_url = source + '?' + urlencode({'pageType': 'odds'})
    doc, observed = _doc_read(odds_url, read)
    _title(doc, odds_url)
    try:actual = parse_players(doc)
    except MissingCardTable:
        card, _ = _doc_read(source, read);_title(card, source);actual = parse_players(card)
    expected = {p['no']: p for p in race['players']}
    require(len(actual) == len(expected) and {p['no'] for p in actual} == set(expected), 'K Dreams quote cars differ from card')
    for p in actual:
        saved = expected[p['no']]
        require(p['name'] == saved['name'] and str(p['period']) == str(saved['period']), 'K Dreams quote rider differs from card')
        identifier = saved.get('player_id') or saved.get('playerId')
        require(not identifier or not p.get('player_id') or p['player_id'] == identifier, 'K Dreams quote rider ID differs from card')
    quote = parse_exacta(doc, odds_url, observed)
    require(quote['rider_numbers'] == sorted(expected), 'K Dreams quote matrix cars differ from card')
    return quote


def parse_result_flags(doc, url):
    """Read published S/B from the result table and verify its rider identities."""
    if isinstance(doc, str):
        doc = Document(doc).root
    _title(doc, url)
    players = {p['no']: p for p in parse_players(doc)}
    required = ('着順', '車番', '選手名', '上り', 'S/B')
    candidates = []
    for table in doc.find_all('table'):
        for row in table.find_all('tr'):
            values = cells(row)
            labels = [compact(c.text()) for c in values]
            if all(label in labels for label in required) and all(c.tag == 'th' for c in values):
                candidates.append((table, labels))
    require(len(candidates) == 1, 'Expected one published K Dreams result table')
    table, labels = candidates[0]
    indexes = {}
    for key in required:
        require(labels.count(key) == 1, 'Ambiguous K Dreams result column')
        indexes[key] = labels.index(key)
    results = []
    seen = set()
    for row in table.find_all('tr'):
        values = cells(row)
        if not any(c.tag == 'td' for c in values):
            continue
        require(len(values) == len(labels), 'Incomplete K Dreams result row')
        number = compact(values[indexes['車番']].text())
        require(re.fullmatch(r'[1-9]', number), 'Invalid K Dreams result car')
        number = int(number)
        require(number in players and number not in seen, 'K Dreams result car differs from card')
        seen.add(number)
        player = players[number]
        require(compact(values[indexes['選手名']].text()) == player['name'], 'K Dreams result rider differs from card')
        rank = compact(values[indexes['着順']].text())
        agari = compact(values[indexes['上り']].text())
        flags = compact(values[indexes['S/B']].text())
        require(re.fullmatch(r'[1-9]', rank) or rank in ('落','失','欠','棄','故','除','落再','落棄','故再','故棄'), 'Unknown K Dreams result placing')
        require(not agari or re.fullmatch(r'\d{1,2}\.\d', agari), 'Invalid K Dreams individual agari')
        require(flags in ('','S','B','SB','BS'), 'Unknown K Dreams S/B result flags')
        result = {'no': number, 'name': player['name'], 'period': player['period'],
                  'rank': int(rank) if rank.isdigit() else rank, 'agari': agari or None,
                  's': 'S' in flags, 'b': 'B' in flags}
        if player.get('player_id'):
            result['player_id'] = player['player_id']
        results.append(result)
    require(seen == set(players), 'K Dreams result riders are incomplete')
    return sorted(results, key=lambda item: item['no'])


def collect_result_flags(source, read=fetch):
    """Return source-timed public result evidence; no persistence or H inference."""
    source = canonical_source(source)
    url = source + '?' + urlencode({'pageType': 'showResult'})
    doc, observed = _doc_read(url, read)
    return {'provider': PROVIDER, 'source_url': url, 'observed_at': observed,
            'results': parse_result_flags(doc, url)}


def public_structure(url, read=fetch):
    """Small public structural evidence for Actions diagnostics; never raw HTML."""
    check_url(url)
    doc, observed = _doc_read(url, read)
    tables=[]
    all_tables=list(doc.find_all('table'))
    primary=[t for t in all_tables if any(part in t.attrs.get('class','') for part in ('racecard','odds','result'))]
    def result_table(table):
        headings={compact(n.text()) for n in table.find_all('th')}
        return '着順' in headings and '車番' in headings and 'racecard_table' not in classes(table)
    selected=sorted(primary+[t for t in all_tables if t not in primary],key=lambda t:not result_table(t))[:16]
    for table in selected:
        rows=list(table.find_all('tr'))
        headers=[];samples=[]
        for row in rows:
            values=cells(row)
            if any(c.tag=='th' for c in values):
                headers.append([compact(c.text())[:100] for c in values][:22])
            if any(c.tag=='td' for c in values) and len(samples)<(9 if result_table(table) else 3):
                samples.append([{'class':c.attrs.get('class',''),'text':compact(c.text())[:100],
                                 'links':[{'href':a.attrs.get('href',''),'onclick':a.attrs.get('onclick','')} for a in list(c.find_all('a'))[:2]],
                                 'items':[{'text':compact(item.text())[:100], 'attrs':dict(item.attrs),
                                           'children':[{'tag':n.tag,'text':compact(n.text())[:70],'attrs':dict(n.attrs)}
                                                       for n in list(item.find_all())[:12]]}
                                          for item in list(c.find_all('li'))[:4]]} for c in values[:22]])
        tables.append({'class':table.attrs.get('class',''),'id':table.attrs.get('id',''),
                       'row_count':len(rows),'headers':headers[:6],'samples':samples})
    athlete=[]
    for node in doc.find_all():
        value=node.attrs.get('href','')+' '+node.attrs.get('onclick','')
        if 'athlete' in value and len(athlete)<20:
            athlete.append({'tag':node.tag,'text':compact(node.text())[:80],'attrs':dict(node.attrs)})
    def lineup_node(node, depth=0):
        # Keep only public display structure, sufficient to distinguish a
        # vertical competing-position wrapper from consecutive normal riders.
        item={'tag':node.tag,'class':node.attrs.get('class',''),
              'text':compact(node.text())[:80],
              'attrs':{k:v[:180] for k,v in node.attrs.items()
                       if k in ('style','title','alt','aria-label') or k.startswith('data-position')}}
        if depth<5:
            item['children']=[lineup_node(c,depth+1) for c in node.children if isinstance(c,Node)][:30]
        return item
    lineup=[lineup_node(n) for n in doc.find_all('div') if 'line_position' in classes(n)]
    return {'provider':PROVIDER,'url':url,'observed_at':observed,
            'title':next((n.text().strip() for n in doc.find_all('title')),''),
            'canonicals':[n.attrs.get('href','') for n in doc.find_all('link') if n.attrs.get('rel')=='canonical'],
            'tables':tables,'athlete_links':athlete,'lineups':lineup}


if __name__=='__main__':
    import argparse,json
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe',action='append',default=[],help='Print bounded public structure, not source HTML')
    args=parser.parse_args()
    require(bool(args.probe),'Provide at least one --probe URL')
    failed=False
    for url in args.probe:
        try:report={'ok':True,**public_structure(url)}
        except Exception as error:
            failed=True
            report={'ok':False,'provider':PROVIDER,'url':url,'error':type(error).__name__+': '+str(error)[:300]}
        print(json.dumps(report,ensure_ascii=False,allow_nan=False),flush=True)
    if failed:raise SystemExit(1)
