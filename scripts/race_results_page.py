"""Add read-only, on-demand results without rewriting saved cards or histories."""
import hashlib
import json
from pathlib import Path
import re

from published_card import parse_page
from venues import identity

CUTOVER = '20261114'
OFFICIAL_CUTOVER = '20261104'
BASE = '/keirin-lineup2/'
NAV_ASSET = 'all-results-nav.js'
ASSETS = ('race-results.js', 'race-results.css', 'race-results-config.json', NAV_ASSET)


def apply(page, site, output, day, *, force=False, all_results=False):
    if day < OFFICIAL_CUTOVER:
        return page
    identities = [identity(race['source']) for race in parse_page(page)]
    if any(row['provider'] != 'kdreams' for row in identities):
        if force or day >= CUTOVER:
            raise ValueError('On-demand results require verified K Dreams race sources')
        return page
    if {row['date'] for row in identities} != {day}:
        raise ValueError('All-results navigation date differs from card')
    site, output = Path(site), Path(output)
    marker = 'data-all-results-date="'+day+'"'
    if marker not in page:
        if 'data-all-results-date=' in page:
            raise ValueError('All-results navigation has another date')
        content = (site/NAV_ASSET).read_bytes()
        (output/NAV_ASSET).write_bytes(content)
        version = hashlib.sha256(content).hexdigest()[:12]
        page = page.replace('<body', '<body '+marker, 1)
        page = page.replace('</body>', '<script src="'+BASE+NAV_ASSET+'?v='+version+'"></script></body>', 1)
    if not force and day < CUTOVER:
        return page
    if 'data-race-results="true"' not in page:
        versions = {}
        for name in ASSETS:
            content = (site/name).read_bytes()
            (output/name).write_bytes(content)
            versions[name] = hashlib.sha256(content).hexdigest()[:12]
        config = BASE+'race-results-config.json?v='+versions['race-results-config.json']
        page = page.replace('<body', '<body data-race-results="true" data-race-results-config="'+config+'"', 1)
        page = page.replace('</head>', '<link rel="stylesheet" href="'+BASE+'race-results.css?v='+versions['race-results.css']+'"></head>', 1)
        page = page.replace('</body>', '<script src="'+BASE+'race-results.js?v='+versions['race-results.js']+'"></script></body>', 1)
    if all_results:
        page = page.replace('<body', '<body data-race-results-all="true"', 1)
        page = page.replace('</title>', '（全結果）</title>', 1)
    return page


def export_all_results(site, output, dates):
    output = Path(output)
    available = []
    for day in dates:
        if day < OFFICIAL_CUTOVER:
            continue
        page = (output/('line'+day+'.html')).read_text()
        if any(identity(race['source'])['provider'] != 'kdreams' for race in parse_page(page)):
            continue
        page = apply(page, site, output, day, force=True, all_results=True)
        def select_date(match):
            prefix, date, suffix = match.groups()
            return prefix+BASE+'results'+date+'.html'+suffix if date >= OFFICIAL_CUTOVER else prefix+''+suffix
        page = re.sub(r'(value=")'+re.escape(BASE)+r'line(\d{8})\.html(")', select_date, page)
        (output/('results'+day+'.html')).write_text(page)
        available.append(day)
    if available:
        links = ''.join('<li><a href="'+BASE+'results'+day+'.html">'+day[:4]+'/'+day[4:6]+'/'+day[6:]+'</a></li>' for day in reversed(available))
        page = '''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全結果</title><body><p id="status">全結果を開くにゃ…</p><ul>'''+links+'''</ul><script>
const dates='''+json.dumps(available)+''';
const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10).replaceAll('-','');
const requested=new URLSearchParams(location.search).get('date')||today;
if(dates.includes(requested))location.replace('''+json.dumps(BASE)+'''+ 'results'+requested+'.html');
else document.getElementById('status').textContent='この日の出走表はまだ公開されていないにゃ！';
</script></body></html>'''
        (output/'results.html').write_text(page)
    return {'date_pages':available,'today_href':BASE+'results.html','database_writes':0}
