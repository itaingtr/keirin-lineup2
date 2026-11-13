"""Inspect public Rakuten player configuration without saving media or pages."""
import json,re
from pathlib import Path
from urllib.parse import urljoin,urlsplit,urlunsplit
from urllib.request import Request,urlopen
from source_http import Document

def clean_url(url):
    p=urlsplit(url);return urlunsplit((p.scheme,p.netloc,p.path,'',''))

def snippets(text):
    output=[]
    for match in list(re.finditer(r'autoplay|autostart|playsinline|muted|userAgent|location\.search',text,re.I))[:35]:
        value=text[max(0,match.start()-90):match.end()+120]
        value=re.sub(r'https?://[^\s\"\'<>]+',lambda m:clean_url(m[0]),value)
        value=re.sub(r'[A-Za-z0-9_+/=-]{40,}','[opaque omitted]',value)
        output.append(value)
    return output

def main():
    url='https://my.keirin.kdreams.jp/stadium/digest/?kyogijoCd=28&kaisaiDate=20261112&gradeCd=2&raceNo=1&l-id=Highlightreel'
    report=[]
    for label,agent in [('desktop','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'),
                        ('iphone','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1')]:
        with urlopen(Request(url,headers={'User-Agent':agent}),timeout=30) as response:
            text=response.read(2_000_000).decode('utf-8');final=response.url
        doc=Document(text).root
        scripts=[urljoin(final,n.attrs['src']) for n in doc.find_all('script') if n.attrs.get('src')]
        item={'client':label,'page':clean_url(final),'snippets':snippets(text),
              'media_tags':[{k:n.attrs.get(k) for k in ('autoplay','muted','playsinline','controls')} for n in doc.find_all('video')],
              'frames':[clean_url(urljoin(final,n.attrs.get('src',''))) for n in doc.find_all('iframe')],
              'scripts':[clean_url(s) for s in scripts]}
        details=[]
        for source in scripts:
            p=urlsplit(source)
            if p.scheme!='https' or not p.hostname.endswith('kdreams.jp'):continue
            if not re.search(r'digest|video|player|movie|stadium',p.path,re.I):continue
            with urlopen(Request(source,headers={'User-Agent':agent}),timeout=30) as response:
                script=response.read(2_000_000).decode('utf-8')
            details.append({'script':clean_url(source),'snippets':snippets(script)})
        item['player_scripts']=details;report.append(item)
    Path('/tmp/media-autoplay-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('PUBLIC PLAYER CONFIGURATION',json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
