"""Anonymous official cards and meeting results, joined by JKA registration ID.

Follow the public program's navigation exactly. Session cookies and navigation
parameters stay in memory; only public display fields and receipts are returned.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from http.cookiejar import CookieJar
import json
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

from venues import identity
from meeting_history import validate_history

PROVIDER = 'keirin.jp'
HOSTS = {'keirin.jp', 'www.keirin.jp'}
PROGRAM_PATH = '/pc/dfw/dataplaza/guest/raceprogram'
RESULT_PATH = '/pc/dfw/dataplaza/guest/raceresult'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    require(isinstance(value, str), 'Expected official text')
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def program_url(code, day):
    return 'https://keirin.jp' + PROGRAM_PATH + '?' + urlencode({'KCD': code, 'KST': day})


def result_url(code, day, number):
    return 'https://keirin.jp' + RESULT_PATH + '?' + urlencode({'KCD': code, 'KBI': day, 'RNO': number})


def check_url(url):
    p = urlsplit(url)
    pairs = parse_qsl(p.query, keep_blank_values=True); q = dict(pairs)
    require(p.scheme == 'https' and p.hostname in HOSTS
            and not (p.username or p.password or p.port or p.fragment)
            and len(q) == len(pairs), 'Unexpected official source URL')
    if p.path == '/pc/top':
        require(not q, 'Unexpected official top query')
    elif p.path == PROGRAM_PATH:
        require(set(q) == {'KCD', 'KST'} and re.fullmatch(r'\d{2}', q['KCD']), 'Invalid official program URL')
        datetime.strptime(q['KST'], '%Y%m%d')
    elif p.path == RESULT_PATH:
        require(set(q) == {'KCD', 'KBI', 'RNO'} and re.fullmatch(r'\d{2}', q['KCD'])
                and re.fullmatch(r'[1-9]|1[0-2]', q['RNO']), 'Invalid official result URL')
        datetime.strptime(q['KBI'], '%Y%m%d')
    elif p.path == '/pc/json':
        require(set(q) == {'type', 'encp'} and q['type'] in ('JSJ002', 'JSJ012')
                and 0 < len(q['encp']) <= 2000, 'Unexpected public navigation request')
    else:
        raise ValueError('Unexpected official source path')
    return url


class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def embedded(page):
    match = re.search(r'jsonData\[[\'\"]PC0201[\'\"]\]\s*=\s*', page)
    require(match is not None, 'Official program JSON is unavailable')
    value = json.JSONDecoder().raw_decode(page[match.end():].lstrip())[0]
    require(isinstance(value, dict) and isinstance(value.get('C0201data'), dict), 'Invalid official program')
    return value['C0201data']


def parse_program(page, code, day):
    data = embedded(page)
    require(data.get('selKaisai') == day and data.get('selKjyoCd') == code, 'Official program venue/date differs')
    races = data.get('C0201race')
    require(isinstance(races, list) and 1 <= len(races) <= 12, 'Official race navigation is unavailable')
    require(all(isinstance(r, dict) and isinstance(r.get('encParaR'), str)
                and 0 < len(r['encParaR']) <= 2000 for r in races), 'Invalid official public navigation')
    return data


def parse_cards(payload):
    require(isinstance(payload, dict) and isinstance(payload.get('raceInfo'), list), 'Official cards are unavailable')
    races, ids = {}, set()
    for row in payload['raceInfo']:
        number = compact(row['raceNo'])
        require(re.fullmatch(r'[1-9]|1[0-2]', number) and int(number) not in races, 'Invalid/duplicate official card race')
        players = row.get('sensyuTypeInfo')
        require(isinstance(players, list) and 1 <= len(players) <= 9, 'Official rider list unavailable')
        riders = {}
        for player in players:
            car, identifier, period = compact(player['syaban']), player['sensyuRegistNo'], compact(player['sotugyouki'])
            require(re.fullmatch(r'[1-9]', car) and int(car) not in riders
                    and isinstance(identifier, str) and re.fullmatch(r'\d{6}', identifier)
                    and identifier not in ids and re.fullmatch(r'\d{1,3}', period), 'Invalid/duplicate official rider identity')
            ids.add(identifier)
            name = compact(player['sensyuName']); require(bool(name), 'Official rider name is empty')
            status = compact(player.get('ketujyouTuikaHojyu', ''))
            # Addition/substitution is not an absence. Keep the original label.
            riders[int(car)] = {'no': int(car), 'name': name, 'period': int(period), 'player_id': identifier,
                                'absent': '欠場' in status or '欠車' in status or '取消' in status,
                                'entry_status': status}
        races[int(number)] = {'race_type': compact(row['shumokuName']), 'players': riders}
    require(bool(races), 'No official current-card riders')
    return races


def parse_results(payload, code, day, number, meeting_start, entries):
    require(isinstance(payload, dict) and isinstance(payload.get('tyakujyunItemSubData'), list), 'Official result rows unavailable')
    rows = payload['tyakujyunItemSubData']; require(bool(rows), 'Earlier official race result is not finalized')
    output, seen = {}, set()
    for row in rows:
        car = compact(row['syaban']); identifier = row['sensyuRegistNo']
        require(re.fullmatch(r'[1-9]', car) and int(car) in entries and identifier not in seen, 'Official result car differs')
        expected = entries[int(car)]
        require(identifier == expected['player_id'] and compact(row['sensyuName']) == expected['name']
                and compact(row['sotugyouki']) == str(expected['period']), 'Official result rider differs')
        seen.add(identifier)
        rank = compact(row['tyaku'])
        if re.fullmatch(r'[1-9]', rank):
            order, accident = int(rank), ''
        else:
            require(re.fullmatch(r'[欠場失格落車棄権故障再入]{1,4}',rank) is not None,
                    'Unknown official rank label: '+repr(rank)+' '+code+' '+day+' '+str(number)+'R')
            order, accident = 0, rank
        flags = compact(row.get('BH', ''))
        require(flags in ('', 'H', 'B', 'HB', 'BH'), 'Unknown official H/B value')
        timing = compact(row.get('agari', ''))
        require(timing in ('', '-', '—') or re.fullmatch(r'\d{1,2}\.\d{1,3}', timing), 'Invalid official individual time')
        actual_day = datetime.strptime(day, '%Y%m%d').date()
        start_day = datetime.strptime(meeting_start, '%Y%m%d').date()
        output[identifier] = {'provider': PROVIDER, 'player_id': identifier,
            'car_number':int(car),
            'race_id': f'{number:02}{code}{day}', 'meeting_day': (actual_day - start_day).days + 1,
            'race_number': number, 'race_date': actual_day.isoformat(), 'result_url': result_url(code, day, number),
            'order': order, 'display_type': 0, 'has_accident': bool(accident), 'accident': accident,
            'accident_name': accident, 'final_half_record': timing, 'start': None,
            'home': 'H' in flags, 'back': 'B' in flags}
    missing = set(p['player_id'] for p in entries.values()) - seen
    require(all(p['absent'] for p in entries.values() if p['player_id'] in missing), 'Incomplete official result riders')
    return output


class OfficialClient:
    def __init__(self, pause=0.5):
        self.opener = build_opener(OfficialRedirect(), HTTPCookieProcessor(CookieJar()))
        self.pause = pause; self.started = False
        self.programs = {}; self.card_cache = {}; self.receipts = []

    def _read(self, url, referer=None):
        check_url(url)
        headers = {'User-Agent': 'KeirinLineup2/1.0', 'Accept': 'text/html,application/json'}
        if referer:
            headers['Referer'] = referer
        for attempt in range(3):
            try:
                if self.pause:
                    time.sleep(self.pause)
                with self.opener.open(Request(url, headers=headers), timeout=25) as response:
                    check_url(response.url)
                    raw = response.read(6_000_001)
                    require(len(raw) <= 6_000_000, 'Official source exceeds size limit')
                    text = raw.decode(response.headers.get_content_charset() or 'utf-8')
                return text, datetime.now(timezone.utc).isoformat()
            except (HTTPError, URLError, TimeoutError) as error:
                if attempt == 2 or isinstance(error, HTTPError) and error.code not in (404, 408, 500, 502, 503, 504):
                    # Do not include public navigation/session values in errors.
                    raise ValueError('KEIRIN.JP source read failed: ' + type(error).__name__) from None
                time.sleep((2, 5)[attempt])

    def program(self, code, day):
        if not self.started:
            self._read('https://keirin.jp/pc/top'); self.started = True
        key = (code, day)
        if key not in self.programs:
            url = program_url(code, day)
            page, observed = self._read(url, 'https://keirin.jp/pc/top')
            self.programs[key] = parse_program(page, code, day)
            self.receipts.append({'provider': PROVIDER, 'url': url, 'observed_at': observed, 'kind': 'program'})
        return self.programs[key]

    def _json(self, code, day, number, kind):
        program = self.program(code, day)
        require(1 <= number <= len(program['C0201race']), 'Official race number is unavailable')
        navigation = program['C0201race'][number - 1]['encParaR']
        text, observed = self._read('https://keirin.jp/pc/json?' + urlencode({'type': kind, 'encp': navigation}), program_url(code, day))
        return json.loads(text), observed

    def cards(self, code, day):
        key = (code, day)
        if key not in self.card_cache:
            data, observed = self._json(code, day, 1, 'JSJ002')
            self.card_cache[key] = (parse_cards(data), observed)
            self.receipts.append({'provider': PROVIDER, 'url': program_url(code, day), 'observed_at': observed, 'kind': 'entries'})
        return self.card_cache[key]

    def results(self, code, day, number, meeting_start, entries, *, allow_pending=False):
        data, observed = self._json(code, day, number, 'JSJ012')
        try:
            output = ({} if allow_pending and isinstance(data,dict) and not data.get('tyakujyunItemSubData')
                      else parse_results(data, code, day, number, meeting_start, entries))
        except ValueError:
            print('OFFICIAL RESULT DISPLAY',code,day,number,json.dumps([
                {k:r.get(k) for k in ('syaban','sensyuRegistNo','tyaku','agari','BH','kojinStateItemSubData')}
                for r in data.get('tyakujyunItemSubData',[])],ensure_ascii=False),flush=True)
            raise
        url = result_url(code, day, number)
        self.receipts.append({'provider': PROVIDER, 'url': url, 'observed_at': observed, 'kind': 'results'})
        for result in output.values():
            result['observed_at'] = observed
        return output


def enrich_cards(dataset, client=None):
    """Verify the complete current card and attach only earlier meeting results."""
    require(dataset.get('provider') == 'kdreams', 'Official enrichment needs a fresh K Dreams card')
    result = deepcopy(dataset); client = client or OfficialClient()
    meetings = {}
    for race in result['races']:
        ident = identity(race['source']); require(ident['provider'] == 'kdreams', 'Mixed source cards')
        require(ident['date'] == result['target_date'].replace('-', ''), 'Official target date differs')
        meetings.setdefault((ident['code'], ident['start'], ident['date']), []).append(race)
    for (code, start, target), races in meetings.items():
        cards, observed = client.cards(code, target)
        current = {}
        for race in races:
            require(race['race'] in cards, 'Official current race is missing')
            entries = cards[race['race']]['players']
            require(set(entries) == {p['no'] for p in race['players']}, 'Official current cars differ from K Dreams')
            require(cards[race['race']]['race_type'].startswith('S級'), 'Official race class differs')
            for player in race['players']:
                entry = entries[player['no']]
                require(compact(player['name']) == entry['name'] and player['period'] == entry['period'], 'K Dreams/official car, name or period differs')
                require(not player.get('player_id') or player['player_id'] == entry['player_id'], 'Official registration number differs')
                player['player_id'] = entry['player_id']
                player['identity_source'] = {'provider': PROVIDER, 'url': program_url(code, target),
                                             'race_number': race['race'], 'observed_at': observed}
                player['absent'] = player.get('absent', False) or entry['absent']
                player['entry_status'] = entry['entry_status']
                player['meeting_results'] = []
                require(entry['player_id'] not in current, 'Duplicate official current rider')
                current[entry['player_id']] = player
        first, last = datetime.strptime(start, '%Y%m%d').date(), datetime.strptime(target, '%Y%m%d').date()
        for offset in range((last - first).days):
            day = (first + timedelta(days=offset)).strftime('%Y%m%d')
            previous, _ = client.cards(code, day)
            seen = set()
            for number, row in previous.items():
                entries = row['players']
                matching = {p['player_id'] for p in entries.values()} & current.keys()
                if not matching:
                    continue
                today=datetime.now(ZoneInfo('Asia/Tokyo')).date()
                pending=last>today and day==today.strftime('%Y%m%d')
                history = (client.results(code, day, number, start, entries,allow_pending=True) if pending
                           else client.results(code, day, number, start, entries))
                for identifier in matching:
                    require(identifier not in seen, 'Rider appears in multiple official races on one day')
                    seen.add(identifier)
                    if identifier in history:
                        current[identifier]['meeting_results'].append(history[identifier])
            print('OFFICIAL HISTORY', code, day, len(seen), 'riders verified', flush=True)
        for race in races:
            for player in race['players']:
                player['meeting_results'] = validate_history(player['meeting_results'], race['source'])
        print('OFFICIAL IDENTITIES', code, target, len(current), 'riders verified', flush=True)
    result['history_sources'] = deepcopy(client.receipts)
    return result
