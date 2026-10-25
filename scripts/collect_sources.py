"""Collect an independent S-class card and exacta feed from public WINTICKET pages.

Enjoy URLs are supported by the renderer, but live Enjoy collection stays disabled
until its source pages can be fetched and their parser can be verified.
"""
import argparse
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from source_http import cells, fetch, state_payloads
from venues import identity, VENUES
from render_races import validate, parse_lineup, write_pages
from meeting_history import parse_history

JST = ZoneInfo('Asia/Tokyo')


class MissingLineup(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValueError(message)


def queries(doc):
    states = [p for p in state_payloads(doc) if isinstance(p, dict) and 'tanStackQuery' in p]
    require(len(states) == 1, 'Expected one public WINTICKET state')
    require(states[0].get('redux', {}).get('user', {}).get('loggedIn') is False, 'Only logged-out public pages may be collected')
    return states[0]['tanStackQuery']['queries']


def query(doc, operation, params):
    matches = [q for q in queries(doc) if len(q.get('queryKey', [])) == 3
               and q['queryKey'][1] == operation and q['queryKey'][2] == params]
    require(len(matches) == 1, 'Missing or ambiguous source query: ' + operation)
    require(matches[0]['state'].get('status') == 'success', 'Source query did not succeed')
    return matches[0]['state']['data']


def lineup_text(prediction, numbers):
    lines = prediction.get('lines') if isinstance(prediction, dict) else None
    if not lines:
        raise MissingLineup('No published lineup; omit this entire meeting')
    result = []
    for line in lines:
        units = []
        for entry in line.get('entries', []):
            cars = entry.get('numbers')
            require(isinstance(cars, list) and cars and all(type(n) is int for n in cars), 'Invalid lineup position')
            units.append(str(cars[0]) if len(cars) == 1 else '(' + ''.join(map(str, cars)) + ')')
        require(bool(units), 'Empty source line')
        result.append('-'.join(units).replace('-(', '(').replace(')-', ')'))
    text = '/'.join(result)
    parse_lineup(text, numbers)
    return text


def visible_card(doc):
    """Check source JSON against the separately rendered rider table."""
    tables = []
    clean = lambda s: re.sub(r'\s+', '', s)
    for table in doc.find_all('table'):
        rows = list(table.find_all('tr'))
        if not rows:
            continue
        headers = [clean(c.text()) for c in cells(rows[0])]
        if '競走得点' not in headers or not {'S', 'B', '逃', '捲', '差', 'マ'}.issubset(headers):
            continue
        riders = {}
        for row in rows[1:]:
            values = cells(row)
            if len(values) == len(headers)-1 and headers[0] == '枠':
                values.insert(0, None)  # The frame cell is carried by HTML rowspan.
            require(len(values) == len(headers), 'Source rider table has changed')
            mapped = dict(zip(headers, values))
            number = int(clean(mapped['車'].text()))
            require(number not in riders, 'Duplicate visible rider')
            riders[number] = [float(clean(mapped['競走得点'].text()))] + [int(clean(mapped[k].text())) for k in ('S', 'B', '逃', '捲', '差', 'マ')]
        tables.append(riders)
    require(len(tables) == 1, 'Expected one complete visible rider table')
    return tables[0]


def prediction_marks(data, numbers):
    """Display the published WINTICKET AI order; never infer ranks from odds."""
    predictions = [p for p in data.get('predictions', []) if p.get('isAi') is True]
    if not predictions:
        return {}
    require(len(predictions) == 1, 'Ambiguous AI prediction')
    order = predictions[0].get('order')
    require(isinstance(order, list) and 1 <= len(order) <= 4
            and all(type(n) is int and n in numbers for n in order)
            and len(set(order)) == len(order), 'Invalid published AI prediction order')
    return dict(zip(order, ('◎', '○', '▲', '△')))


def parse_card(doc, url, fetched_at, *, include_odds=True):
    ident = identity(url)
    require(ident['provider'] == 'winticket', 'WINTICKET parser cannot relabel another source')
    index = (date.fromisoformat(f"{ident['date'][:4]}-{ident['date'][4:6]}-{ident['date'][6:]}") - date.fromisoformat(f"{ident['start'][:4]}-{ident['start'][4:6]}-{ident['start'][6:]}")).days + 1
    params = {'cupId': ident['start'] + ident['code'], 'index': index, 'raceNumber': ident['race']}
    data = query(doc, 'FETCH_KEIRIN_RACE', params)
    race, schedule = data['race'], data['schedule']
    require(schedule['cupId'] == params['cupId'] and schedule['index'] == index
            and schedule['date'] == ident['date'] and race['number'] == ident['race']
            and race['scheduleId'] == schedule['id'], 'Returned race identity does not match the requested URL')
    if not race['class'].startswith(('S級', 'Ｓ級')):
        return None, None
    require(not race['cancel'], 'Source race was cancelled')
    cups = [c for c in data['cups'] if c['id'] == params['cupId']]
    require(len(cups) == 1 and cups[0]['venueId'] == ident['code'], 'Missing or mismatched meeting')
    cup = cups[0]
    entries = data['entries']
    require(len(entries) == race['entriesNumber'] and 2 <= len(entries) <= 9, 'Incomplete source entries')
    require(all(e['raceId'] == race['id'] and not e['absent'] for e in entries), 'Missing or withdrawn source rider')
    numbers = [e['number'] for e in entries]
    require(len(set(numbers)) == len(numbers), 'Duplicate car number')
    players = {p['id']: p for p in data['players']}
    records = {r['playerId']: r for r in data['records']}
    require(len(players) == len(entries) and len(records) == len(entries), 'Incomplete rider identities or statistics')
    visible = visible_card(doc)
    require(set(visible) == set(numbers), 'Visible rider numbers differ from source JSON')
    marks = prediction_marks(data, numbers)
    output = []
    for entry in entries:
        player, record = players[entry['playerId']], records[entry['playerId']]
        stats = [record[k] for k in ('standing', 'back', 'frontRunner', 'deepCloser', 'stalker', 'marker')]
        require(visible[entry['number']][0] == float(record.get('racePointStr', record['racePoint'])), 'Visible formatted score does not match source score')
        for label, shown, value in zip(('S','B','逃','捲','差','マ'), visible[entry['number']][1:], stats):
            require(shown == value, f'Visible {label} statistic differs for car {entry["number"]}: shown={shown}, source={value}')
        output.append({'no':entry['number'], 'name':player['name'], 'score':record['racePoint'],
                       'period':player['term'], 'mark':marks.get(entry['number'], ''), 'stats':stats,
                       'meeting_results':parse_history(record,url,entry['playerId'])})
    lineup = lineup_text(data.get('linePrediction'), numbers)
    card = {'venue':VENUES[ident['code']][0], 'race':ident['race'], 'source':url,
            'race_type':race['class'] + race['raceType3'], 'grade_code':cup['grade'],
            'start_time':datetime.fromtimestamp(race['startAt'], JST).strftime('%H:%M'),
            'lineup':lineup, 'players':sorted(output, key=lambda p:p['no'])}
    odds = (parse_odds(query(doc, 'FETCH_KEIRIN_RACE_ODDS', params), race['id'], url, numbers, fetched_at)
            if include_odds else {'race_key':urlsplit(url).path, 'source_url':url,
                'provider':'winticket', 'bet_type':'exacta', 'rider_numbers':sorted(numbers),
                'fetched_at':fetched_at, 'status':'unavailable', 'unavailable_reason':'race_day_09_jst'})
    return card, odds


def parse_odds(data, race_id, source_url, numbers, fetched_at):
    snapshot = {'race_key':urlsplit(source_url).path, 'source_url':source_url,
                'provider':'winticket', 'bet_type':'exacta', 'parser_version':1,
                'rider_numbers':sorted(numbers), 'fetched_at':fetched_at}
    if not data.get('exacta'):
        return {**snapshot, 'status':'unavailable'}
    updated = data.get('oddsUpdatedAt')
    zero_placeholders = all(type(item.get('odds')) in (int,float) and item['odds'] == 0
                            for item in data['exacta'])
    ceiling_placeholders = all(type(item.get('odds')) in (int,float) and item['odds'] == 9999.9
                               and type(item.get('popularityOrder')) is int and item['popularityOrder'] == 0
                               for item in data['exacta'])
    unpublished = (updated is None or type(updated) is int and updated == 0) and (zero_placeholders or ceiling_placeholders)
    if not unpublished:
        require(type(updated) is int and updated > 0, 'Source odds update time is missing')
        observed = datetime.fromtimestamp(updated, timezone.utc)
        require(observed <= datetime.fromisoformat(fetched_at), 'Source odds time is in the future')
    expected = {(a,b) for a in numbers for b in numbers if a != b}
    output, seen = [], set()
    for item in data['exacta']:
        require(item['raceId'] == race_id and item['type'] == 4, 'Wrong race or bet type in source exacta')
        pair = tuple(item['key'])
        require(pair in expected and pair not in seen, 'Invalid or duplicate ordered exacta pair')
        seen.add(pair)
        value = None if item['absent'] else item['odds']
        if value is not None:
            require(type(value) in (float,int) and math.isfinite(value) and (value > 0 or unpublished and value == 0), 'Invalid source quote; never fill missing prices with zero')
        output.append({'first':pair[0], 'second':pair[1], 'value':value})
    require(seen == expected, 'Incomplete exacta matrix')
    if unpublished:
        print('Official exacta not yet published:',source_url,'updated_at=',updated,
              'validated_placeholders=',len(output),flush=True)
        return {**snapshot,'status':'unavailable','unavailable_reason':'not_yet_published'}
    return {**snapshot, 'status':'snapshot', 'observed_at':observed.isoformat(), 'odds':output}


def daily_races(doc, target_date):
    target = target_date.replace('-', '')
    data = query(doc, 'FETCH_KEIRIN_DAILY_RACE', {'date':target})
    cups = {c['id']:c for c in data['cups']}
    schedules = {s['id']:s for s in data['schedules']}
    output = []
    seen = set()
    for race in data['races']:
        if not race['class'].startswith(('S級', 'Ｓ級')):
            continue
        require(race['id'] not in seen, 'Duplicate calendar race')
        seen.add(race['id'])
        schedule = schedules[race['scheduleId']]
        cup = cups[schedule['cupId']]
        require(schedule['date'] == target and not schedule['entriesUnfixed'], 'Wrong date or incomplete daily schedule')
        code = cup['venueId']
        require(code in VENUES and cup['id'] == cup['startDate'] + code, 'Unknown or mismatched calendar venue')
        require(not race['cancel'], 'Daily schedule contains a cancelled S-class race')
        output.append((cup['id'], f"https://www.winticket.jp/keirin/{VENUES[code][1]}/racecard/{cup['id']}/{schedule['index']}/{race['number']}"))
    require(bool(output), 'No eligible source races; existing pages are preserved')
    return output


def collect(target_date, *, read=fetch, pause=1, include_odds=True):
    sources = []
    calendar_url = 'https://www.winticket.jp/keirin/racecard/' + target_date.replace('-','')
    calendar, observed = read(calendar_url, sources)
    expected = daily_races(calendar, target_date)
    cards, snapshots, excluded = [], [], {}
    for meeting, url in expected:
        if meeting in excluded:
            continue
        if pause:
            time.sleep(pause)
        doc, fetched_at = read(url, sources)
        try:
            card, odds = parse_card(doc, url, fetched_at, include_odds=include_odds)
        except MissingLineup as error:
            excluded[meeting] = str(error)
            cards = [c for c in cards if identity(c['source'])['start'] + identity(c['source'])['code'] != meeting]
            snapshots = [s for s in snapshots if identity(s['source_url'])['start'] + identity(s['source_url'])['code'] != meeting]
            continue
        require(card is not None, 'Calendar S-class race returned a different class')
        cards.append(card)
        snapshots.append(odds)
        print(f"Validated {card['venue']} {card['race']}R; {len(card['players'])} riders; {len(odds.get('odds', []))} exacta quotes", flush=True)
    require(len(cards) == sum(m not in excluded for m,u in expected), 'Incomplete collection')
    dataset = {'schema_version':1, 'provider':'winticket', 'target_date':target_date,
               'expected_races':len(cards), 'source_expected_races':len(expected), 'races':cards,
               'excluded_meetings':excluded, 'calendar_url':calendar_url, 'calendar_observed_at':observed}
    validate(dataset)
    # Preserve all values used in the display privately, with original source times.
    dataset['sources'] = [{'url':c['source'], 'observed_at':s['fetched_at'], 'normalized':c, 'exacta':s}
                          for c,s in zip(cards,snapshots)]
    feed = {'checked_at':datetime.now(timezone.utc).isoformat(), 'provider':'winticket',
            'results':[{'ok':True, 'snapshot':s} for s in snapshots]}
    return dataset, feed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', default=datetime.now(JST).date().isoformat())
    parser.add_argument('--snapshot', type=Path, required=True, help='New private path outside site/')
    parser.add_argument('--feed', type=Path, required=True, help='New display-only feed path')
    args = parser.parse_args()
    require(date.fromisoformat(args.date).isoformat() == args.date, 'Invalid target date')
    root = Path(__file__).resolve().parents[1]
    require(not args.snapshot.resolve().is_relative_to(root/'site'), 'Snapshots must stay outside the site')
    require(not args.snapshot.exists() and not args.feed.exists(), 'Never overwrite an existing snapshot or feed')
    dataset, feed = collect(args.date)
    args.snapshot.parent.mkdir(parents=True, exist_ok=True)
    args.feed.parent.mkdir(parents=True, exist_ok=True)
    with args.snapshot.open('x') as handle:
        json.dump(dataset, handle, ensure_ascii=False, indent=2)
    with args.feed.open('x') as handle:
        json.dump(feed, handle, ensure_ascii=False, indent=2)
    print(f"Prepared {args.date}: {len(dataset['races'])} independently collected S-class races")


if __name__ == '__main__':
    main()
