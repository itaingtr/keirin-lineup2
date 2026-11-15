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


def matched_details(site, page, day):
    """Read saved profile fields without collecting or rebinding another rider."""
    path = page.parent/'rider-details.json'
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
        target = day[:4]+'-'+day[4:6]+'-'+day[6:]
        if data.get('schema_version') != 1 or data.get('provider') != 'kdreams' or data.get('target_date') != target:
            return {}
        rows = data.get('races', [])
        sources = [row['source_url'] for row in rows]
        if len(set(sources)) != len(sources):
            return {}
        return {row['source_url']: row for row in rows}
    except (ValueError, OSError, KeyError, TypeError):
        return {}


def export_search(site, output):
    site, output = Path(site), Path(output)
    destination = output/'daily-results'
    destination.mkdir(parents=True, exist_ok=True)
    # Keep the first date-based view at its own URL; the existing entry point
    # now implements the user's corrected name-search request.
    (destination/'entries.html').write_bytes((site/'daily-results/index.html').read_bytes())
    search_page = (site/'daily-results/search.html').read_text()
    for name in ('search.css', 'model.js', 'search-model.js', 'search.js'):
        asset = site/'daily-results'/name
        if asset.is_file():
            version = hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
            search_page = search_page.replace('./'+name+'"', './'+name+'?v='+version+'"')
    (destination/'index.html').write_text(search_page)
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
        details = matched_details(site, page, day)
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
                row = details.get(race['source'], {})
                matches = [p for p in row.get('players', []) if p.get('no') == player['no']
                    and p.get('name') == player['name'] and str(p.get('period')) == str(player['period'])
                    and (not p.get('player_id') or p['player_id'] == identifier)]
                verified = matches[0] if len(matches) == 1 else {}
                for key in ('prefecture', 'age'):
                    value = verified.get(key, player.get(key))
                    if key == 'age' and (type(value) is not int or not 18 <= value <= 100):
                        continue
                    if key == 'prefecture' and (not isinstance(value, str) or not value):
                        continue
                    person[key] = value
                style = verified.get('style') or player.get('style')
                if style in ('逃', '両', '追'):
                    person['style'] = style
                if verified:
                    person['details_source'] = {'url': race['source'], 'observed_at': row.get('observed_at')}
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
                for key in ('prefecture', 'age', 'style'):
                    if person.get(key) is None and record.get(key) is not None:
                        person[key] = record[key]
            except (ValueError, OSError, KeyError):
                continue
    catalogue = {'schema_version': 1, 'kind': 'rider_search',
        'players': sorted(players.values(), key=lambda player: (player['name'], player['player_id']))}
    (destination/'riders.json').write_text(encode(catalogue))
    config = json.loads((site/'race-results-config.json').read_text())
    (destination/'profile-config.json').write_text(encode({
        'endpoint': config['endpoint'].rsplit('/', 1)[0]+'/rider-profile', 'anon_key': config['anon_key']}))
    return {'players': len(players), 'href': '/keirin-lineup2/daily-results/index.html'}
