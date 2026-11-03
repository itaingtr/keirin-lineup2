"""Read public OddsPark display structure in Actions without saving source HTML."""
import argparse
from datetime import datetime,timedelta
import json,re
from urllib.parse import urlencode,urlsplit
from urllib.request import Request,urlopen
from source_http import Document,Node,cells


def attrs(node):
    selected={k:v for k,v in node.attrs.items() if k in ('class','href','title','alt','rowspan','colspan','onclick')
              or k.startswith(('data-date','data-race','data-jo'))}
    return {k:v[:400] for k,v in selected.items()}


def item(node):
    return {'tag':node.tag,'attrs':attrs(node),'text':node.visible_text().strip()[:600]}


def inspect(url):
    try:
        with urlopen(Request(url,headers={'User-Agent':'KeirinLineup2/1.0'}),timeout=25) as response:
            if urlsplit(response.url).hostname not in ('sp.oddspark.com','www.oddspark.com'):raise ValueError('Unexpected public source redirect')
            raw=response.read(6_000_001)
            if len(raw)>6_000_000:raise ValueError('Source too large')
            page=raw.decode(response.headers.get_content_charset() or 'utf-8')
        doc=Document(page).root
        tables=[]
        for table in doc.find_all('table'):
            rows=list(table.find_all('tr'))
            if not any('SpPlayerDetail' in a.attrs.get('href','') for a in table.find_all('a')) and not any('着順' in r.text() or '今場所' in r.text() for r in rows):continue
            rider_rows=[r for r in rows if any('SpPlayerDetail' in a.attrs.get('href','') for a in r.find_all('a'))]
            sample=rider_rows[:1] if rider_rows else rows[:12]
            tables.append({'attrs':attrs(table),'headers':[item(h) for h in table.find_all('th')][:60],
                           'rows':[[{'cell':item(c),'nodes':[item(n) for n in c.find_all() if n.tag in ('a','img','li','span','div','ul')][:80]} for c in cells(r)] for r in sample]})
        links=[item(a) for a in doc.find_all('a') if any(s in a.attrs.get('href','') for s in ('SpRace','SpPlayerDetail'))][:100]
        lists=[{'list':item(ul),'items':[item(li) for li in ul.children if isinstance(li,Node) and li.tag=='li']} for ul in doc.find_all('ul') if any(t in ul.text() for t in ('SHB','今場所','S級'))][:12]
        print('OFFICIAL SOURCE PROBE '+json.dumps({'url':url,'title':next((n.text() for n in doc.find_all('title')),''),'tables':tables,'links':links,'lists':lists},ensure_ascii=False),flush=True)
    except Exception as error:
        print('OFFICIAL SOURCE PROBE '+json.dumps({'url':url,'error':type(error).__name__+': '+str(error)[:200]},ensure_ascii=False),flush=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('--date',required=True);p.add_argument('--code',required=True);p.add_argument('--race',type=int,required=True);p.add_argument('--desktop',action='store_true')
    a=p.parse_args();previous=(datetime.strptime(a.date,'%Y%m%d')-timedelta(days=1)).strftime('%Y%m%d')
    def url(endpoint,code,day,race=None):return 'https://sp.oddspark.com/keirin/'+endpoint+'?'+urlencode({'joCd':code,'kaisaiBi':day,**({'raceNo':race} if race else {})})
    if a.desktop:
        for route,day in [('RaceList.do',a.date),('RaceKekka.do',previous)]:
            inspect('https://www.oddspark.com/keirin/'+route+'?'+urlencode({'joCode':a.code,'kaisaiBi':day,'raceNo':a.race}))
        return
    for value in [url('SpRaceInfo.do',a.code,a.date,a.race),url('SpRaceList.do',a.code,previous),
                  url('SpRaceInfo.do',a.code,previous,a.race),url('SpRaceResultInfo.do',a.code,previous,a.race),
                  url('SpRaceInfo.do','85','20260913',1)]:inspect(value)


if __name__=='__main__':main()
