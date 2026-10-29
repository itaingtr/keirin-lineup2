"""Read only published K Dreams prediction marks, matching every car and rider."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from source_http import Document, cells
from venues import identity, VENUES

CUTOVER = '20261030'
MARKS = ('', '◎', '○', '◯', '▲', '△', '×', '注', '☆', '★', '穴')
PREFECTURES = '北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄 外国'.split()
RIDER = re.compile(r'(.+?)(?:' + '|'.join(PREFECTURES) + r')/\d+/(\d+)')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def race_url(race):
    ident = identity(race['source'])
    day = race['meetingDay']
    require(ident['code'] == race['venueCode'] and ident['start'] == race['meetingStart']
            and ident['race'] == race['race'], 'Race identity differs')
    return (f"https://my.keirin.kdreams.jp/{VENUES[ident['code']][1]}/racedetail/"
            f"{ident['code']}{ident['start']}{day:02}{ident['race']:04}/")


def check_url(url):
    p = urlsplit(url)
    require(p.scheme == 'https' and p.hostname == 'my.keirin.kdreams.jp'
            and not (p.username or p.password or p.port or p.query or p.fragment)
            and re.fullmatch(r'/[a-z]+/racedetail/\d{16}/', p.path), 'Unexpected prediction source URL')


class MarksRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read(url):
    check_url(url)
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'KeirinLineup2/1.0'})
            with build_opener(MarksRedirect()).open(request, timeout=25) as response:
                check_url(response.url)
                raw = response.read(6_000_001)
                require(len(raw) <= 6_000_000, 'Prediction source exceeds size limit')
                text = raw.decode(response.headers.get_content_charset() or 'utf-8')
            return Document(text).root, datetime.now(timezone.utc).isoformat()
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == 2 or isinstance(error, HTTPError) and error.code not in (404, 408, 500, 502, 503, 504):
                raise
            time.sleep((2, 5)[attempt])


def parse_marks(doc, race, observed_at):
    url = race_url(race)
    for link in doc.find_all('link'):
        if link.attrs.get('rel') == 'canonical':
            require(urlsplit(link.attrs.get('href', '')).path == urlsplit(url).path, 'Prediction canonical differs')
    title = next((n.text() for n in doc.find_all('title')), '')
    match = re.search(r'\b(\d+)R\s+[ＳS]級', title)
    ident = identity(race['source'])
    day = ident['date']
    date_label = f'{int(day[:4])}年{int(day[4:6])}月{int(day[6:])}日'
    require(match is not None and int(match[1]) == race['race'] and date_label in title, 'Prediction race/date differs')
    classes = lambda node: node.attrs.get('class', '').split()
    tables = [t for t in doc.find_all('table') if 'racecard_table' in classes(t)
              and 'none' not in classes(t) and '直近4ヶ月の成績' in compact(t.text())]
    require(len(tables) == 1, 'Missing primary prediction table')
    expected = {p['no']: p for p in race['players']}
    players = {}
    for row in tables[0].find_all('tr'):
        values = cells(row)
        numbers = [n for n in values if 'num' in classes(n)]
        if not numbers:
            continue
        require(len(numbers) == 1 and re.fullmatch(r'[1-9]', compact(numbers[0].text())), 'Invalid prediction car')
        number = int(compact(numbers[0].text()))
        require(number in expected and number not in players, 'Unexpected or duplicate prediction car')
        names = [n for n in values if 'rider' in classes(n)]
        tips = [n for n in values if 'tip' in classes(n)]
        require(len(names) == len(tips) == 1, 'Missing rider or mark column')
        rider = RIDER.fullmatch(compact(names[0].text()))
        require(rider is not None and rider[1] == compact(expected[number]['name'])
                and int(rider[2]) == int(expected[number]['period']), 'Prediction rider identity differs')
        mark = tips[0].text().strip()
        require(mark in MARKS, 'Unrecognized published prediction mark')
        players[number] = {'no': number, 'name': expected[number]['name'],
                           'period': str(expected[number]['period']), 'mark': mark}
    require(set(players) == set(expected), 'Incomplete prediction table')
    return {'source_url': race['source'], 'prediction_source_url': url, 'observed_at': observed_at,
            'players': [players[n] for n in sorted(players)]}


def validate_marks(data, races, target):
    require(data.get('schema_version') == 1 and data.get('provider') == 'kdreams'
            and data.get('target_date') == target, 'Wrong prediction provider/date')
    records = data.get('races')
    require(isinstance(records, list) and len(records) == len(races), 'Incomplete prediction races')
    mapped = {r['source_url']: r for r in records}
    require(len(mapped) == len(records) and set(mapped) == {r['source'] for r in races}, 'Prediction races differ')
    for race in races:
        require(identity(race['source'])['date'] == target.replace('-', ''), 'Prediction race calendar date differs')
        row = mapped[race['source']]
        require(row['prediction_source_url'] == race_url(race), 'Prediction source differs')
        observed = datetime.fromisoformat(row['observed_at'])
        require(observed.tzinfo is not None and observed <= datetime.now(timezone.utc), 'Invalid prediction observation time')
        players = row['players'];by_number = {p['no']: p for p in players}
        require(len(by_number) == len(players) == len(race['players']), 'Prediction rider count differs')
        for player in race['players']:
            saved = by_number.get(player['no'], {})
            require(saved.get('name') == player['name'] and saved.get('period') == str(player['period'])
                    and saved.get('mark') in MARKS, 'Saved prediction rider/mark differs')
    return data


def collect_marks(races, target, reader=read, pause=1):
    records = []
    for race in races:
        if pause:
            time.sleep(pause)
        doc, observed = reader(race_url(race))
        records.append(parse_marks(doc, race, observed))
        print('RAKUTEN MARKS', race['venue'], race['race'], 'R verified', flush=True)
    data = {'schema_version': 1, 'provider': 'kdreams', 'target_date': target,
            'checked_at': datetime.now(timezone.utc).isoformat(), 'races': records}
    return validate_marks(data, races, target)


def stage_marks(data, run_key, output):
    require(re.fullmatch(r'run-\d+-\d+', run_key), 'Invalid prediction run key')
    prefix = Path(output) / 'fallback/marks' / data['target_date'].replace('-', '')
    runs = prefix / 'runs';runs.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
    with (runs / (run_key + '.json')).open('x') as handle:
        handle.write(payload)
    (prefix / 'latest.json').write_text(payload)
    return payload
