"""Refine current/future history presentation without rewriting saved records."""
import hashlib
from pathlib import Path

CUTOVER = '20261116'
MARKER = 'data-history-refinements="20261116"'
ASSETS = ('public-results-reader.js', 'history-refinements.css', 'history-refinements.js',
          'odds-overlay.css', 'odds-overlay.js')
RESULT_READER = 'race-results-refined.js'


def apply(page, site, output, day):
    if day < CUTOVER:
        return page
    if MARKER in page or 'data-race-results="true"' not in page:
        raise ValueError('History refinements need one current result reader')
    site, output = Path(site), Path(output)
    script = (site/'race-results.js').read_text()
    start = script.index('      const settings = await config(), controller = new AbortController();')
    end = script.index('      value.error = false;', start)
    script = script[:start] + '      value.value = validate(await window.keirinPublicResults.read(source),current.get(source));\n' + script[end:]
    content = script.encode()
    (output/RESULT_READER).write_bytes(content)
    version = hashlib.sha256(content).hexdigest()[:12]
    import re
    page, count = re.subn(r'<script src="/keirin-lineup2/race-results\.js\?v=[a-f0-9]+"></script>',
                         '<script src="/keirin-lineup2/'+RESULT_READER+'?v='+version+'"></script>', page)
    if count != 1:
        raise ValueError('History result reader tag differs')
    page = page.replace('<body', '<body '+MARKER+' data-lineup-spacing="readable-20261116" data-odds-overlay="up-20261116"', 1)
    if day >= '20261122':
        page = page.replace('<body ', '<body data-lineup-fit="nine-centered-20261122" data-mobile-layout="compact-20261122" ', 1)
    tags = {}
    for name in ASSETS:
        content = (site/name).read_bytes()
        (output/name).write_bytes(content)
        version = hashlib.sha256(content).hexdigest()[:12]
        tags[name] = '/keirin-lineup2/'+name+'?v='+version
    page = page.replace('</head>', ''.join('<link rel="stylesheet" href="'+tags[name]+'">'
                        for name in ('history-refinements.css', 'odds-overlay.css'))+'</head>', 1)
    if day >= '20261121':
        page = page.replace('</head>', '''<style id="comments-below-input-style">
body[data-history-refinements="20261116"] .table-wrap td.race-comment-cell{display:flex;grid-area:composer}
body[data-history-refinements="20261116"] .table-wrap .race-comment-feed{order:1;margin-left:0}
</style></head>''', 1)
    before = '<script src="/keirin-lineup2/'+RESULT_READER
    page = page.replace(before, '<script src="'+tags['public-results-reader.js']+'"></script>'+before, 1)
    return page.replace('</body>', ''.join('<script src="'+tags[name]+'"></script>'
                        for name in ('history-refinements.js', 'odds-overlay.js'))+'</body>', 1)
