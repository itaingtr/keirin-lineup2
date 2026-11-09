"""Replace the old timer with a short, verifiable handoff to production."""
import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from update_heartbeat import REPOSITORY,dispatch_workflow


def api(path,method='GET'):
    request=Request('https://api.github.com/repos/'+REPOSITORY+path,method=method,
                    data=b'' if method=='POST' else None,headers={
                        'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],
                        'Accept':'application/vnd.github+json',
                        'X-GitHub-Api-Version':'2022-11-28'})
    with urlopen(request,timeout=25) as response:
        raw=response.read()
        return json.loads(raw) if raw else None


def main():
    if os.environ.get('GITHUB_REPOSITORY')!=REPOSITORY:raise ValueError('Wrong automation repository')
    deadline=time.monotonic()+90;empty=0
    while time.monotonic()<deadline:
        runs=api('/actions/workflows/heartbeat.yml/runs?per_page=50')['workflow_runs']
        active=[r for r in runs if r['status']!='completed']
        if not active:
            empty+=1
            if empty>=2:break
        else:
            empty=0
            for run in active:
                print('Replace old heartbeat',run['id'],run['status'],flush=True)
                try:api('/actions/runs/'+str(run['id'])+'/cancel','POST')
                except HTTPError as error:
                    if error.code!=409:raise
        time.sleep(3)
    else:raise ValueError('Old heartbeat did not stop; do not start an overlapping timer')
    dispatch_workflow('heartbeat.yml',{'duration_seconds':'90','renew_after_seconds':'30'})
    print('SHORT HANDOFF PROBE STARTED: successor must return to production defaults',flush=True)


if __name__=='__main__':main()
