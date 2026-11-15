"""Compact, date-bound card headings and mirrored navigation; display only."""
from datetime import datetime, timedelta
import hashlib
import html
from pathlib import Path
import re

from published_card import parse_page
from venues import identity

BASE = '/keirin-lineup2/'
CUTOVER = '20261115'
MARKER = 'compact-20261115'
ASSETS = ('compact-navigation.css', 'compact-navigation.js')


def _quick_links():
    return ''.join('<a class="refresh-button '+kind+'" href="'+BASE+path+'">'+label+'</a>'
                   for kind,path,label in [('home-button','','トップ'),
                                           ('calendar-button','calendar/index.html','日程'),
                                           ('results-button','daily-results/index.html','全選手成績')])


def _day_link(day, offset, available, all_results):
    target = (datetime.strptime(day, '%Y%m%d').date()+timedelta(days=offset)).strftime('%Y%m%d')
    label, kind = ('昨日','yesterday-button') if offset < 0 else ('翌日','tomorrow-button')
    classes = 'refresh-button '+kind
    if target not in available:
        return '<button type="button" class="'+classes+'" disabled aria-label="'+label+'の出走表は未公開">'+label+'</button>'
    href = BASE+('results' if all_results else 'line')+target+'.html'
    return '<a class="'+classes+'" href="'+href+'">'+label+'</a>'


def apply(page, site, output, day, available, *, all_results=False):
    if not all_results and day < CUTOVER:
        return page
    if 'data-card-header=' in page:
        raise ValueError('Compact card navigation already applied')
    if day not in available:
        raise ValueError('Displayed card is not in the published dates')
    races = parse_page(page)
    if {identity(row['source'])['date'] for row in races} != {day}:
        raise ValueError('Compact card date differs')
    date = datetime.strptime(day, '%Y%m%d').date()
    label = f'{date.month}月{date.day}日'
    title = f'{label} 全{len(races)}レース・{sum(len(row["players"]) for row in races)}人'
    options = []
    for value in sorted(available, reverse=True):
        item = datetime.strptime(value, '%Y%m%d').date()
        href = BASE+('results' if all_results else 'line')+value+'.html'
        options.append('<option value="'+href+'"'+(' selected' if value==day else '')+'>'+str(item.month)+'月'+str(item.day)+'日</option>')
    controls = '<select id="date-select" aria-label="日付を選択">'+''.join(options)+'</select>'
    controls += _day_link(day,-1,available,all_results)+_day_link(day,1,available,all_results)
    controls += '<button type="button" class="refresh-button reload-button" onclick="location.reload()" aria-label="ページを更新">更新</button>'
    nav = '<section class="compact-navigation" aria-label="ページ上部のメニュー"><div class="compact-date-row">'+controls+'</div>'
    nav += '<nav class="compact-quick-row" aria-label="基本メニュー">'+_quick_links()+'</nav>'
    nav += '<nav id="venue-nav" class="venue-navigation compact-venues" aria-label="開催競輪場と全結果"></nav></section>'
    page, count = re.subn(r'<header\b[^>]*>[\s\S]*?</header>',
                         '<header class="compact-card-heading"><h1>'+html.escape(title)+'</h1></header>',page,count=1)
    if count != 1:
        raise ValueError('Card heading is missing')
    page, count = re.subn(r'<div class="tools">[\s\S]*?</div>\s*<nav\b[^>]*\bid="venue-nav"[^>]*>[\s\S]*?</nav>',nav,page,count=1)
    if count != 1:
        raise ValueError('Card navigation is missing')
    page = re.sub(r'<title>[\s\S]*?</title>','<title>'+html.escape(title)+'</title>',page,count=1)
    # Remove the superseded prose; search, shared comments and status messages remain available.
    page = re.sub(r'<footer\b[^>]*>[\s\S]*?</footer>','',page,count=1)
    page = re.sub(r'<p class="notice">[\s\S]*?</p>','',page,count=1)
    footer = '<section class="compact-page-footer" aria-label="ページ下部のメニュー"><nav class="compact-quick-row" aria-label="基本メニュー">'+_quick_links()+'</nav>'
    footer += '<nav id="venue-nav-bottom" class="venue-navigation compact-venues" aria-label="開催競輪場と全結果"></nav></section>'
    if page.count('</main>') != 1:
        raise ValueError('Card main container differs')
    page = page.replace('</main>',footer+'</main>',1)
    page = page.replace('<body','<body data-card-header="'+MARKER+'"',1)
    for name in ASSETS:
        content = (Path(site)/name).read_bytes()
        (Path(output)/name).write_bytes(content)
        url = BASE+name+'?v='+hashlib.sha256(content).hexdigest()[:12]
        if name.endswith('.css'):
            page = page.replace('</head>','<link rel="stylesheet" href="'+url+'"></head>',1)
        else:
            page = page.replace('</body>','<script src="'+url+'"></script></body>',1)
    return page


def export_navigation(site, output, dates, current_day):
    output = Path(output)
    result_dates = [day for day in dates if (output/('results'+day+'.html')).is_file()]
    paths = [('index.html',current_day,False)]
    paths += [('line'+day+'.html',day,False) for day in dates if day >= CUTOVER]
    paths += [('results'+day+'.html',day,True) for day in result_dates]
    changed = []
    for name,day,all_results in paths:
        before = (output/name).read_text()
        after = apply(before,site,output,day,result_dates if all_results else dates,all_results=all_results)
        if after != before:
            (output/name).write_text(after)
            changed.append(name)
    if (output/'index.html').read_bytes() != (output/('line'+current_day+'.html')).read_bytes():
        raise ValueError('Compact root/date navigation differs')
    return {'layout':MARKER,'pages':changed,'database_writes':0}
