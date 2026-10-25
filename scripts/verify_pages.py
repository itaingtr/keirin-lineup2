"""Read the deployed website anonymously and compare its public files."""
import argparse
import hashlib
from pathlib import Path
import re
import time
from urllib.parse import urljoin
from urllib.request import Request,urlopen
from export_pages import BASE,page_date,SHARED


def verify(site,base):
    expected='https://itaingtr.github.io'+BASE
    if base.rstrip('/')+'/'!=expected:raise ValueError('Unexpected public Pages address')
    current=(site/'index.html').read_text();day=page_date(current)
    files=['index.html','line'+day+'.html',*SHARED,'data/'+day+'/media.json','data/'+day+'/odds-config.json']
    # A new deployment can take a short time to reach the public Pages CDN.
    stamp=hashlib.sha256(current.encode()).hexdigest()[:16]
    for attempt in range(12):
        try:
            for path in files:
                url=urljoin(expected,path)+'?verify='+stamp+'-'+str(attempt)
                with urlopen(Request(url,headers={'Cache-Control':'no-cache'}),timeout=20) as response:
                    if response.status!=200 or not response.geturl().startswith(expected):
                        raise ValueError('Public access unexpectedly requires a redirect or login')
                    if response.read()!=(site/path).read_bytes():raise ValueError('Published bytes differ: '+path)
            print('PUBLIC PAGES HTTP PASS',expected,'and line'+day+'.html',len(files),'anonymous HTTP checks',flush=True)
            return
        except Exception:
            if attempt==11:raise
            time.sleep(5)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site',type=Path,required=True);parser.add_argument('--base',required=True)
    args=parser.parse_args();verify(args.site,args.base)
