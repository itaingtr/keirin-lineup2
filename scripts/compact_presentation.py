"""Scoped compact history and S-count presentation from November13."""
import re
from pathlib import Path

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
.mobile-replay{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:12px;border:0;background:#101820;color:#fff;font:16px system-ui,sans-serif;overscroll-behavior:contain}
.mobile-replay[open]{display:flex;flex-direction:column;justify-content:center;gap:14px}
.mobile-replay:not([open]){display:none}
.mobile-replay::backdrop{background:#101820}
.mobile-replay-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mobile-replay-original,.mobile-replay-close,.mobile-replay-fullscreen,.mobile-replay-toggle{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 12px;border:1px solid #dbe2ea;border-radius:7px;background:#fff;color:#155eef;text-decoration:none;font:inherit;cursor:pointer}
.mobile-replay-fullscreen[hidden]{display:none}
.mobile-replay-video{display:block;width:100%;max-height:calc(100dvh - 150px);height:auto;aspect-ratio:16/9;background:#000}
.mobile-replay-video::-webkit-media-controls-start-playback-button{display:none!important;-webkit-appearance:none;opacity:0;pointer-events:none}
.mobile-replay-video::-webkit-media-controls-overlay-play-button{display:none!important;opacity:0;pointer-events:none}
.mobile-replay-controls{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;width:100%}
.mobile-replay-toggle{min-width:82px;font-size:13px}
.mobile-replay-seek{display:block;min-width:0;width:100%;height:40px;margin:0;padding:0;border:0;background:transparent;accent-color:#5fa8ff;touch-action:pan-y}
.mobile-replay-time{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.mobile-replay-status{margin:0;font-size:13px;line-height:1.5;text-align:center}
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
    page=page.replace('</head>',STYLE+'</head>',1)
    script=(Path(__file__).resolve().parents[1]/'site/mobile-replay.js').read_text()
    return page.replace('</body>','<script>'+script+'</script></body>',1)
