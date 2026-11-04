"""Join K Dreams' published S/B result column to official registration IDs."""
from copy import deepcopy
from urllib.parse import urlsplit

from kdreams_provider import _doc_read, _title, classes, compact, fetch, parse_players, require
from source_http import cells
from venues import identity


def parse_result_flags(doc,url):
    _title(doc,url)
    players={p['no']:p for p in parse_players(doc)}
    tables=[t for t in doc.find_all('table') if 'result_table' in classes(t)]
    require(len(tables)==1,'K Dreams official result table unavailable')
    expected=['予想','着順','車番','選手名','着差','上り','決まり手','S/B','勝敗因']
    require(any([compact(c.text()) for c in cells(r)]==expected for r in tables[0].find_all('tr')),
            'K Dreams result column meanings differ')
    output={}
    for row in tables[0].find_all('tr'):
        values=cells(row)
        if not any('num' in classes(c) for c in values):continue
        require(len(values)==len(expected),'K Dreams result dimensions differ')
        number=compact(values[2].text())
        require(number.isdigit() and int(number) in players and int(number) not in output,'K Dreams result car differs')
        number=int(number);p=players[number]
        require(compact(values[3].text())==compact(p['name']),'K Dreams result name differs')
        flags=compact(values[7].text())
        require(flags in ('','S','B','SB','BS','S/B','B/S'),'Unknown K Dreams S/B value')
        output[number]={'no':number,'name':p['name'],'period':p['period'],'rank':compact(values[1].text()),
                        'time':compact(values[5].text()),'start':'S' in flags,'back':'B' in flags}
    require(bool(output),'K Dreams result riders unavailable')
    return output


def enrich_start_flags(dataset,read=fetch):
    """Never infer S from H/B; match race, car, name, period, rank and time."""
    require(dataset.get('provider')=='kdreams','Result flags require a fresh K Dreams card')
    result=deepcopy(dataset);cache={}
    for race in result['races']:
        ident=identity(race['source']);slug=urlsplit(race['source']).path.split('/')[1]
        for player in race['players']:
            for history in player.get('meeting_results',[]):
                day,number=history['meeting_day'],history['race_number']
                url=f'https://keirin.kdreams.jp/{slug}/racedetail/{ident["code"]}{ident["start"]}{day:02}{number:04}/?pageType=showResult'
                if url not in cache:
                    doc,observed=_doc_read(url,read)
                    cache[url]=(parse_result_flags(doc,url),observed)
                    result.setdefault('history_sources',[]).append({'provider':'kdreams','url':url,'observed_at':observed,'kind':'result_start_flags'})
                rows,observed=cache[url]
                matching=[r for r in rows.values() if compact(r['name'])==compact(player['name']) and r['period']==player['period']]
                require(len(matching)==1,'K Dreams result rider identity differs from official history')
                row=matching[0]
                require(row['no']==history['car_number'],'K Dreams/official historical car differs')
                # JKA supplies the immutable registration ID and H/B; K supplies
                # the separately published S flag for that same race and rider.
                require(history['player_id']==player['player_id'],'Official result registration ID differs')
                if history['order']:
                    require(row['rank']==str(history['order']),'K Dreams/official rank differs')
                else:
                    require(row['rank'] and row['rank'][0]==history['accident'][0],'K Dreams/official accident differs')
                require(row['back']==history['back'],'K Dreams/official B differs')
                official_time=history['final_half_record'] or ''
                require(row['time']==official_time or row['time'] in ('','-','—') and official_time in ('','-','—'),
                        'K Dreams/official individual time differs')
                history['start']=row['start']
                history['start_source_url']=url
                history['start_observed_at']=observed
    print('K DREAMS RESULT FLAGS',len(cache),'official races verified',flush=True)
    return result
