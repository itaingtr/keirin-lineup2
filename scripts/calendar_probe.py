from urllib.request import urlopen, Request
from html.parser import HTMLParser
import json
class Probe(HTMLParser):
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ('form','select','option','script'):
            print(tag,{k:v for k,v in a.items() if k in ('action','value','name','src')})
        if tag in ('tr','th','td','h2','h3'): print('<'+tag+'>',a)
        if tag=='img':print('IMG',a)
    def handle_endtag(self,tag):
        if tag in ('tr','th','td'):print('</'+tag+'>')
    def handle_data(self,data):
        t=data.strip()
        if t and not any(s in t for s in ('function','var ','CDATA','document.')):print('TXT',t[:300])
for p in ['/sp/raceschedule','/pc/graderaceschedule?scyy=2027']:
    print('PAGE',p)
    with urlopen(Request('https://keirin.jp'+p,headers={'User-Agent':'Mozilla/5.0'}),timeout=40) as r:
        html=r.read().decode('utf-8')
    Probe().feed(html)
