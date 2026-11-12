"""Read the deployed website anonymously and compare its public files."""
import argparse
from datetime import date,timedelta
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin
from urllib.request import Request,urlopen
from export_pages import BASE,page_date,SHARED


def verification_files(site):
    """Public artifacts which must match the checked export before receipt."""
    current=(site/'index.html').read_text();day=page_date(current)
    files=['index.html','line'+day+'.html',*SHARED,'data/'+day+'/media.json','data/'+day+'/odds-config.json']
    if day>='20261030':files.append('data/'+day+'/rakuten-marks.json')
    if day>='20261102':files.append('data/'+day+'/rider-identities.json')
    if (site/'data'/day/'rider-details.json').exists():files.append('data/'+day+'/rider-details.json')
    def include_ten(raw):
        relative='data/'+raw+'/ten-meetings.json'
        files.extend(['ten-meetings.js','ten-meetings.css',relative])
        data=json.loads((site/relative).read_text())
        if data.get('history_storage')=='rider-master':
            files.extend(p['history_ref']['path'] for r in data['races'] for p in r['players'])
    if 'data-ten-meetings="true"' in current:include_ten(day)
    if 'data-previous-meetings="true"' in current:
        if 'data-previous-meetings-src="previous-daily.json"' not in current:
            raise ValueError('Daily previous-meeting data source differs')
        files.extend(['previous-meetings.js','previous-meetings.css',
                      'data/'+day+'/previous-daily.json'])
        # A delayed rollout may finish after the top has advanced overnight.
        # Check the preceding adopted date too, without growing the daily HTTP
        # workload with the entire archive.
        previous=(date(int(day[:4]),int(day[4:6]),int(day[6:]))-timedelta(days=1)).strftime('%Y%m%d')
        earlier=site/('line'+previous+'.html')
        if earlier.exists() and 'data-previous-meetings="true"' in earlier.read_text():
            if page_date(earlier.read_text())!=previous:
                raise ValueError('Previous adopted page date differs')
            files.extend([earlier.name,'data/'+previous+'/previous-daily.json'])
            if 'data-ten-meetings="true"' in earlier.read_text():include_ten(previous)
    if (site/'index2.html').exists():
        preview_day=page_date((site/'index2.html').read_text())
        files.extend(['index2.html','previous-meetings.js','previous-meetings.css',
                      'data/'+preview_day+'/previous-meetings.json'])
        if 'data-ten-meetings="true"' in (site/'index2.html').read_text():
            files.extend(['ten-meetings.js','ten-meetings.css','data/'+preview_day+'/ten-meetings.json'])
    # Calendar files are public build outputs, including the generated daily
    # link index before a separate calendar UI is supplied.
    if (site/'calendar').is_dir():
        files.extend(p.relative_to(site).as_posix() for p in sorted((site/'calendar').rglob('*')) if p.is_file())
    return list(dict.fromkeys(files))


def verify(site,base):
    expected='https://itaingtr.github.io'+BASE
    if base.rstrip('/')+'/'!=expected:raise ValueError('Unexpected public Pages address')
    current=(site/'index.html').read_text();day=page_date(current)
    files=verification_files(site)
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
