"""Inspect public Rakuten player configuration without saving media or pages."""
import json,re
from pathlib import Path
from urllib.parse import urljoin,urlsplit,urlunsplit
from urllib.request import Request,urlopen
from source_http import Document
from published_card import parse_page
from venues import identity

def clean_url(url):
    p=urlsplit(url);return urlunsplit((p.scheme,p.netloc,p.path,'',''))

def snippets(text):
    output=[]
    for match in list(re.finditer(r'autoplay|autostart|playsinline|muted|userAgent|location\.search|動画|映像|再生|player|movie',text,re.I))[:35]:
        value=text[max(0,match.start()-90):match.end()+120]
        value=re.sub(r'https?://[^\s\"\'<>]+',lambda m:clean_url(m[0]),value)
        value=re.sub(r'[A-Za-z0-9_+/=-]{40,}','[opaque omitted]',value)
        output.append(value)
    return output

def main():
    from urllib.parse import urlencode
    page=Path('site/index.html').read_text();grades=json.loads(re.search(r'const videoGrades=(.*);\n',page)[1])
    candidates=[]
    for race in parse_page(page):
        ident=identity(race['source']);grade=grades[ident['code']+ident['start']]
        for person in race['players']:
            for result in person.get('meetingResults',[]):
                candidates.append((result['race_date'].replace('-',''),ident['code'],grade,result['race_number']))
    raw,code,grade,number=max(candidates,key=lambda row:row[0])
    url='https://my.keirin.kdreams.jp/stadium/digest/?'+urlencode({'kyogijoCd':code,'kaisaiDate':raw,'gradeCd':grade,'raceNo':number,'l-id':'Highlightreel'})
    report=[]
    for label,agent in [('desktop','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'),
                        ('iphone','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1')]:
        with urlopen(Request(url,headers={'User-Agent':agent}),timeout=30) as response:
            text=response.read(2_000_000).decode('utf-8');final=response.url
        doc=Document(text).root
        scripts=[urljoin(final,n.attrs['src']) for n in doc.find_all('script') if n.attrs.get('src')]
        item={'client':label,'page':clean_url(final),'title':next((n.text() for n in doc.find_all('title')),''),
              'visible_text':re.sub(r'\s+',' ',doc.visible_text())[-4500:],'snippets':snippets(text),
              'media_tags':[{k:n.attrs.get(k) for k in ('autoplay','muted','playsinline','controls')} for n in doc.find_all('video')],
              'frames':[clean_url(urljoin(final,n.attrs.get('src',''))) for n in doc.find_all('iframe')],
              'scripts':[clean_url(s) for s in scripts]}
        details=[]
        for source in scripts:
            p=urlsplit(source)
            if p.scheme!='https' or not (p.hostname.endswith('kdreams.jp') or p.hostname=='kdreams.r10s.jp'):continue
            if not re.search(r'digest|video|player|movie|stadium|common\.js|zipccheck',p.path,re.I):continue
            with urlopen(Request(source,headers={'User-Agent':agent}),timeout=30) as response:
                raw=response.read(2_000_000)
                if raw.startswith(b'\x1f\x8b'):
                    import gzip
                    raw=gzip.decompress(raw)
                script=raw.decode('utf-8')
            details.append({'script':clean_url(source),'snippets':snippets(script)})
        item['player_scripts']=details;report.append(item)
    Path('/tmp/media-autoplay-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('PUBLIC PLAYER CONFIGURATION',json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
