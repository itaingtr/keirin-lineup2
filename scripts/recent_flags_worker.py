"""Collect shared previous-two-meeting SHB without delaying daily cards."""
import argparse,json,os
from pathlib import Path
from export_pages import page_date
from previous_daily import load_daily
from published_card import read_published
from recent_flags import collect,apply,encode
from rider_history_worker import request_refresh

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=('request','collect','apply'))
    parser.add_argument('--site',type=Path,default=Path('site'))
    parser.add_argument('--output',type=Path)
    parser.add_argument('--input',type=Path)
    args=parser.parse_args()
    if args.mode=='request':request_refresh(workflow='recent-flags.yml');return
    if args.mode=='apply':
        batch=json.loads(args.input.read_text());apply(args.site,batch);return
    card,_,_=read_published('FETCH_HEAD')
    data=load_daily(args.site,page_date(card['html']),card['html'])
    if data is None:raise ValueError('Checked recent-meeting display is missing')
    batch=collect(data,args.site,os.environ.get('RECENT_FLAGS_CHECKPOINT_DIR'))
    args.output.write_text(encode(batch))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as handle:
            handle.write('refresh='+str(bool(batch['records'])).lower()+'\n')
            handle.write('source_failed='+str(bool(batch['errors'])).lower()+'\n')
    print('RECENT SHB BATCH READY',len(batch['records']),'verified races;',len(batch['errors']),'source failures',flush=True)

if __name__=='__main__':main()
