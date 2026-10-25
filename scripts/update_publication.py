"""Unattended collection, immutable feed publication and static page preparation."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.request import Request,urlopen
from export_pages import export,materialize_card,page_date
from published_card import git_read,read_published
from refresh_exacta import valid_saved

ROOT=Path(__file__).resolve().parents[1]


def git(*args,cwd=ROOT):
    return subprocess.check_output(['git',*args],cwd=cwd,text=True).strip()


def verify_public(repository,commit,files):
    for path,expected in files:
        for attempt in range(5):
            try:
                url=f'https://raw.githubusercontent.com/{repository}/{commit}/{path}?verify={attempt}'
                with urlopen(Request(url,headers={'Accept':'application/json','Cache-Control':'no-cache'}),timeout=20) as response:
                    if response.status!=200 or response.headers.get('Access-Control-Allow-Origin')!='*':
                        raise ValueError('Public saved feed or CORS unavailable')
                    if response.read()!=expected:raise ValueError('Saved public data differs')
                break
            except Exception:
                if attempt==4:raise
                time.sleep(3)


def publish_feed(output,ref,work,repository):
    checkout=work/'feed';git('worktree','add','--detach',str(checkout),ref)
    files=[]
    for file in sorted((output/'fallback').rglob('*.json')):
        relative=file.relative_to(output);destination=checkout/relative
        if 'runs' in relative.parts and destination.exists():
            raise ValueError('Immutable display run already exists')
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_bytes(file.read_bytes());files.append((relative.as_posix(),file.read_bytes()))
    git('add','--','fallback',cwd=checkout)
    git('commit','-m','Append verified independent display data',cwd=checkout)
    git('push','origin','HEAD:odds-diagnostics',cwd=checkout)
    commit=git('rev-parse','HEAD',cwd=checkout)
    if git('ls-remote','origin','refs/heads/odds-diagnostics').split()[0]!=commit:
        raise ValueError('Feed branch head differs from the published commit')
    verify_public(repository,commit,files)
    return commit


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event',required=True);parser.add_argument('--schedule',default='')
    parser.add_argument('--mode',choices=('publish','cards','odds'),default='publish')
    parser.add_argument('--date',default='');parser.add_argument('--run-key',required=True)
    parser.add_argument('--work',type=Path,required=True)
    args=parser.parse_args();args.work.mkdir(parents=True,exist_ok=True)
    repository=os.environ.get('GITHUB_REPOSITORY','itaingtr/keirin-lineup2')
    if repository!='itaingtr/keirin-lineup2':raise ValueError('Wrong publication repository')
    if not re.fullmatch(r'run-\d+-\d+',args.run_key):raise ValueError('Invalid run key')
    mode=args.mode
    if args.event=='schedule':
        if args.schedule=='0 0-11 * * *':mode='odds'
        elif args.schedule in ('0 12 * * *','30 14 * * *'):mode='cards'
        else:raise ValueError('Unknown schedule')
    if args.event=='push':mode='publish'
    git('config','user.name','github-actions[bot]')
    git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
    git('fetch','origin','odds-diagnostics');ref=git('rev-parse','FETCH_HEAD')
    saved=read_published(ref)
    if saved is None:raise ValueError('Verified initial card is missing')
    card,races,target=saved
    output=args.work/'update';publish_pages=mode!='odds';feed_commit=None
    if mode in ('cards','odds'):
        command=['python3','-u',str(ROOT/'scripts'/('prepare_next_card.py' if mode=='cards' else 'refresh_exacta.py')),
                 '--previous-ref',ref,'--output',str(output),'--run-key',args.run_key]
        if mode=='cards':
            command+=['--mode','schedule' if args.event=='schedule' else 'manual','--schedule',args.schedule,'--date',args.date]
        else:command+=['--page',str(ROOT/'site/index.html')]
        subprocess.run(command,cwd=ROOT,check=True)
        report=json.loads((output/'report.json').read_text())
        if report.get('skipped'):
            publish_pages=False
        else:
            if mode=='cards':
                card=json.loads(Path(report['local_payload']).read_text())
                if not report['published']:raise ValueError('Only validated current/future cards can be published')
                target=card['target_date']
            else:
                feed=json.loads(Path(report['local_feed']).read_text())
                known={race['source']:race for race in races}
                for row in feed['results']:
                    snapshot=row.get('snapshot',{})
                    if snapshot.get('status')=='snapshot' and valid_saved(snapshot,known[snapshot['source_url']]) is None:
                        raise ValueError('Display feed does not match the published card')
            feed_commit=publish_feed(output,ref,args.work,repository)
    if publish_pages:
        # A source/layout push for the same day must keep the author's edits.
        # Materialize newly collected cards or recover a newer saved card.
        if mode=='cards' or page_date((ROOT/'site/index.html').read_text())!=target.replace('-',''):
            materialize_card(card,ROOT/'site')
        git('add','--','site')
        if git('status','--porcelain','--','site'):
            git('commit','-m','Update verified public card '+target+' [skip ci]')
            git('push','origin','HEAD:main')
        report=export(ROOT/'site',ROOT/'public',repository)
        raw=git_read(feed_commit or ref,'fallback/exacta/'+target.replace('-','')+'/latest.json',optional=True)
        if raw is None:raw=card['assets']['odds.json'].encode()
        local_odds=args.work/'display-odds.json';local_odds.write_bytes(raw)
        report['local_odds_file']=str(local_odds)
    else:report={'target_date':target,'database_writes':0}
    report.update({'mode':mode,'publish_pages':publish_pages,'feed_commit':feed_commit,
                   'source_commit':git('rev-parse','HEAD')})
    (args.work/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as handle:
            handle.write('publish='+str(publish_pages).lower()+'\n')
    print('PUBLIC UPDATE READY',json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
