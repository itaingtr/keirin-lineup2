"""Validate only earlier days of this meeting, preserving source precision."""
from datetime import date, timedelta
import re
from urllib.parse import urlsplit

from venues import identity, VENUES


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_history(results, source):
    ident = identity(source)
    require(ident['provider'] == 'winticket', 'Meeting results need a WINTICKET source')
    require(isinstance(results, list), 'Expected a list of meeting results')
    start = date.fromisoformat(f"{ident['start'][:4]}-{ident['start'][4:6]}-{ident['start'][6:]}")
    target = date.fromisoformat(f"{ident['date'][:4]}-{ident['date'][4:6]}-{ident['date'][6:]}")
    output, days, riders = [], set(), set()
    for item in results:
        day, number = item['meeting_day'], item['race_number']
        require(type(day) is int and 1 <= day <= 6, 'Invalid result meeting day')
        result_date = start + timedelta(days=day-1)
        require(result_date < target and day not in days, 'Result must be a unique earlier meeting day')
        days.add(day)
        require(type(number) is int and 1 <= number <= 12, 'Invalid result race number')
        require(item['race_date'] == result_date.isoformat(), 'Result calendar date differs from its meeting day')
        require(item['race_id'] == f"{number:02}{ident['code']}{result_date:%Y%m%d}", 'Result race identity differs from this meeting')
        expected_url = f"https://www.winticket.jp/keirin/{VENUES[ident['code']][1]}/raceresult/{ident['start']}{ident['code']}/{day}/{number}"
        require(item['result_url'] == expected_url, 'Result link differs from its source race identity')
        require(isinstance(item['player_id'], str) and re.fullmatch(r'\d{1,12}',item['player_id']), 'Invalid result rider identity')
        riders.add(item['player_id'])
        require(type(item['order']) is int and 0 <= item['order'] <= 9, 'Invalid result order')
        require(type(item['display_type']) is int and item['display_type'] in (0,1,2), 'Unknown official rank decoration')
        require(type(item['back']) is bool and type(item['has_accident']) is bool, 'Expected source B and accident flags')
        require(item['order'] > 0 or item['has_accident'], 'An unranked result needs its official accident status')
        for key, limit in (('accident',4),('accident_name',24)):
            require(isinstance(item[key],str) and len(item[key]) <= limit and not any(c in item[key] for c in '\r\n\t'), 'Invalid accident label')
        if item['order'] == 0:
            require(bool(item['accident']), 'An unranked result needs its original display label')
        timing = item['final_half_record']
        require(timing is None or isinstance(timing,str) and (timing in ('','-','—') or re.fullmatch(r'\d{1,2}\.\d{1,3}',timing)), 'Invalid source individual time')
        output.append(dict(item))
    require(len(riders) <= 1, 'Meeting results contain multiple riders')
    return sorted(output, key=lambda item:item['meeting_day'])


def parse_history(record, source, player_id):
    require(record.get('playerId') == player_id, 'History record belongs to another rider')
    rows = record.get('currentCupResults')
    require(isinstance(rows,list), 'Public current-meeting results are missing')
    ident = identity(source)
    start = date.fromisoformat(f"{ident['start'][:4]}-{ident['start'][4:6]}-{ident['start'][6:]}")
    output = []
    for row in rows:
        require(row.get('playerId') == player_id, 'A meeting result belongs to another rider')
        day = row['index']
        require(type(day) is int and 1 <= day <= 6, 'Invalid official meeting index')
        result_date = start + timedelta(days=day-1)
        output.append({'player_id':player_id, 'race_id':row['raceId'], 'meeting_day':day,
                       'race_number':row['raceNumber'], 'race_date':result_date.isoformat(),
                       'result_url':f"https://www.winticket.jp/keirin/{VENUES[ident['code']][1]}/raceresult/{ident['start']}{ident['code']}/{day}/{row['raceNumber']}",
                       'order':row['order'], 'display_type':row['displayType'], 'back':row['back'],
                       'final_half_record':row['finalHalfRecord'], 'has_accident':row['hasAccident'],
                       'accident':row['accident'], 'accident_name':row['accidentName']})
    return validate_history(output,source)
