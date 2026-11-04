"""Verify the published link index and last race; write only calendar metadata."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from published_card import parse_page
from calendar_export import _has_anchor
from venues import identity

BASE = '/keirin-lineup2/'
ORIGIN = 'https://itaingtr.github.io'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def public_path(path):
    require(isinstance(path, str) and re.fullmatch(r'/keirin-lineup2/line\d{8}\.html(?:#race-\d{2}-\d{1,2})?', path), 'Unexpected public date link')
    return urlsplit(path).path


def remote(path):
    require(path.startswith(BASE) and '..' not in path, 'Unexpected project path')
    url = ORIGIN+path
    with urlopen(Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'keirin-lineup2-calendar'}), timeout=30) as response:
        require(response.status == 200 and response.geturl() == url, 'Date page is not anonymously available')
        return response.read().decode('utf-8')


def build(index, reader, checked):
    require(index.get('schema_version') == 1 and index.get('site_base') == BASE and index.get('days'), 'Public date index unavailable')
    rows = []
    for day in index['days']:
        path = public_path(day['href'])
        require(path == BASE+'line'+day['date'].replace('-', '')+'.html', 'Index date/path mismatch')
        html = reader(path)
        races = parse_page(html)
        require(len(races) == day['race_count'], 'Published race count differs from index')
        venues = []
        for venue in day['venues']:
            require(public_path(venue['href']) == path, 'Venue date link differs')
            matches = [r for r in races if r['venueCode'] == venue['code'] and r['venue'] == venue['name']]
            require(len(matches) == venue['race_count'] and matches, 'Published venue count differs')
            final = max(matches, key=lambda r: r['race'])
            ident = identity(final['source'])
            require(ident['date'] == day['date'].replace('-', ''), 'Final race date differs')
            fragment = f"race-{venue['code']}-{final['race']}"
            has_anchor = _has_anchor(html, fragment)
            venues.append({'code': venue['code'], 'name': venue['name'], 'last_race': final['race'],
                           'meeting_start': ident['start'][:4]+'-'+ident['start'][4:6]+'-'+ident['start'][6:],
                           'href': day['href']+'#'+fragment if has_anchor else venue['href'],
                           'anchored': has_anchor, 'source': final['source']})
        rows.append({'date': day['date'], 'href': day['href'], 'sha256': hashlib.sha256(html.encode()).hexdigest(), 'venues': venues})
    return {'schema_version': 1, 'checked_at': checked, 'index_date': index['current_date'], 'days': rows}


def refresh(output, public=None):
    require(output.resolve().is_relative_to(Path(__file__).resolve().parents[1]), 'Calendar output must stay inside site/calendar')
    def read(path):
        if public is None:
            return remote(path)
        require(path.startswith(BASE), 'Unexpected local public link')
        return (public/path[len(BASE):]).read_text()
    index = json.loads(read(BASE+'calendar/dates.json'))
    data = build(index, read, datetime.now(timezone.utc).isoformat())
    data['verification'] = 'local-export' if public else 'anonymous-http'
    # Finish every page read before changing even one link.
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(output)
    print(json.dumps({'verified_days': len(data['days']), 'verified_venues': sum(len(d['venues']) for d in data['days']), 'database_writes': 0}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('site/calendar/race-links.json'))
    parser.add_argument('--public-dir', type=Path, help='Use an existing local export for initial build verification')
    args = parser.parse_args()
    refresh(args.output, args.public_dir)
