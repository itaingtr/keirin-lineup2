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
    card,_=client._json('55','20260806',1,'JSJ002')
    seen=set();unusual=[]
    import re
    from keirin_jp_provider import compact
    for race in card.get('raceInfo',[]):
        for p in race.get('sensyuTypeInfo',[]):
            identifier=p.get('sensyuRegistNo');car=compact(p.get('syaban',''));period=compact(p.get('sotugyouki',''))
            if not re.fullmatch(r'[1-9]',car) or not isinstance(identifier,str) or not re.fullmatch(r'\d{6}',identifier) or identifier in seen or not re.fullmatch(r'\d{1,3}',period):
                unusual.append({'race':race.get('raceNo'),**{k:p.get(k) for k in ('syaban','sensyuRegistNo','sensyuName','sotugyouki','ketujyouTuikaHojyu')}})
            seen.add(identifier)
    print('OFFICIAL HISTORICAL CARD SLOTS',json.dumps(unusual,ensure_ascii=False),flush=True)
    for code,raw,number,names in [('73','20261024',9,{'堀内俊介'}),('47','20261001',4,{'菊地圭尚','小西晴己'}),('27','20261018',7,{'小森貴大'})]:
        payload,_=client._json(code,raw,number,'JSJ012')
        rows=[{k:p.get(k) for k in ('sensyuRegistNo','sensyuName','tyaku','agari','BH','kojinStateItemSubData')}
              for p in payload.get('tyakujyunItemSubData',[]) if compact(p.get('sensyuName','')) in names]
        print('OFFICIAL REENTRY DETAILS',code,raw,number,json.dumps(rows,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
