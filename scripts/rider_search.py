"""Search the whole checked rider catalogue, independently of today's roster."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from published_card import parse_page
from rider_history import read_index, read_player


def encode(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n'


def copy_checked(site, output, ref):
    relative = ref['path']
    if not re.fullmatch(r'(?:rider-history|rider-profiles)/\d{6}/[a-f0-9]{64}\.json', relative):
        raise ValueError('Invalid rider search reference')
    payload = (site/relative).read_bytes()
    if hashlib.sha256(payload).hexdigest() != ref['sha256']:
        raise ValueError('Rider search checksum differs')
    destination = output/relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.read_bytes() != payload:
        raise ValueError('Immutable search output differs')
    destination.write_bytes(payload)
    return json.loads(payload)


def export_search(site, output):
    site, output = Path(site), Path(output)
    destination = output/'daily-results'
    destination.mkdir(parents=True, exist_ok=True)
    # Keep the first date-based view at its own URL; the existing entry point
    # now implements the user's corrected name-search request.
    (destination/'entries.html').write_bytes((site/'daily-results/index.html').read_bytes())
    (destination/'index.html').write_bytes((site/'daily-results/search.html').read_bytes())
    # A confirmed example identity also permits its on-demand official profile
    # before the optional immutable profile snapshot has been prepared.
    players = {'014396': {'player_id': '014396', 'name': '脇本雄太', 'period': 94,
                         'profile_url': 'https://keirin.jp/pc/racerprofile?snum=014396'}}
    for identifier, entry in read_index(site)['players'].items():
        person = {'player_id': identifier, 'name': entry['name'], 'period': entry['period'],
                  'profile_url': 'https://keirin.jp/pc/racerprofile?snum='+identifier}
        try:
            record = read_player(site, entry)
            if len(record['meetings']) > 10:
                raise ValueError('Too many stored meetings')
            ref = {'path': entry['path'], 'sha256': entry['sha256']}
            copy_checked(site, output, ref)
            person.update(history_ref=ref, meeting_count=len(record['meetings']))
        except (ValueError, OSError, KeyError):
            person['history_status'] = 'unavailable'
        players[identifier] = person
    # Use all saved official cards for the latest checked statistics/profile
    # fields. Never require the searched rider to be on the current card.
    for page in sorted(site.glob('line*.html/index.html')):
        day = page.parent.name[4:12]
        for race in parse_page(page.read_text()):
            if 'keirin.kdreams.jp' not in race['source']:
                continue
            for player in race['players']:
                identifier = player.get('playerId')
                if not isinstance(identifier, str) or not re.fullmatch(r'\d{6}', identifier):
                    continue
                saved = players.get(identifier)
                if saved and (saved['name'] != player['name'] or str(saved['period']) != str(player['period'])):
                    continue
                person = players.setdefault(identifier, {'player_id': identifier, 'name': player['name'],
                    'period': player['period'], 'profile_url': 'https://keirin.jp/pc/racerprofile?snum='+identifier})
                person['last_card'] = {'date': day[:4]+'-'+day[4:6]+'-'+day[6:], 'source_url': race['source'],
                    'score_raw': player.get('rawScore'), 'stats': deepcopy(player.get('stats', []))}
                for key in ('prefecture', 'age'):
                    if player.get(key) is not None:
                        person[key] = player[key]
    profiles = site/'rider-profiles/current.json'
    if profiles.exists():
        for identifier, entry in json.loads(profiles.read_text())['players'].items():
            try:
                record = copy_checked(site, output, entry)
                if (record['player_id'], record['name'], str(record['period'])) != (identifier, entry['name'], str(entry['period'])):
                    raise ValueError('Official profile person differs')
                person = players.setdefault(identifier, {'player_id': identifier, 'name': record['name'], 'period': record['period'],
                    'profile_url': record['source_url']})
                if (person['name'], str(person['period'])) != (record['name'], str(record['period'])):
                    continue
                person['profile_ref'] = {'path': entry['path'], 'sha256': entry['sha256']}
            except (ValueError, OSError, KeyError):
                continue
    catalogue = {'schema_version': 1, 'kind': 'rider_search',
        'players': sorted(players.values(), key=lambda player: (player['name'], player['player_id']))}
    (destination/'riders.json').write_text(encode(catalogue))
    config = json.loads((site/'race-results-config.json').read_text())
    (destination/'profile-config.json').write_text(encode({
        'endpoint': config['endpoint'].rsplit('/', 1)[0]+'/rider-profile', 'anon_key': config['anon_key']}))
    return {'players': len(players), 'href': '/keirin-lineup2/daily-results/index.html'}
