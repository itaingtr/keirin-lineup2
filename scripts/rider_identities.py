"""Verify stable public rider IDs before enabling shared rider condition notes."""
from datetime import datetime, timezone
import re
from urllib.parse import urlsplit

from collect_sources import query, require
from source_http import fetch
from venues import identity

CONDITION_CUTOVER = '20261102'


def existing_id(player):
    ids = {r['player_id'] for r in player.get('meetingResults', [])}
    if player.get('playerId'):
        ids.add(player['playerId'])
    require(len(ids) <= 1, 'Rider IDs differ across meeting results')
    return next(iter(ids), None)


def validate_identities(data, races, target):
    require(data.get('schema_version') == 1 and data.get('provider') == 'winticket'
            and data.get('target_date') == target, 'Wrong rider identity date/provider')
    rows = data.get('races', [])
    mapped = {row['source_url']: row for row in rows}
    require(len(mapped) == len(rows) == len(races)
            and set(mapped) == {r['source'] for r in races}, 'Incomplete rider identity races')
    seen = set()
    for race in races:
        require(identity(race['source'])['date'] == target.replace('-', ''), 'Rider identity race date differs')
        row = mapped[race['source']]
        observed = datetime.fromisoformat(row['observed_at'])
        require(observed.tzinfo is not None and observed <= datetime.now(timezone.utc), 'Invalid rider observation time')
        players = {p['no']: p for p in row['players']}
        require(len(players) == len(row['players']) == len(race['players']), 'Incomplete rider identities')
        for player in race['players']:
            saved = players.get(player['no'], {})
            identifier = saved.get('player_id')
            require(isinstance(identifier, str) and re.fullmatch(r'\d{1,12}', identifier)
                    and saved.get('name') == player['name'] and saved.get('period') == str(player['period']),
                    'Rider ID does not match car/name/period')
            require(identifier not in seen, 'Duplicate rider on the race date')
            seen.add(identifier)
            known = existing_id(player)
            require(known is None or known == identifier, 'Rider ID differs from saved meeting history')
    return data


def collect_identities(races, target, observed_at, reader=fetch):
    records = []
    for race in races:
        ids = {p['no']: existing_id(p) for p in race['players']}
        observed = observed_at
        if not all(ids.values()):
            ident = identity(race['source'])
            day = int(urlsplit(race['source']).path.rstrip('/').split('/')[-2])
            params = {'cupId': ident['start'] + ident['code'], 'index': day, 'raceNumber': ident['race']}
            doc, observed = reader(race['source'], [])
            data = query(doc, 'FETCH_KEIRIN_RACE', params)
            schedule, card = data['schedule'], data['race']
            expected_race = f"{ident['race']:02}{ident['code']}{ident['date']}"
            require(schedule['cupId'] == params['cupId'] and schedule['index'] == day
                    and schedule['date'] == ident['date'], 'Rider source schedule differs')
            require(card['id'] == expected_race and card['number'] == ident['race']
                    and card['scheduleId'] == schedule['id'], 'Rider source race differs')
            source_players = {p['id']: p for p in data['players']}
            entries = data['entries']
            expected = {p['no']: p for p in race['players']}
            require(len(entries) == len(expected)
                    and {e['number'] for e in entries} == set(expected), 'Rider source cars differ')
            ids = {}
            for entry in entries:
                player = source_players[entry['playerId']]
                saved = expected[entry['number']]
                require(entry['raceId'] == expected_race and player['name'] == saved['name']
                        and str(player['term']) == str(saved['period']), 'Rider source car/name/period differs')
                ids[entry['number']] = entry['playerId']
        records.append({'source_url': race['source'], 'observed_at': observed,
                        'players': [{'no': p['no'], 'name': p['name'], 'period': str(p['period']),
                                     'player_id': ids[p['no']]} for p in race['players']]})
        print('RIDER IDENTITIES', race['venue'], race['race'], 'R verified', flush=True)
    return validate_identities({'schema_version': 1, 'provider': 'winticket',
                                'target_date': target, 'races': records}, races, target)
