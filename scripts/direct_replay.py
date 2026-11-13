"""Plain links to the MP4 used by the official Rakuten digest player.

Only exported presentation changes. Saved source URLs and archived readers
stay intact; there is no site-owned media element or playback controller.
"""
import re

CUTOVER = '20261113'

# Rakuten's actual <source> format, independently checked across all grades.
# This function only computes an anchor's destination; it never loads media.
URL_FUNCTION = '''function replayMp4Url(value){
 const url=new URL(value,document.baseURI),q=url.searchParams;
 if(!['keirin.kdreams.jp','my.keirin.kdreams.jp'].includes(url.hostname)||url.pathname!=='/stadium/digest/')return value;
 const code=q.get('kyogijoCd'),date=q.get('kaisaiDate'),grade=q.get('gradeCd'),race=q.get('raceNo');
 if(!/^\\d{2}$/.test(code||'')||!/^\\d{8}$/.test(date||'')||!/^[1-6]$/.test(grade||'')||!/^\\d{1,4}$/.test(race||'')||+race<1||+race>12)throw new Error('Invalid verified replay identity');
 return 'https://wm.st.keirin.jp/wm-keirin'+code+'/'+date+'-'+code+'-'+grade.padStart(2,'0')+'-'+String(+race).padStart(2,'0')+'-01-00.mp4';
}
'''


def apply(page, day):
    if day < CUTOVER:
        return page
    if 'data-replay-links=' in page:
        raise ValueError('Direct replay links already applied')
    page = re.sub(r'<body\b', '<body data-replay-links="mp4"', page, count=1)
    old = "return 'https://my.keirin.kdreams.jp/stadium/digest/?'+query.toString();"
    if page.count(old) != 1:
        raise ValueError('Replay URL renderer differs')
    page = page.replace(old, "return replayMp4Url('https://my.keirin.kdreams.jp/stadium/digest/?'+query.toString());", 1)
    # Remove the complete former popup handler, including its nested branch.
    page, count = re.subn(r'^function openVideo\(event,url\)\{[^\n]*\}\n', lambda _: URL_FUNCTION, page, count=1, flags=re.M)
    if count != 1:
        raise ValueError('Legacy replay popup handler differs')
    old = 'target="_blank" rel="noopener" onclick="return openVideo(event,this.href)"'
    if page.count(old) != 2:
        raise ValueError('Replay anchor renderers differ')
    page = page.replace(old, 'target="_self"')
    page = page.replace('PCは750×470の別ウィンドウ、スマートフォンは同じ画面で表示します。',
                        '映像と着順のリンクは楽天で使われているMP4動画を同じタブで直接開きます。')
    page = page.replace('PCは別ウィンドウ、スマートフォンは同じ画面でKドリームスの映像ページを開きます',
                        '楽天で使われているMP4動画を直接開きます')
    return page


def history_asset(name, content, day):
    """Export a direct-link reader separately, preserving old reader bytes."""
    if day < CUTOVER or name not in ('previous-meetings.js', 'ten-meetings.js'):
        return name, content
    script = content.decode()
    if name == 'previous-meetings.js':
        old = 'order.href = result.link.url;'
        new = 'order.href = result.link.video ? window.replayMp4Url(result.link.url) : result.link.url;'
        handler = '''      if (result.link.video) order.addEventListener('click', event => {
        if (typeof window.openVideo === 'function') window.openVideo(event, order.href);
      });
'''
    else:
        old = "rank.href = result.link;rank.target = '_self';"
        new = "rank.href = window.replayMp4Url(result.link);rank.target = '_self';"
        handler = "      rank.addEventListener('click',event => { if (typeof window.openVideo === 'function') window.openVideo(event,rank.href); });\n"
    if script.count(old) != 1 or script.count(handler) != 1:
        raise ValueError('Historical replay renderer differs: ' + name)
    script = script.replace(old, new, 1).replace(handler, '', 1)
    return name.replace('.js', '-mp4.js'), script.encode()
