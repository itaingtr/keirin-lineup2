"""Read-only discovery of public official rider-history display fields."""
import json,re
from pathlib import Path
from urllib.request import build_opener,HTTPCookieProcessor,Request
from http.cookiejar import CookieJar
from urllib.parse import urljoin,urlsplit

def main():
    opener=build_opener(HTTPCookieProcessor(CookieJar()))
    def read(url):
        assert urlsplit(url).hostname in ('keirin.jp','www.keirin.jp')
        with opener.open(Request(url,headers={'User-Agent':'KeirinLineup2/1.0'}),timeout=25) as r:
            assert urlsplit(r.url).hostname in ('keirin.jp','www.keirin.jp')
            return r.read(3000000).decode(r.headers.get_content_charset() or 'utf-8')
    def clean(value):
        if isinstance(value,dict):return {k:('[navigation omitted]' if re.search(r'enc|token|session|cookie|password|csrf',k,re.I) else clean(v)) for k,v in value.items()}
        if isinstance(value,list):return [clean(v) for v in value]
        return value
    report={}
    read('https://keirin.jp/pc/top')
    for url in ('https://keirin.jp/pc/racerprofile?snum=013497','https://keirin.jp/pc/dfw/dataplaza/guest/membprofile?SNO=013497'):
        try:
            page=read(url);entry={'scripts':re.findall(r'<script[^>]+src=[\"\']([^\"\']+)',page)}
            entry['embedded']={}
            for match in re.finditer(r'jsonData\s*\[\s*[\"\']([^\"\']+)[\"\']\s*\]\s*=',page):
                try:entry['embedded'][match[1]]=clean(json.JSONDecoder().raw_decode(page[match.end():].lstrip())[0])
                except ValueError:pass
            entry['snippets']=[clean(x) for x in re.findall(r'.{0,120}(?:racerprofile|JSJ\d+|PC05\d+|直近|過去|出走履歴).{0,160}',page)][:30]
            entry['static']={}
            for path in entry['scripts'][-8:]:
                full=urljoin(url,path)
                if urlsplit(full).hostname not in ('keirin.jp','www.keirin.jp'):continue
                js=read(full)
                lines=[line[:700] for line in js.splitlines() if re.search(r'JSJ\d+|jsonData|ajax|url:|type:|[cC]020|[cC]050|history|History|rireki',line)]
                entry['static'][full]=lines[:150]
            report[url]=entry
            print('OFFICIAL PROFILE',url,'embedded',list(entry['embedded']),'scripts',entry['scripts'],flush=True)
        except Exception as e:report[url]={'error':type(e).__name__+': '+str(e)[:150]}
    Path('/tmp/ten-source-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('OFFICIAL SOURCE REPORT READY',flush=True)
if __name__=='__main__':main()
