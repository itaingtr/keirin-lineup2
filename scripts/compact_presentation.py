"""Scoped compact history and S-count presentation from November13."""
import re

CUTOVER='20261113'
MARKER='compact-20261113'
STYLE='''<style id="compact-history-style">
body[data-history-layout="compact-20261113"] .table-wrap .contest-pair::before,
body[data-history-layout="compact-20261113"] .table-wrap .contest-pair::after{top:39px}
body[data-history-layout="compact-20261113"] .table-wrap .lineup-odds-visible .contest-pair::before,
body[data-history-layout="compact-20261113"] .table-wrap .lineup-odds-visible .contest-pair::after{top:74px}
body[data-history-layout="compact-20261113"] .lineup .meeting-rank,
body[data-history-layout="compact-20261113"] .lineup .previous-rank{font-size:8px}
body[data-history-layout="compact-20261113"] .lineup .previous-heading{font-size:5.5px;height:6px;line-height:6px}
</style>'''

def apply(page,day):
    if day<CUTOVER:return page
    if 'data-history-layout=' in page:raise ValueError('Compact history layout already applied')
    count='''<span class="recent-s">'+(p.stats[0]===0?'':p.stats[0])+'</span>'''
    car='<button type="button" class="car condition-car'
    if page.count(count)!=1 or page.count(car)!=1:raise ValueError('Compact S-position renderer differs')
    page=page.replace(count,'',1).replace(car,count+car,1)
    page=re.sub(r'<body\b','<body data-history-layout="'+MARKER+'"',page,count=1)
    page=page.replace('選手名の下は期別、S、B、逃、捲、差、マの順です。',
                      'Sは競走得点と車番の間です。選手名の下は期別、B、逃、捲、差、マの順です。')
    return page.replace('</head>',STYLE+'</head>',1)
