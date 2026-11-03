"""Public OddsPark rider identities and verified earlier-meeting results.

Only the official logged-out smartphone routes used by this collector are
allowed. Source pages stay in memory; provenance contains URLs and observation
times, never source HTML.
"""
from datetime import date, datetime, timezone
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from source_http import Document
from venues import VENUES


HOST = 'sp.oddspark.com'
ROUTES = {
    '/keirin/SpRaceInfo.do': 'card',
    '/keirin/SpRaceResultInfo.do': 'result',
    '/keirin/SpRaceList.do': 'list',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def source_identity(url):
    """Validate an exact public race route before every read and redirect."""
    parsed = urlsplit(url)
    require(parsed.scheme == 'https' and parsed.hostname == HOST
            and not (parsed.username or parsed.password or parsed.port or parsed.fragment)
            and parsed.path in ROUTES, 'Unexpected OddsPark public source URL')
    pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    params = dict(pairs)
    require(len(params) == len(pairs), 'Duplicate OddsPark query parameter')
    keys = {'joCd', 'kaisaiBi'}
    if ROUTES[parsed.path] != 'list':
        keys.add('raceNo')
    require(set(params) in (keys, keys | {'joCode'}), 'Unexpected OddsPark query parameters')
    code, day = params['joCd'], params['kaisaiBi']
    require(code in VENUES and params.get('joCode', code) == code,
            'OddsPark venue codes differ')
    require(re.fullmatch(r'\d{8}', day) is not None, 'Invalid OddsPark calendar date')
    parsed_day = date.fromisoformat(f'{day[:4]}-{day[4:6]}-{day[6:]}')
    require(parsed_day.strftime('%Y%m%d') == day, 'Invalid OddsPark calendar date')
    number = None
    if 'raceNo' in params:
        require(re.fullmatch(r'[1-9]|1[0-2]', params['raceNo']) is not None,
                'Invalid OddsPark race number')
        number = int(params['raceNo'])
    return {'code': code, 'date': day, 'race': number, 'kind': ROUTES[parsed.path]}


def race_url(code, day, number, *, result=False):
    route = 'SpRaceResultInfo.do' if result else 'SpRaceInfo.do'
    value = f'https://{HOST}/keirin/{route}?' + urlencode(
        {'joCd': code, 'kaisaiBi': day.replace('-', ''), 'raceNo': number})
    source_identity(value)
    return value


def list_url(code, day):
    value = f'https://{HOST}/keirin/SpRaceList.do?' + urlencode(
        {'joCd': code, 'kaisaiBi': day.replace('-', '')})
    source_identity(value)
    return value


class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        source_identity(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, sources):
    """Read bounded public HTML without sessions, login, or persisted copies."""
    source_identity(url)
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'KeirinLineup2/1.0'})
            with build_opener(PublicRedirect()).open(request, timeout=30) as response:
                source_identity(response.url)
                raw = response.read(6_000_001)
                require(len(raw) <= 6_000_000, 'OddsPark response exceeds size limit')
                content = raw.decode(response.headers.get_content_charset() or 'utf-8')
            observed = datetime.now(timezone.utc).isoformat()
            sources.append({'url': url, 'observed_at': observed})
            return Document(content).root, observed
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == 2 or isinstance(error, HTTPError) and error.code not in (
                    404, 408, 500, 502, 503, 504):
                raise
            time.sleep((2, 5)[attempt])


def parse_history_slot(value):
    """Decode one official 今場所 day, without treating B as evidence of H.

    Blank day slots remain blank so supplement entries do not shift earlier
    results onto a different date. The optional 補 suffix marks a supplement;
    it does not change that race's official rank or S/H/B flags.
    """
    raw = re.sub(r'\s+', '', value)
    if not raw or compact(raw) in ('-', '—', '―', '補'):
        return None
    circular = '①②③④⑤⑥⑦⑧⑨'
    solid = '❶❷❸❹❺❻❼❽❾'
    display_type = 0
    if raw[0] in circular + solid:
        characters = circular if raw[0] in circular else solid
        display_type = 1 if characters == circular else 2
        raw = str(characters.index(raw[0]) + 1) + raw[1:]
    normalized = compact(raw)
    match = re.fullmatch(r'([1-9]|欠|落|失|棄|未|負傷欠場)(S?H?B?)(補?)', normalized)
    require(match is not None, 'Unknown OddsPark current-meeting rank or S/H/B flags')
    label, flags, _supplement = match.groups()
    order = int(label) if label.isdigit() else 0
    accident = '' if order else label
    return {'order': order, 'display_type': display_type,
            'start': 'S' in flags, 'home': 'H' in flags, 'back': 'B' in flags,
            'has_accident': bool(accident), 'accident': accident,
            'accident_name': accident}


def validate_page_identity(doc, url):
    """Check the separately rendered official title against the request."""
    ident = source_identity(url)
    titles = [compact(node.text()) for node in doc.find_all('title')]
    require(len(titles) == 1, 'Missing or ambiguous OddsPark page title')
    title = titles[0]
    dates = re.findall(r'(\d{4})年(\d{1,2})月(\d{1,2})日', title)
    day = ident['date']
    require(len(dates) == 1 and tuple(map(int, dates[0])) ==
            (int(day[:4]), int(day[4:6]), int(day[6:])),
            'OddsPark page calendar date differs')
    require(VENUES[ident['code']][0] in title, 'OddsPark page venue differs')
    if ident['race'] is not None:
        numbers = re.findall(r'(?<!\d)(\d{1,2})R', title)
        require(len(numbers) == 1 and int(numbers[0]) == ident['race'],
                'OddsPark page race number differs')
    return ident
