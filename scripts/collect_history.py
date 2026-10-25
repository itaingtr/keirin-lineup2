"""Read a new current-meeting history sidecar and verify each linked race result."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import time
from urllib.parse import urlsplit

from collect_sources import query, require
from meeting_history import parse_history
from source_http import fetch
from venues import identity


def race_data(doc, source):
    ident = identity(source)
    params = {'cupId':ident['start']+ident['code'],
              'index':int(urlsplit(source).path.rstrip('/').split('/')[-2]), 'raceNumber':ident['race']}
    data = query(doc,'FETCH_KEIRIN_RACE',params)
    schedule, race = data['schedule'], data['race']
    require(schedule['cupId'] == params['cupId'] and schedule['index'] == params['index']
            and schedule['date'] == ident['date'] and race['number'] == params['raceNumber']
            and race['scheduleId'] == schedule['id'], 'Linked result identity differs from the requested race')
    require(race['id'] == f"{ident['race']:02}{ident['code']}{ident['date']}", 'Wrong source race ID')
    return data


def verify_result(data, item, player_id, name):
    require(any(p['id'] == player_id and p['name'] == name for p in data['players']), 'Linked result rider name differs')
    require(any(e['playerId'] == player_id for e in data['entries']), 'Rider is absent from the linked result')
    matches = [r for r in data['results'] if r.get('playerId') == player_id and r.get('raceId') == item['race_id']]
    require(len(matches) == 1, 'Linked official race result is missing or ambiguous')
    result = matches[0]
    for key, source_key in (('order','order'),('back','back'),('final_half_record','finalHalfRecord'),
                            ('has_accident','hasAccident'),('accident','accident')):
        require(item[key] == result[source_key], f'Linked result {key} differs from current-meeting history')
    return {k:result[k] for k in ('raceId','playerId','order','back','finalHalfRecord','hasAccident','accident','accidentName')}


def collect(dataset, *, read=fetch, pause=1):
    from result_cards import normalize_result
    captured, sources, races, verified = [], [], [], {}
    result_cards={}
    for card in dataset['races']:
        source = card['source']
        if pause: time.sleep(pause)
        doc, observed = read(source,captured)
        data = race_data(doc,source)
        result_card=normalize_result(data,source,observed)
        result_cards[result_card['source_url']]=result_card
        players = {p['id']:p for p in data['players']}
        records = {p['playerId']:p for p in data['records']}
        entries = data['entries']
        actual = {e['number']:players[e['playerId']]['name'] for e in entries}
        require(actual == {p['no']:p['name'] for p in card['players']}, 'Current card rider identities have changed')
        require(len(records) == len(data['records']) == len(entries), 'Incomplete current-meeting rider records')
        current = {'source_url':source,'observed_at':observed,'players':[]}
        raw = []
        for entry in entries:
            pid = entry['playerId']; record = records[pid]
            history = parse_history(record,source,pid)
            name = players[pid]['name']
            current['players'].append({'no':entry['number'],'name':name,'player_id':pid,'meeting_results':history})
            raw.append({'playerId':pid,'name':name,'currentCupResults':record['currentCupResults']})
        sources.append({'url':source,'observed_at':observed,'records':raw})
        races.append(current)
    for race in races:
        for player in race['players']:
            for item in player['meeting_results']:
                url = item['result_url']
                if url not in verified:
                    if pause: time.sleep(pause)
                    doc, observed = read(url,captured)
                    data = race_data(doc,url.replace('/raceresult/','/racecard/'))
                    result_cards[url]=normalize_result(data,url,observed)
                    verified[url] = (data, {'url':url,'observed_at':observed,'results':[]})
                data, source = verified[url]
                source['results'].append(verify_result(data,item,player['player_id'],player['name']))
    sources.extend(source for _,source in verified.values())
    display = {'schema_version':1,'provider':'winticket','target_date':dataset['target_date'],
               'checked_at':datetime.now(timezone.utc).isoformat(),'races':races,
               'result_cards':list(result_cards.values())}
    archive = {**display,'snapshot_kind':'current-meeting-results','sources':sources}
    return archive, display


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('card',type=Path,help='Previously validated private card')
    parser.add_argument('--snapshot',type=Path,required=True)
    parser.add_argument('--display',type=Path,required=True)
    args = parser.parse_args()
    require(not args.snapshot.exists() and not args.display.exists(), 'Never replace saved history snapshots')
    root = Path(__file__).resolve().parents[1]
    require(not any(args.snapshot.resolve().is_relative_to(root/name) for name in ('site','dist')), 'Source snapshots must stay outside the site')
    archive, display = collect(json.loads(args.card.read_text()))
    for file,data in ((args.snapshot,archive),(args.display,display)):
        file.parent.mkdir(parents=True,exist_ok=True)
        with file.open('x') as handle: json.dump(data,handle,ensure_ascii=False,indent=2)
    print(f"Verified {len(display['races'])} races and their earlier current-meeting results")


if __name__ == '__main__': main()
