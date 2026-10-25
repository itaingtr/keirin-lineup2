"""Export verified cards as public, flat GitHub Pages files."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import re
from published_card import parse_page
from venues import identity

BASE='/keirin-lineup2/'
REPOSITORY='itaingtr/keirin-lineup2'
SHARED=('comments.css','comments.js','predictions.js','odds-current.js','odds-comparison.js')
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


def public_html(page,day):
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
    if parse_page(result)!=parse_page(page) or '/open-web?' in result:
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
        if name not in ('media.json','odds.json','odds-config.json'):
            raise ValueError('Unexpected display asset')
        (dated/name).write_text(body)


def export(site,output,repository=REPOSITORY):
    site,output=Path(site),Path(output)
    output.mkdir(parents=True,exist_ok=True)
    for name in SHARED:
        (output/name).write_bytes((site/name).read_bytes())
    current=(site/'index.html').read_text();current_day=page_date(current)
    dates=[]
    for directory in sorted(site.iterdir()):
        match=re.fullmatch(r'line(\d{8})\.html',directory.name)
        if not match or not (directory/'index.html').is_file():continue
        day=match[1];dates.append(day)
        page=(directory/'index.html').read_text()
        (output/('line'+day+'.html')).write_text(public_html(page,day))
        assets=output/'data'/day;assets.mkdir(parents=True,exist_ok=True)
        for file in directory.glob('*.json'):
            # These are existing public display fields, never raw source backups.
            (assets/file.name).write_bytes(file.read_bytes())
        if day>='20261025':
            endpoint='https://raw.githubusercontent.com/'+repository+'/odds-diagnostics/fallback/exacta/'+day+'/latest.json'
            (assets/'odds-config.json').write_text(json.dumps({'endpoint':endpoint},separators=(',',':')))
    if current_day not in dates:raise ValueError('Current dated page is missing')
    page=public_html(current,current_day)
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
