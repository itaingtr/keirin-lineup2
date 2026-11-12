"""Inspect public official flag fields for a checked recent result."""
import json
from pathlib import Path
from keirin_jp_provider import OfficialClient
from previous_daily import load_daily
from export_pages import page_date

def main():
    site=Path('site');page=(site/'index.html').read_text();day=page_date(page)
    data=load_daily(site,day,page)
    choices=[d for r in data['races'] for p in r['players'] for m in p['meetings'] for d in m['days']
             if d.get('race_id') and not d.get('race_date_inferred') and not d.get('unavailable')]
    row=choices[0];race=row['race_id'];number=int(race[:2]);code=race[2:4];raw=race[4:]
    client=OfficialClient();payload,observed=client._json(code,raw,number,'JSJ012')
    rows=payload.get('tyakujyunItemSubData',[])
    result={'provider':'keirin.jp','code':code,'date':raw,'race':number,'observed_at':observed,
            'row_fields':sorted({k for r in rows for k in r}),
            'rows':[{k:v for k,v in r.items() if k in ('syaban','sensyuRegistNo','tyaku','agari','BH','S','ST','SB','inLineJyuni')}
                    for r in rows]}
    Path('/tmp/history-flag-source.json').write_text(json.dumps(result,ensure_ascii=False))
    print('OFFICIAL RECENT FLAG FIELDS',json.dumps(result,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
