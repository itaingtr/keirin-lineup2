"""Record publication only after anonymous verification of the deployed bytes."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path

PREFIX='fallback/publication'


def card_digest(card):
    payload=json.dumps(card,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'
    return hashlib.sha256(payload.encode()).hexdigest()


def artifact_digest(directory):
    root=Path(directory);digest=hashlib.sha256()
    for path in sorted(p for p in root.rglob('*') if p.is_file()):
        digest.update(path.relative_to(root).as_posix().encode()+b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def is_confirmed(receipt,card,*,source_commit=None):
    return (isinstance(receipt,dict) and receipt.get('schema_version')==1
            and receipt.get('http_verified') is True
            and receipt.get('target_date')==card['target_date']
            and receipt.get('card_sha256')==card_digest(card)
            and (source_commit is None or receipt.get('source_commit')==source_commit))


def read_receipt(ref,reader):
    raw=reader(ref,PREFIX+'/current.json',optional=True)
    if raw is None:return None
    try:return json.loads(raw)
    except (ValueError,TypeError):return None


def main():
    from update_publication import git,publish_feed
    from published_card import read_published,git_read
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--site',type=Path,required=True)
    parser.add_argument('--work',type=Path,required=True)
    args=parser.parse_args();report=json.loads(args.report.read_text())
    if artifact_digest(args.site)!=report['artifact_sha256']:
        raise ValueError('Verified publication artifact differs from its report')
    git('fetch','origin','odds-diagnostics');ref=git('rev-parse','FETCH_HEAD')
    card,_,target=read_published(ref)
    if target!=report['target_date'] or card_digest(card)!=report['card_sha256']:
        raise ValueError('Checked card advanced during publication; leave it unconfirmed')
    run_key=report['run_key'];path=PREFIX+'/'+target.replace('-','')+'/runs/'+run_key+'.json'
    if git_read(ref,path,optional=True) is not None:raise ValueError('Immutable publication receipt already exists')
    receipt={'schema_version':1,'http_verified':True,'target_date':target,
             'card_sha256':report['card_sha256'],'artifact_sha256':report['artifact_sha256'],
             'source_commit':report['source_commit'],'run_key':run_key,
             'verified_at':datetime.now(timezone.utc).isoformat()}
    output=args.work/'output';destination=output/path;destination.parent.mkdir(parents=True,exist_ok=True)
    encoded=json.dumps(receipt,ensure_ascii=False,separators=(',',':'))+'\n'
    with destination.open('x') as handle:handle.write(encoded)
    (output/PREFIX/'current.json').write_text(encoded)
    args.work.mkdir(parents=True,exist_ok=True)
    commit=publish_feed(output,ref,args.work,'itaingtr/keirin-lineup2')
    print('PUBLICATION CONFIRMED AFTER HTTP CHECK',target,commit,flush=True)


if __name__=='__main__':main()
