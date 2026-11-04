"""Read public KEIRIN.JP schedules; keep only verified meeting display fields.

Run in Actions where the official site is reachable. No rider/odds/database
collection. All responses must validate before replacing the calendar data.
"""
import argparse
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from venues import VENUES

NAMES = {v[0]: k for k, v in VENUES.items()}
GRADES = ('GP', 'G1', 'G2', 'G3', 'F1')
HOST = 'https://keirin.jp'


def require(ok, message):
    if not ok:
        raise ValueError(message)


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    @property
    def text(self):
        return ''.join(c.text if isinstance(c, Node) else c for c in self.children).strip()

    def find(self, tag):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag == tag:
                    yield child
                yield from child.find(tag)

    def has_class(self, name):
        return name in self.attrs.get('class', '').split()


class Document(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in ('img', 'br', 'input', 'link', 'meta', 'hr', 'area', 'source', 'wbr'):
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for pos in range(len(self.stack)-1, 0, -1):
            if self.stack[pos].tag == tag:
                del self.stack[pos:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def month_shift(day, shift):
    n = day.year * 12 + day.month - 1 + shift
    return date(n // 12, n % 12 + 1, 1)


def meeting(code, grade, start, end, title, url, observed):
    require(code in VENUES and grade in GRADES, 'Unknown official venue/grade')
    require(0 <= (end-start).days <= 5, 'Unexpected meeting duration')
    return {'id': f'{code}-{start.isoformat()}-{grade}', 'code': code,
            'venue': VENUES[code][0], 'grade': grade,
            'start': start.isoformat(), 'end': end.isoformat(), 'title': title,
            'source_url': url, 'observed_at': observed}


def period(text, month):
    m = re.fullmatch(r'(\d{2})/(\d{2})\([^)]*\)～(\d{2})/(\d{2})\([^)]*\)', text.strip())
    require(m, 'Unexpected official date range: '+text)
    sm, sd, em, ed = map(int, m.groups())
    candidates = []
    for year in (month.year-1, month.year, month.year+1):
        try:
            first = date(year, sm, sd)
            last = date(year+(em < sm), em, ed)
        except ValueError:
            continue
        if first <= date(month.year, month.month, monthrange(month.year, month.month)[1]) and last >= month:
            candidates.append((first, last))
    require(len(candidates) == 1, 'Official meeting does not intersect requested month')
    return candidates[0]


def parse_month(html, month, url, observed):
    root = Document(html).root
    selected = {}
    for select in root.find('select'):
        selected[select.attrs.get('name')] = [n.attrs.get('value') for n in select.find('option') if 'selected' in n.attrs]
    # Official future months outside the published half-year have value=0.
    if selected.get('cmdYearval') == ['0'] and selected.get('cmdDayval') == ['0']:
        require(not any(n.has_class('kikan') for n in root.find('td')), 'Unavailable month contains meetings')
        return None
    require(selected.get('cmdYearval') == [str(month.year)] and selected.get('cmdDayval') == [f'{month.month:02}'],
            'Official schedule returned a different month')
    venue, grade, pending, output, venues_seen = None, None, None, [], set()
    for cell in root.find('td'):
        if cell.has_class('border_width0') and cell.text in NAMES:
            venue = NAMES[cell.text]; venues_seen.add(venue)
        if cell.has_class('grade'):
            grades = [n.attrs.get('alt') for n in cell.find('img')]
            require(len(grades) == 1 and grades[0] in (*GRADES, 'F2'), 'Unknown schedule grade')
            grade = grades[0]
        if cell.has_class('kikan'):
            require(venue and grade, 'Official date range lacks venue or grade')
            start, end = period(cell.text, month)
            if grade in GRADES:
                pending = meeting(venue, grade, start, end, '', url, observed)
                output.append(pending)
            else:
                pending = None
            grade = None
        elif cell.has_class('pd_l5') and 'colspan' in cell.attrs and pending is not None:
            pending['title'] = cell.text
            pending = None
    require(len(venues_seen) >= 35, 'Incomplete official venue schedule')
    require(output and all(m['title'] for m in output), 'Official S-class meetings are incomplete')
    require(len({m['id'] for m in output}) == len(output), 'Duplicate official meeting')
    return output


def grade_period(text, month, fiscal):
    match = re.search(r'([^\s()]+)\((\d{2})～(?:(\d{2})/)?(\d{2})\)', text)
    require(match, 'Unexpected grade date range: '+text)
    name, sd, em, ed = match.groups()
    require(name in NAMES, 'Unknown grade venue: '+name)
    year = fiscal + (month < 4)
    if em:
        end_month = int(em)
        end_year = year + (end_month < month-1) - (end_month > month+1)
        end = date(end_year, end_month, int(ed))
        start_month = month_shift(end.replace(day=1), -1)
        start = start_month.replace(day=int(sd))
    else:
        start, end = date(year, month, int(sd)), date(year, month, int(ed))
    return NAMES[name], start, end


def parse_grades(html, fiscal, url, observed):
    root = Document(html).root
    require(f'{fiscal}年度' in root.text, 'Official grade fiscal year differs')
    output, months = [], set()
    for row in root.find('tr'):
        cells = [n for n in row.children if isinstance(n, Node) and n.tag == 'td']
        if len(cells) != 3:
            continue
        labels = [n for n in cells[1].find('td') if n.has_class('month')]
        if len(labels) != 1:
            continue
        month = int(labels[0].text.replace('月', '')); months.add(month)
        for side, default in ((cells[0], None), (cells[2], 'G3')):
            for cell in side.find('td'):
                if not cell.has_class('tbwid50pad04') or not cell.text:
                    continue
                grades = [n.attrs.get('alt') for n in cell.find('img') if n.attrs.get('alt') in GRADES]
                grade = grades[0] if grades else default
                require(grade in GRADES, 'Official grade icon unavailable')
                code, start, end = grade_period(cell.text, month, fiscal)
                title = cell.text.split(VENUES[code][0]+'(')[0].strip() or 'G3'
                output.append(meeting(code, grade, start, end, title, url, observed))
    require(months == set(range(1, 13)) and len(output) >= 40, 'Incomplete official grade year')
    require(len({m['id'] for m in output}) == len(output), 'Duplicate grade meeting')
    return output


def fetch(url):
    require(url.startswith(HOST+'/sp/raceschedule?') or url.startswith(HOST+'/pc/graderaceschedule?'), 'Unexpected schedule route')
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html'}), timeout=40) as response:
                require(response.status == 200 and response.geturl().startswith(HOST+'/'), 'Official schedule redirected unexpectedly')
                return response.read().decode('utf-8')
        except HTTPError as error:
            if error.code not in (408, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep((2, 5)[attempt])


def collect(today, reader=fetch):
    checked = datetime.now(timezone.utc).isoformat()
    meetings, coverage, sources = {}, [], []
    # Include the first published archive month as well as all announced months.
    first = date(2026, 10, 1)
    require(today >= first, 'Calendar predates the first archive')
    # Older verified months are kept by refresh(); only fetch the preceding month
    # on subsequent runs to cover meetings spanning the month boundary.
    start = max(first, month_shift(today.replace(day=1), -1))
    for offset in range(19):
        month = month_shift(start, offset)
        url = HOST+f'/sp/raceschedule?scyy={month.year}&scym={month.month:02}'
        rows = parse_month(reader(url), month, url, checked)
        if rows is None:
            require(month > today.replace(day=1), 'Current official month is unavailable')
            break
        coverage.append(month.strftime('%Y-%m')); sources.append({'url': url, 'observed_at': checked})
        for row in rows:
            if row['id'] in meetings:
                require(meetings[row['id']]['end'] == row['end'], 'Official monthly dates conflict')
            meetings[row['id']] = row
    else:
        raise ValueError('Official monthly horizon was not found')
    fiscal = today.year-(today.month < 4)
    grade_years = []
    for year in (fiscal, fiscal+1):
        url = HOST+f'/pc/graderaceschedule?scyy={year}'
        html = reader(url)
        # The next year may not have been announced yet; distinguish the
        # official unavailable page from a truncated or failed response.
        if f'{year}年度' not in Document(html).root.text:
            require('年選択' in Document(html).root.text or '開催日程' in Document(html).root.text, 'Unknown grade response')
            continue
        rows = parse_grades(html, year, url, checked)
        grade_years.append(year); sources.append({'url': url, 'observed_at': checked})
        for row in rows:
            if row['id'] in meetings:
                require(meetings[row['id']]['end'] == row['end'], 'Monthly and grade dates conflict')
            else:
                meetings[row['id']] = row
    require(fiscal in grade_years, 'Current official grade year unavailable')
    return {'schema_version': 1, 'checked_at': checked, 'monthly_coverage': coverage,
            'grade_years': grade_years, 'sources': sources,
            'meetings': sorted(meetings.values(), key=lambda m: (m['start'], m['code'], GRADES.index(m['grade'])))}


def refresh(path, today):
    fresh = collect(today)
    if path.exists():
        old = json.loads(path.read_text())
        # Preserve all past meetings and month coverage; updated official future
        # meetings replace their previous forecasts only after full validation.
        before = min(fresh['monthly_coverage'])+'-01'
        kept = {m['id']: m for m in old['meetings'] if m['end'] < before}
        kept.update({m['id']: m for m in fresh['meetings']})
        fresh['meetings'] = sorted(kept.values(), key=lambda m: (m['start'], m['code'], GRADES.index(m['grade'])))
        fresh['monthly_coverage'] = sorted(set(old['monthly_coverage']+fresh['monthly_coverage']))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(fresh, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(path)
    print(json.dumps({'meetings': len(fresh['meetings']), 'monthly_coverage': fresh['monthly_coverage'],
                      'grade_years': fresh['grade_years'], 'database_writes': 0}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('site/calendar/schedule.json'))
    parser.add_argument('--today', type=date.fromisoformat, default=datetime.now(ZoneInfo('Asia/Tokyo')).date())
    args = parser.parse_args()
    refresh(args.output, args.today)
