"""Collect public WINTICKET media URLs and AI ranks for an existing card.

This creates a new sidecar snapshot, leaving saved scores, odds and cards intact.
Archive and read back the snapshot before publishing its display-only fields.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from urllib.parse import urlsplit

from collect_sources import query, prediction_marks, require
from source_http import fetch
from venues import identity, VENUES


def media_url(url, *, slug=None):
    p = urlsplit(url)
    require(p.scheme == 'https' and not (p.username or p.password or p.port or p.query or p.fragment),
            'Expected a public HTTPS media URL without credentials or signatures')
    if slug is None:
        import re
        require(p.hostname == 'video.winticket.jp' and
                re.fullmatch(r'/keirin/digest/[A-Za-z0-9_-]+\.mp4', p.path), 'Unexpected digest source')
    else:
        import re
        require(p.hostname == 'keirin-' + slug + '.winticket.live' and
                re.fullmatch(r'/out/v1/[a-f0-9]{32}/index\.m3u8', p.path), 'Unexpected venue live source')
    return url


def parse_extra(doc, url, observed_at, expected_players):
    ident = identity(url)
    params = {'cupId':ident['start'] + ident['code'], 'index':int(urlsplit(url).path.rstrip('/').split('/')[-2]), 'raceNumber':ident['race']}
    data = query(doc, 'FETCH_KEIRIN_RACE', params)
    race, schedule = data['race'], data['schedule']
    require(race['number'] == ident['race'] and race['scheduleId'] == schedule['id']
            and schedule['cupId'] == params['cupId'] and schedule['index'] == params['index']
            and schedule['date'] == ident['date'], 'Media race identity mismatch')
    players = {p['id']:p for p in data['players']}
    actual = {e['number']:players[e['playerId']]['name'] for e in data['entries']}
    expected = {p['no']:p['name'] for p in expected_players}
    require(actual == expected, 'Media rider identities differ from the displayed card')
    marks = prediction_marks(data, list(actual))
    digest = None
    if race.get('hasDigestVideo'):
        require(race.get('digestVideoProvider') == 0, 'Unsupported digest provider')
        digest = media_url(race['digestVideo'])
    return {'source_url':url, 'observed_at':observed_at,
            'venue_code':ident['code'], 'race':ident['race'],
            'players':[{'no':n,'name':name,'mark':marks.get(n,'')} for n,name in sorted(actual.items())],
            'digest':digest, 'digest_status':'available' if digest else 'unpublished'}


def parse_live(doc, code, target_date, observed_at):
    slug = VENUES[code][1]
    data = query(doc, 'FETCH_BROADCAST_TIMETABLE', {'sport':0})
    # Broadcast IDs use the calendar day, including on day 2+ of a meeting.
    date_code = target_date.replace('-', '') + code
    programs = [(channel,p) for channel in data['channels'] if channel.get('venueId') == code
                for p in channel.get('programs',[]) if p.get('id') == '1:venue'+code+':'+date_code+':0'
                and p.get('videoProvider') == 0]
    require(len(programs) <= 1, 'Ambiguous official venue broadcast')
    result = {'name':VENUES[code][0], 'slug':slug, 'observed_at':observed_at,
              'source_url':'https://www.winticket.jp/keirin/'+slug+'/live', 'hls':None}
    if programs:
        channel, program = programs[0]
        result.update(hls=media_url(program['hls'],slug=slug),
                      start_at=program['startAt'],end_at=program['endAt'])
    return result


def collect(dataset, *, read=fetch, pause=1):
    sources, races, venues = [], [], {}
    for card in dataset['races']:
        url = card['source']
        ident = identity(url)
        if pause: time.sleep(pause)
        doc, observed = read(url, sources)
        races.append(parse_extra(doc,url,observed,card['players']))
        code = ident['code']
        if code not in venues:
            live = 'https://www.winticket.jp/keirin/'+VENUES[code][1]+'/live'
            if pause: time.sleep(pause)
            doc, observed = read(live, sources)
            venues[code] = parse_live(doc,code,dataset['target_date'],observed)
    display = {'schema_version':1, 'provider':'winticket', 'target_date':dataset['target_date'],
               'checked_at':datetime.now(timezone.utc).isoformat(), 'races':races, 'venues':venues}
    # Store only the relevant original public fields, with their real read times.
    archive = {**display, 'sources':[{'url':r['source_url'],'observed_at':r['observed_at'],'normalized':r}
                                   for r in races + list(venues.values())]}
    return archive, display


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('card', type=Path)
    parser.add_argument('--snapshot',type=Path,required=True)
    parser.add_argument('--display',type=Path,required=True)
    args = parser.parse_args()
    require(not args.snapshot.exists() and not args.display.exists(), 'Never replace saved media snapshots')
    archive, display = collect(json.loads(args.card.read_text()))
    for file, data in ((args.snapshot,archive),(args.display,display)):
        file.parent.mkdir(parents=True,exist_ok=True)
        with file.open('x') as handle: json.dump(data,handle,ensure_ascii=False,indent=2)
    print(f"Verified {len(display['races'])} race identities, {sum(bool(r['digest']) for r in display['races'])} published videos and {sum(bool(v['hls']) for v in display['venues'].values())} live feeds")


if __name__ == '__main__': main()
