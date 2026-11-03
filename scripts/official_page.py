"""Compact verified S/H/B meeting results without changing lineup geometry."""
import re


OFFICIAL_RESULTS_STYLE = '''<style id="official-results-style">
body[data-official-results="true"] .meeting-order-line{width:22px;justify-content:flex-start;gap:0;white-space:nowrap}
body[data-official-results="true"] .meeting-order-line .meeting-order{flex:0 0 auto;justify-content:flex-start;gap:0;min-width:0;width:auto;margin:0;padding:0}
body[data-official-results="true"] .meeting-order-line .meeting-rank:not(.meeting-rank-circle):not(.meeting-rank-solid){min-width:0;width:auto;margin:0;padding:0}
body[data-official-results="true"] .meeting-order-line .meeting-back{margin:0;padding:0}
body[data-official-results="true"] .meeting-order-line .condition-history{flex:0 0 auto;min-width:0;margin:0;padding:0}
</style>'''


def official_page(page):
    """Apply only to a new, validated official-provider page after rider_features.

    ``start``, ``home`` and ``back`` are independent verified source booleans.
    Missing flags are not inferred from one another.  The existing condition
    span remains immediately after the result link and retains its red style.
    """
    s = '''<span class="recent-s">'+p.stats[0]+'</span>'''
    back = '''(result.back?'<span class="meeting-back" aria-label="B取得">B</span>':'')'''
    description = "(result.back?' B取得':'')"
    expected = (s, back, description, '</head>')
    if any(page.count(fragment) != 1 for fragment in expected):
        raise ValueError('Official result renderer differs')
    if len(re.findall(r'<body\b[^>]*>', page)) != 1 or 'official-results-style' in page:
        raise ValueError('Official result page wrapper differs')
    page = page.replace(s, '''<span class="recent-s">'+(p.stats[0]===0?'':p.stats[0])+'</span>''', 1)
    flags = '''(result.start?'<span class="meeting-back meeting-start" aria-label="S取得">S</span>':'')+(result.home?'<span class="meeting-back meeting-home" aria-label="H取得">H</span>':'')+(result.back?'<span class="meeting-back" aria-label="B取得">B</span>':'')'''
    page = page.replace(back, flags, 1)
    page = page.replace(description, "(result.start?' S取得':'')+(result.home?' H取得':'')+(result.back?' B取得':'')", 1)
    # Keep an official withdrawal visible without moving the rider or changing
    # the source prediction mark stored in the dataset.
    page = page.replace("return '<div class=\"rider\">", "return '<div class=\"rider'+(p.absent?' rider-absent':'')+'\">", 1)
    page = page.replace("title=\"楽天Kドリームスの予想印\">'+p.mark+", "title=\"'+(p.absent?'楽天Kドリームス掲載の欠場':'楽天Kドリームスの予想印')+'\">'+(p.absent?'欠':p.mark)+", 1)
    page = re.sub(r'<body\b', '<body data-official-results="true"', page, count=1)
    page = page.replace('Sの数値は印の上、選手名の下は期別、B、逃、捲、差、マの順で表示しています。', '選手名の下は期別、S、B、逃、捲、差、マの順です。Sが0のときは空欄です。')
    page = page.replace('（Bはバック取得）', '（S・H・Bは取得元で確認できたフラグ）')
    return page.replace('</head>', OFFICIAL_RESULTS_STYLE + '</head>', 1)
