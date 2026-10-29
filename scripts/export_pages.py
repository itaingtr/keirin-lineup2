"""Export verified cards as public, flat GitHub Pages files."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import re
from published_card import parse_page
from venues import identity
from rakuten_marks import CUTOVER, validate_marks
from render_races import script_json

BASE='/keirin-lineup2/'
REPOSITORY='itaingtr/keirin-lineup2'
SHARED=('comments.css','comments.js','predictions.js','odds-current.js','odds-comparison.js','odds-current-rakuten.js')
TOP_BUTTON=f'''<button type="button" class="refresh-button home-button" onclick="location.href='{BASE}'" aria-label="トップページへ">トップ</button>'''
MOBILE_STYLE='''<style id="mobile-readability-style">
@media(max-width:640px){
html{overflow-x:auto}
body{width:calc(100vw / 1.2544);zoom:1.2544;overflow:visible}
.table-wrap{overflow:visible;overscroll-behavior-x:auto}
.table-wrap .odds-content{overflow:visible}
.table-wrap tbody tr{grid-template-columns:38px max(218px,calc(100vw / 1.2544 - 75px)) minmax(0,1fr)}
.table-wrap td.race{justify-self:stretch;width:100%;min-width:0;gap:6px}
.table-wrap .video-actions{margin-left:auto}
}
</style>'''


def page_date(page):
    days={identity(race['source'])['date'] for race in parse_page(page)}
    if len(days)!=1:
        raise ValueError('Mixed race dates')
    return days.pop()


def history_video_links(page):
    old_function = "function meetingResultUrl(result){const url=new URL(result.result_url);url.searchParams.set('playerIds',result.player_id);return url.href;}"
    new_function = "function meetingVideoUrl(result,r){return videoUrl({...r,meetingDay:result.meeting_day,race:result.race_number});}"
    if old_function not in page and new_function not in page:
        raise ValueError("Previous-race link renderer is missing")
    page = page.replace(old_function, new_function)
    page = page.replace('meetingResultUrl(result)', 'meetingVideoUrl(result,r)')
    page = page.replace("target=\"_self\" title=\"'+escapeHtml(description)+'\" aria-label=\"'+escapeHtml(p.name+' '+description+'の競走成績を開く')+'\"", "target=\"_blank\" rel=\"noopener\" onclick=\"return openVideo(event,this.href)\" title=\"'+escapeHtml(description+'の楽天レース動画を開きます')+'\" aria-label=\"'+escapeHtml(p.name+' '+description+'の楽天レース動画を開く')+'\"")
    page = page.replace("着順を押すと同じタブで公式の競走成績を開き、対象選手の背景を緑にします。", "着順を押すと、その日の該当レースの楽天Kドリームス動画を開きます。")
    return page.replace('着順・ライブは同じタブで公式ページを開きます。', 'ライブは同じタブで公式ページを開きます。')


def rakuten_page(page, day, marks):
    races=parse_page(page)
    target=day[:4]+'-'+day[4:6]+'-'+day[6:]
    validate_marks(marks,races,target)
    records={r['source_url']:{p['no']:p['mark'] for p in r['players']} for r in marks['races']}
    for race in races:
        for player in race['players']:
            player['mark']=records[race['source']][player['no']]
    page=re.sub(r'const races=(.*);\nconst body=',lambda m:'const races='+script_json(races)+';\nconst body=',page,count=1)
    page=page.replace('function liveUrl(r)',"function rakutenRaceUrl(r){return 'https://my.keirin.kdreams.jp'+r.commentKey;}\nfunction liveUrl(r)",1)
    old='''href="'+r.source+'" data-comment-key="'''
    new='''href="'+rakutenRaceUrl(r)+'" data-race-source="'+r.source+'" data-comment-key="'''
    if page.count(old)!=1:raise ValueError('Race link renderer is missing')
    page=page.replace(old,new,1)
    page=page.replace('<span class="prediction-mark">','<span class="prediction-mark" title="楽天Kドリームスの予想印">')
    page=re.sub(r'<script src="[^"]*/predictions\.js[^"]*" defer></script>','',page,count=1)
    page=page.replace('/odds-current.js','/odds-current-rakuten.js')
    page=page.replace('予想印はウィンチケットAI予想の上位順（◎・○・▲・△）を表示しています。','予想印は楽天Kドリームスの掲載印を表示しています。')
    page=page.replace('並び予想とライン構成はウィンチケットの各レース詳細を反映しています。','並び予想とライン構成は各レース詳細を反映しています。')
    page=page.replace('選手成績はウィンチケット掲載の直近4か月の値です。','選手成績は直近4か月の値です。')
    return page,races


def public_html(page,day,marks=None):
    if page_date(page)!=day:
        raise ValueError('Page date mismatch')
    # GitHub Pages has no Worker redirect endpoint. Keep ordinary same-tab links.
    result=re.sub(r'function webUrl\(source\)\{[^}]*\}',
                  'function webUrl(source){return source;}',page,count=1)
    result=re.sub(r'<base href="[^"]*">(?:<script>if\([^<]*?</script>)?',
                  '<base href="'+BASE+'data/'+day+'/">',result,count=1)
    for name in SHARED:
        result=re.sub(r'((?:href|src)=")(?:\./|/)?'+re.escape(name),
                      lambda match:match[1]+BASE+name,result)
    result=re.sub(r'value="(?:\./|/)?(?:line)?(\d{8})\.html/?"',
                  lambda match:'value="'+BASE+'line'+match[1]+'.html"',result)
    if day>='20261025':
        result=re.sub(r'(<button[^>]*class="refresh-button"[^>]*>更新</button>)',
                      lambda match:match[1]+TOP_BUTTON,result,count=1)
        # 1.12 * 1.12: enlarge the layout without pre-zooming Safari's visual
        # viewport. One document scroller lets pinching and horizontal panning
        # use the same scroll range instead of competing nested containers.
        result=re.sub(r'(name="viewport" content="width=device-width,initial-scale=)[\d.]+',
                      r'\g<1>1',result,count=1)
        result=result.replace('</head>',MOBILE_STYLE+'</head>',1)
    if day>='20261029':
        result=history_video_links(result)
    expected=parse_page(page)
    if day>=CUTOVER:
        result,expected=rakuten_page(result,day,marks)
    if parse_page(result)!=expected or '/open-web?' in result:
        raise ValueError('Do not alter race data or retain server-only links')
    return result


def materialize_card(card,site):
    day=card['target_date'].replace('-','');site=Path(site)
    if page_date(card['html'])!=day:
        raise ValueError('Saved card date mismatch')
    current=site/'index.html'
    if current.exists() and page_date(current.read_text())>day:
        raise ValueError('Refusing to regress the public top page')
    dated=site/('line'+day+'.html');dated.mkdir(parents=True,exist_ok=True)
    current.write_text(card['html']);(dated/'index.html').write_text(card['html'])
    for name,body in card['assets'].items():
        if name not in ('media.json','odds.json','odds-config.json','rakuten-marks.json'):
            raise ValueError('Unexpected display asset')
        (dated/name).write_text(body)


def export(site,output,repository=REPOSITORY):
    site,output=Path(site),Path(output)
    output.mkdir(parents=True,exist_ok=True)
    for name in SHARED:
        if name=='odds-current-rakuten.js':
            script=(site/'odds-current.js').read_text()
            if 'new URL(link.href).pathname' not in script:raise ValueError('Odds race identity reader is missing')
            (output/name).write_text(script.replace('new URL(link.href).pathname','new URL(link.dataset.raceSource || link.href).pathname'))
        else:
            (output/name).write_bytes((site/name).read_bytes())
    current=(site/'index.html').read_text();current_day=page_date(current)
    dates=[]
    for directory in sorted(site.iterdir()):
        match=re.fullmatch(r'line(\d{8})\.html',directory.name)
        if not match or not (directory/'index.html').is_file():continue
        day=match[1];dates.append(day)
        page=(directory/'index.html').read_text()
        marks=json.loads((directory/'rakuten-marks.json').read_text()) if day>=CUTOVER else None
        (output/('line'+day+'.html')).write_text(public_html(page,day,marks))
        assets=output/'data'/day;assets.mkdir(parents=True,exist_ok=True)
        for file in directory.glob('*.json'):
            # These are existing public display fields, never raw source backups.
            (assets/file.name).write_bytes(file.read_bytes())
        if day>='20261025':
            endpoint='https://raw.githubusercontent.com/'+repository+'/odds-diagnostics/fallback/exacta/'+day+'/latest.json'
            (assets/'odds-config.json').write_text(json.dumps({'endpoint':endpoint},separators=(',',':')))
    if current_day not in dates:raise ValueError('Current dated page is missing')
    marks=json.loads((site/('line'+current_day+'.html')/'rakuten-marks.json').read_text()) if current_day>=CUTOVER else None
    page=public_html(current,current_day,marks)
    (output/'index.html').write_text(page)
    if (output/('line'+current_day+'.html')).read_text()!=page:
        raise ValueError('Root and current date page must be identical')
    (output/'.nojekyll').write_text('')
    races=parse_page(page)
    return {'target_date':current_day[:4]+'-'+current_day[4:6]+'-'+current_day[6:],
            'dates':dates,'races':len(races),'riders':sum(len(r['players']) for r in races),
            'base_url':'https://itaingtr.github.io'+BASE,'database_writes':0}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site',type=Path,default=Path('site'))
    parser.add_argument('--output',type=Path,default=Path('public'))
    args=parser.parse_args();print(json.dumps(export(args.site,args.output),ensure_ascii=False))
