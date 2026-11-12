"""Refresh only riders whose new meeting has not been checked yet."""
import argparse,json,os
from pathlib import Path
from urllib.request import Request,urlopen

from published_card import read_published
from rider_history import refresh_subset,known_histories,apply_official,encode,require
from ten_meetings import collect
from ten_preview import validate

REPOSITORY='itaingtr/keirin-lineup2'

def request_refresh(opener=urlopen):
    require(os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'Wrong history-refresh repository')
    base='https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/rider-history.yml'
    headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'Accept':'application/vnd.github+json',
             'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'}
    with opener(Request(base+'/runs?per_page=20',headers=headers),timeout=30) as response:
        runs=json.load(response).get('workflow_runs',[])
    if any(row.get('status') in ('in_progress','queued','waiting','pending','requested') for row in runs):
        print('SHARED HISTORY REFRESH already active',flush=True);return False
    with opener(Request(base+'/dispatches',data=b'{"ref":"main","inputs":{}}',headers=headers,method='POST'),timeout=30) as response:
        require(response.status==204,'Shared history refresh was not accepted')
    print('SHARED HISTORY REFRESH queued',flush=True);return True

def collect_batch(site,card,races):
    selected=refresh_subset(site,races)
    if not selected:
        print('SHARED HISTORY REFRESH no missing meeting contexts; source_reads=0',flush=True)
        return {'data':None,'races':[]}
    known=known_histories(site,selected)
    data=collect(selected,card['target_date'],known=known)
    page='const races='+json.dumps(selected,ensure_ascii=False,separators=(',',':'))+';\nconst body='
    validate(data,page)
    return {'data':data,'races':selected}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=('request','collect','apply'))
    parser.add_argument('--site',type=Path,default=Path('site'))
    parser.add_argument('--output',type=Path)
    parser.add_argument('--input',type=Path)
    args=parser.parse_args()
    if args.mode=='request':request_refresh();return
    if args.mode=='collect':
        card,races,_=read_published('FETCH_HEAD')
        data=collect_batch(args.site,card,races);args.output.write_text(encode(data))
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'],'a') as handle:handle.write('refresh='+str(data['data'] is not None).lower()+'\n')
    else:
        batch=json.loads(args.input.read_text())
        if batch['data'] is not None:apply_official(args.site,batch['data'],batch['races'])

if __name__=='__main__':main()
