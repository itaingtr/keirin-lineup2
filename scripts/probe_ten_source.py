"""Read-only discovery of public official rider-history display fields."""
import json,re
from pathlib import Path
from urllib.request import build_opener,HTTPCookieProcessor,Request
from http.cookiejar import CookieJar
from urllib.parse import urljoin,urlsplit,urlencode
from source_http import Document,cells

def main():
    opener=build_opener(HTTPCookieProcessor(CookieJar()))
    def read(url,data=None):
        assert urlsplit(url).hostname in ('keirin.jp','www.keirin.jp')
        with opener.open(Request(url,data=data,headers={'User-Agent':'KeirinLineup2/1.0'}),timeout=25) as r:
            assert urlsplit(r.url).hostname in ('keirin.jp','www.keirin.jp')
            return r.read(3000000).decode(r.headers.get_content_charset() or 'utf-8')
    def clean(value):
        if isinstance(value,dict):return {k:('[navigation omitted]' if re.search(r'enc|token|session|cookie|password|csrf',k,re.I) else clean(v)) for k,v in value.items()}
        if isinstance(value,list):return [clean(v) for v in value]
        return value
    def display_node(node):
        value={'tag':node.tag,'text':node.visible_text().strip()[:100]}
        for key in ('class','title','style','value','alt','width','height','role','aria-label'):
            if key in node.attrs:value[key]=node.attrs[key]
        for attr,event in node.attrs.items():
            if not attr.startswith('on'):continue
            name=re.match(r'(?:return\s+)?([A-Za-z_.$][\w.$]*)\s*\(',event)
            numbers=re.findall(r"(?<![A-Za-z0-9])[0-9]{1,14}(?![A-Za-z0-9])",event)
            value[attr]={'function':name[1] if name else '[navigation omitted]',
                         'numbers':numbers}
        return value
    report={}
    read('https://keirin.jp/pc/top')
    for url in ('https://keirin.jp/pc/racerprofile?snum=015097',):
        try:
            page=read(url);entry={'scripts':re.findall(r'<script[^>]+src=[\"\']([^\"\']+)',page)}
            entry['embedded']={}
            for match in re.finditer(r'jsonData\s*\[\s*[\"\']([^\"\']+)[\"\']\s*\]\s*=',page):
                try:entry['embedded'][match[1]]=clean(json.JSONDecoder().raw_decode(page[match.end():].lstrip())[0])
                except ValueError:pass
            entry['snippets']=[clean(x) for x in re.findall(r'.{0,120}(?:racerprofile|JSJ\d+|PC05\d+|直近|過去|出走履歴).{0,160}',page)][:30]
            entry['rank_badges']=[{'title':n.attrs.get('title'),'style':n.attrs.get('style')} for n in Document(page).root.find_all('p') if 'imgbadge_s4' in n.attrs.get('class','').split()]
            entry['tables']=[]
            for table in Document(page).root.find_all('table'):
                if not any(word in table.visible_text() for word in ('直近1','登録番号','期別','氏名')):continue
                rows=[]
                for row in table.find_all('tr'):
                    values=[]
                    for cell in cells(row):
                        links=[]
                        for a in cell.find_all('a'):
                            link={'text':a.visible_text().strip()}
                            href=a.attrs.get('href','')
                            if href.startswith(('/pc/dfw/dataplaza/guest/race','/stadium/digest/')):link['href']=href
                            event=a.attrs.get('onclick','')
                            if event:
                                function=re.match(r'(?:return\s+)?([A-Za-z_.$][\w.$]*)\s*\(',event)
                                link['function']=function[1] if function else '[public navigation omitted]'
                                link['numeric_args']=[value if re.fullmatch(r'\d{1,8}',value) else '[public navigation omitted]'
                                                      for _,value in re.findall(r"(['\"])(.*?)\1",event)]
                                # Only literal public numeric display arguments;
                                # never persist opaque navigation strings.
                                if re.fullmatch(r"[A-Za-z_.]+\([\s'\",0-9]+\);?(?:return false;?)?",event):link['event']=event
                            links.append(link)
                        descendants=[]
                        for tag in ('span','div','a'):
                            for n in cell.find_all(tag):
                                descendants.append({'tag':tag,'text':n.visible_text().strip()[:80],
                                    'class':n.attrs.get('class'),'title':n.attrs.get('title'),'style':n.attrs.get('style'),
                                    'event_numbers':re.findall(r"(?<![A-Za-z0-9])[0-9]{1,14}(?![A-Za-z0-9])",n.attrs.get('onclick','')) if not re.search(r'enc|token|param',n.attrs.get('onclick',''),re.I) else []})
                        scripts=[re.sub(r"(['\"])[^'\"]{30,}\1", "'[navigation omitted]'",s.text())[:1500] for s in cell.find_all('script')]
                        values.append({'text':cell.visible_text().strip(),'cell':display_node(cell),'allnodes':[display_node(n) for n in cell.find_all() if n.tag not in ('script','style')],
                                       'scripts':scripts,'rowspan':cell.attrs.get('rowspan'),'colspan':cell.attrs.get('colspan'),'descendants':descendants,
                                       'images':[{k:i.attrs[k] for k in ('alt','src') if k in i.attrs} for i in cell.find_all('img')],
                                       'display_nodes':[{k:n.attrs[k] for k in ('class','title','style') if k in n.attrs} | {'tag':n.tag,'text':n.visible_text().strip()}
                                                        for n in cell.find_all() if n.tag in ('span','i','a')],
                                       'links':links})
                    if values:rows.append(values)
                entry['tables'].append(rows)
            entry['rbClick_definition']=re.findall(r'function\s+rbClick\s*\([^)]*\)[\s\S]{0,1800}',page)[:1]
            entry['navigation_results']=[]
            doc=Document(page).root
            inputs={n.attrs.get('id'):n.attrs.get('value','') for n in doc.find_all('input')}
            for n in doc.find_all('div'):
                event=n.attrs.get('onclick','')
                if not event.startswith('rbTyokinResultClick'):continue
                args=[v for _,v in re.findall(r"(['\"])(.*?)\1",event)]
                if len(args)!=3:continue
                dest=urljoin(url,inputs.get(args[0],''))
                if urlsplit(dest).hostname not in ('keirin.jp','www.keirin.jp') or '/raceresult' not in urlsplit(dest).path:continue
                response=read(dest,urlencode({'encp':args[1],'disp':args[2]}).encode())
                item={'path':urlsplit(dest).path,'embedded':{}}
                for m in re.finditer(r'jsonData\s*\[\s*[\"\']([^\"\']+)[\"\']\s*\]\s*=',response):
                    try:item['embedded'][m[1]]=clean(json.JSONDecoder().raw_decode(response[m.end():].lstrip())[0])
                    except ValueError:pass
                item['visible']=Document(response).root.visible_text()[-5000:]
                entry['navigation_results'].append(item)
                if len(entry['navigation_results'])==1:break
            entry['static']={}
            entry['profile_functions']={}
            entry['local_functions']=[x[:4000] for x in re.findall(r'function\s+rbClick[\s\S]{0,3000}',page)]
            for path in []:
                full=urljoin(url,path)
                if urlsplit(full).hostname not in ('keirin.jp','www.keirin.jp'):continue
                js=read(full)
                if full.endswith('/PJ0601.js'):
                    entry['profile_functions'][full]=re.findall(r'function\s+rbClick(?:Digest)?\s*\([^)]*\)[\s\S]{0,1800}',js)
                lines=[line[:700] for line in js.splitlines() if re.search(r'JSJ\d+|jsonData|rbClick|tyaku|Tyaku|chakujun|dispChaku|[cC]020|[cC]050|history|History|rireki',line)]
                entry['static'][full]=lines[:150]
            report[url]=entry
            print('OFFICIAL PROFILE',url,'embedded',list(entry['embedded']),'scripts',entry['scripts'],flush=True)
        except Exception as e:report[url]={'error':type(e).__name__+': '+str(e)[:150]}
    Path('/tmp/ten-source-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('OFFICIAL SOURCE REPORT READY',flush=True)
if __name__=='__main__':main()
