"""Verify K Dreams' existing assignment links; never collect or alter race cards."""
import argparse
from datetime import date, datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

ORIGIN = 'https://keirin.kdreams.jp'
HUB = ORIGIN + '/seibuen/'
ROOT = Path(__file__).resolve().parents[1]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def compact(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def source_url(url):
    p = urlsplit(url)
    require(p.scheme == 'https' and p.hostname == 'keirin.kdreams.jp'
            and not (p.username or p.password or p.port or p.query or p.fragment)
            and re.fullmatch(r'/[a-z]+/(?:assen/\d{10}/)?', p.path),
            'Unexpected assignment source URL')
    return url


class Redirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        source_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def remote(url):
    source_url(url)
    with build_opener(Redirect()).open(Request(url, headers={
            'User-Agent': 'keirin-lineup2-calendar', 'Cache-Control': 'no-cache'}), timeout=20) as response:
        require(response.status == 200 and response.url == url, 'Assignment page is not HTTP 200 at its own URL')
        raw = response.read(4_000_001)
        require(len(raw) <= 4_000_000, 'Assignment page exceeds size limit')
        html = raw.decode(response.headers.get_content_charset() or 'utf-8')
    return html, {'url': url, 'sha256': sha256(raw).hexdigest(),
                  'observed_at': datetime.now(timezone.utc).isoformat(), 'http_status': 200}


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.active, self.headings, self.links, self.tables = [], [], [], []
        self.roster_periods = 0
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table':
            self.tables.append('assen_s' in attrs.get('class', '').split())
        if tag in ('title', 'h1', 'h2', 'a') or tag == 'td' and any(self.tables):
            self.active.append([tag, attrs.get('href'), []])

    def handle_data(self, text):
        for item in self.active:
            item[2].append(text)

    def handle_endtag(self, tag):
        for i in range(len(self.active)-1, -1, -1):
            if self.active[i][0] == tag:
                kind, href, parts = self.active.pop(i)
                text = ''.join(parts).strip()
                if kind == 'a':
                    self.links.append((href, text))
                elif kind == 'td':
                    self.roster_periods += bool(re.fullmatch(r'\d{1,3}', compact(text)))
                else:
                    self.headings.append((kind, text))
                break
        if tag == 'table' and self.tables:
            self.tables.pop()


def assignment_link(href, home, meeting):
    if not isinstance(href, str):
        return None
    p = urlsplit(urljoin(home, href))
    if p.scheme != 'https' or p.netloc != 'keirin.kdreams.jp':
        return None
    expected = urlsplit(home).path + 'assen/' + meeting['code'] + meeting['start'].replace('-', '') + '/'
    if p.path != expected:
        return None
    return source_url(urlunsplit((p.scheme, p.netloc, p.path, '', '')))


def verify_assignment(page, meeting):
    require(any(kind == 'h1' and compact(text) == compact(meeting['venue']+'競輪あっせん情報')
                for kind, text in page.headings), 'Assignment venue differs')
    periods = []
    for kind, text in page.headings:
        if kind != 'h2' or 'あっせん情報' not in text:
            continue
        match = re.fullmatch(r'(\d{4})年(\d{1,2})月(\d{1,2})日[~〜～](\d{4})年(\d{1,2})月(\d{1,2})日あっせん情報', compact(text))
        if match:
            y, m, d, ey, em, ed = map(int, match.groups())
            periods.append((date(y, m, d).isoformat(), date(ey, em, ed).isoformat()))
    require(periods == [(meeting['start'], meeting['end'])], 'Assignment dates differ')
    require(page.roster_periods > 0, 'Published S-class assignment list is empty')


def collect(schedule, today, read=remote):
    require(schedule.get('schema_version') == 1 and schedule.get('meetings'), 'Calendar schedule unavailable')
    pending = [m for m in schedule['meetings'] if m['end'] > today.isoformat()]
    hub_html, hub_receipt = read(HUB)
    homes = {}
    for href, label in Page(hub_html).links:
        p = urlsplit(urljoin(HUB, href or ''))
        if p.scheme == 'https' and p.netloc == 'keirin.kdreams.jp' and re.fullmatch(r'/[a-z]+/', p.path):
            homes[compact(label)] = source_url(urlunsplit((p.scheme, p.netloc, p.path, '', '')))
    records, sources = [], [hub_receipt]
    for code in sorted({m['code'] for m in pending}):
        meetings = [m for m in pending if m['code'] == code]
        venue = meetings[0]['venue']
        home = homes.get(compact(venue+'競輪'))
        require(home is not None, 'K Dreams venue link unavailable: '+venue)
        html, receipt = (hub_html, hub_receipt) if home == HUB else read(home)
        page = Page(html)
        require(any(kind == 'h1' and compact(text) == compact(venue+'競輪') for kind, text in page.headings), 'Venue page differs: '+venue)
        if home != HUB:
            sources.append(receipt)
        for meeting in meetings:
            found = {assignment_link(href, home, meeting) for href, label in page.links if compact(label) in ('あっせん情報', '斡旋情報')}
            found.discard(None)
            require(len(found) <= 1, 'Ambiguous assignment link')
            if not found:
                continue
            href = found.pop()
            assignment_html, checked = read(href)
            verify_assignment(Page(assignment_html), meeting)
            records.append({key: meeting[key] for key in ('id', 'code', 'venue', 'start', 'end')} | {
                'href': href, 'source_url': home, 'sha256': checked['sha256'],
                'observed_at': checked['observed_at'], 'http_status': checked['http_status']})
        print(json.dumps({'venue': venue, 'checked_links': sum(r['code'] == code for r in records)}, ensure_ascii=False), flush=True)
    return {'schema_version': 1, 'provider': 'kdreams', 'verification': 'anonymous-http',
            'checked_at': datetime.now(timezone.utc).isoformat(), 'as_of': today.isoformat(),
            'sources': sources, 'meetings': sorted(records, key=lambda m: (m['start'], m['code']))}


def refresh(schedule_path, output):
    require(output.resolve().is_relative_to(ROOT), 'Assignment links must stay inside site/calendar')
    data = collect(json.loads(schedule_path.read_text()), datetime.now(ZoneInfo('Asia/Tokyo')).date())
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(output)
    print(json.dumps({'verified_meetings': len(data['meetings']), 'database_writes': 0}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--schedule', type=Path, default=ROOT/'schedule.json')
    parser.add_argument('--output', type=Path, default=ROOT/'entry-links.json')
    args = parser.parse_args()
    refresh(args.schedule, args.output)
