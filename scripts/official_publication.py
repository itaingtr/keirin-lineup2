"""Publish verified K Dreams cards and odds without a legacy-provider fallback."""
import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

from export_pages import export, materialize_card, page_date
from official_odds import ODDS_PREFIX, blank_feed, refresh, should_collect, stage_feed
from prepare_next_card import can_publish, display_card, scheduled_target
from published_card import git_read, parse_page, read_published
from rakuten_marks import stage_marks, validate_marks
from render_races import validate
from rider_identities import collect_identities, validate_identities
from update_publication import git, morning_recovery_date, publish_feed, requested_mode
from venues import identity
from keirin_jp_provider import enrich_cards, check_url as check_official_url, program_url
from kdreams_history import enrich_start_flags
from rider_details import collect_details, details_from_dataset, stage_details, validate_details
from lineup_refresh import refresh_lineups

ROOT = Path(__file__).resolve().parents[1]
JST = ZoneInfo('Asia/Tokyo')
PROVIDER = 'kdreams'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def can_replace(target, now, previous=None, *, migration=False):
    """The explicit provider switch may replace today's card, never an archive."""
    if not migration:
        return can_publish(target, now, previous)
    today = now.astimezone(JST).date()
    return (previous == target.isoformat() and today <= target <= today + timedelta(days=1))


def official_card(card, races):
    require(card.get('provider') == PROVIDER
            and all(identity(r['source'])['provider'] == PROVIDER for r in races),
            'Active publication requires actual K Dreams source records')
    return card


def build_card(dataset, checked_at, known_dates=()):
    """Construct one card entirely from the newly observed official dataset."""
    require(dataset.get('provider') == PROVIDER, 'Never relabel a legacy dataset')
    target, races, _ = validate(dataset)
    target = target.isoformat()
    require(all(identity(r['source'])['provider'] == PROVIDER for r in races), 'Mixed active card providers')
    observed = {}
    for source in dataset.get('sources', []):
        require(source.get('provider') == PROVIDER, 'Wrong source provenance')
        stamp = datetime.fromisoformat(source['observed_at'])
        require(stamp.tzinfo is not None and stamp <= datetime.now(timezone.utc), 'Invalid source observation time')
        observed[source['url']] = source['observed_at']
    require(all(r['source'] in observed for r in races), 'Card lacks official observation receipts')
    providers={PROVIDER}
    history_sources=dataset.get('history_sources',[])
    for source in history_sources:
        stamp=datetime.fromisoformat(source['observed_at'])
        require(stamp.tzinfo is not None and stamp<=datetime.now(timezone.utc),'Invalid history observation time')
        if source.get('provider')=='keirin.jp':
            check_official_url(source['url'])
            require(urlsplit(source['url']).path!='/pc/json','Never persist public navigation parameters')
        elif source.get('provider')==PROVIDER:
            from kdreams_provider import check_url
            check_url(source['url'])
            require(urlsplit(source['url']).query=='pageType=showResult','Unexpected result flag source')
        else:raise ValueError('Unexpected active history provider')
        providers.add(source['provider'])
    for race in races:
        for player in race['players']:
            source=player.get('identitySource')
            if source:
                require(source.get('provider')=='keirin.jp' and source.get('race_number')==race['race'], 'Wrong registration identity source')
                check_official_url(source['url'])
                require(source['url']==program_url(race['venueCode'],target.replace('-','')),'Registration source date/venue differs')
                require(any(s['provider']==source['provider'] and s['url']==source['url'] and s['observed_at']==source['observed_at'] for s in history_sources),'Registration identity lacks observation receipt')
            for result in player['meetingResults']:
                require(result.get('provider')=='keirin.jp','Active prior results require official records')
                require(any(s['provider']=='keirin.jp' and s['url']==result['result_url'] and s['observed_at']==result.get('observed_at') for s in history_sources),'Prior result lacks observation receipt')
                if result.get('start') is not None:
                    flag_url=result.get('start_source_url','')
                    parsed=urlsplit(flag_url)
                    flag_identity=identity(parsed._replace(query='').geturl())
                    require(parsed.query=='pageType=showResult' and flag_identity['provider']==PROVIDER
                            and flag_identity['code']==race['venueCode'] and flag_identity['race']==result['race_number']
                            and flag_identity['date']==result['race_date'].replace('-',''),'S flag source race differs')
                    require(any(s['provider']==PROVIDER and s['url']==flag_url and s['observed_at']==result.get('start_observed_at') for s in history_sources),'S flag lacks observation receipt')
    feed = blank_feed(races, target, checked_at)
    card = display_card(dataset, feed, known_dates)
    marks = {'schema_version': 1, 'provider': PROVIDER, 'target_date': target,
             'checked_at': checked_at, 'races': [
                 {'source_url': r['source'], 'prediction_source_url': r['source'],
                  'observed_at': observed[r['source']],
                  'players': [{'no': p['no'], 'name': p['name'], 'period': p['period'], 'mark': p['mark']}
                              for p in r['players']]} for r in races]}
    validate_marks(marks, races, target)
    # All IDs must have been independently verified on the official entry list.
    # collect_identities rejects absent official IDs instead of contacting WINTICKET.
    identities = collect_identities(races, target, checked_at)
    for row in identities['races']:
        row['observed_at'] = observed[row['source_url']]
    validate_identities(identities, races, target)
    card['assets']['rakuten-marks.json'] = encode(marks)
    card['assets']['rider-identities.json'] = encode(identities)
    details=details_from_dataset(dataset)
    validate_details(details,races,target)
    card['assets']['rider-details.json']=encode(details)
    card['summary']['source_providers'] = sorted(providers)
    card['sources'] = dataset.get('sources',[])
    card['history_sources'] = history_sources
    return official_card(card, races), races


def stage_card(card, run_key, output, previous_ref, reader=git_read):
    require(re.fullmatch(r'run-\d+-\d+', run_key), 'Invalid immutable card run key')
    official_card(card, parse_page(card['html']))
    prefix = 'fallback/cards/' + card['target_date'].replace('-', '')
    path = prefix + '/runs/' + run_key + '.json'
    require(reader(previous_ref, path, optional=True) is None, 'Immutable card run already exists')
    payload = encode(card).encode()
    pointer = {'schema_version': 1, 'provider': PROVIDER, 'target_date': card['target_date'],
               'revision': run_key, 'path': path, 'sha256': hashlib.sha256(payload).hexdigest(),
               'checked_at': card['checked_at']}
    destination = Path(output) / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as handle:
        handle.write(payload)
    (Path(output) / prefix / 'latest.json').write_text(encode(pointer))
    (Path(output) / 'fallback/cards/current.json').write_text(encode(pointer))
    stage_marks(json.loads(card['assets']['rakuten-marks.json']), run_key, output)
    if 'rider-details.json' in card['assets']:
        stage_details(json.loads(card['assets']['rider-details.json']),run_key,output)
    return pointer


def saved_odds(ref, target):
    raw = git_read(ref, ODDS_PREFIX + '/' + target.replace('-', '') + '/latest.json', optional=True)
    if raw is None:
        return None
    feed = json.loads(raw)
    require(feed.get('provider') == PROVIDER and feed.get('target_date') == target,
            'Saved official feed date/provider differs')
    return feed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event', required=True)
    parser.add_argument('--schedule', default='')
    parser.add_argument('--mode', choices=('publish', 'cards', 'odds'), default='publish')
    parser.add_argument('--date', default='')
    parser.add_argument('--run-key', required=True)
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    repository = os.environ.get('GITHUB_REPOSITORY', 'itaingtr/keirin-lineup2')
    require(repository == 'itaingtr/keirin-lineup2', 'Wrong publication repository')
    require(re.fullmatch(r'run-\d+-\d+', args.run_key), 'Invalid run key')
    mode = requested_mode(args.event, args.schedule, args.mode)
    now = datetime.now(timezone.utc)
    git('config', 'user.name', 'github-actions[bot]')
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    git('fetch', 'origin', 'odds-diagnostics')
    ref = git('rev-parse', 'FETCH_HEAD')
    saved = read_published(ref)
    require(saved is not None, 'Verified initial card is missing')
    card, races, target = saved
    collection_date = None
    migration = False
    if mode == 'cards':
        collection_date = (date.fromisoformat(args.date) if args.date else
                           scheduled_target(now, args.schedule) if args.event == 'schedule' else
                           now.astimezone(JST).date() + timedelta(days=1))
    else:
        recovery = morning_recovery_date(target, now)
        if recovery:
            collection_date = date.fromisoformat(recovery)
        elif card.get('provider') != PROVIDER:
            collection_date = date.fromisoformat(target)
            migration = True
    output = args.work / 'update'
    collected = collection_date is not None
    if collected:
        require(can_replace(collection_date, now, target, migration=migration),
                'Refusing a past/in-progress card rewrite or date regression')
        from kdreams_provider import collect_cards
        dataset = enrich_start_flags(enrich_cards(collect_cards(collection_date.isoformat())))
        names = git('ls-tree', '--name-only', ref + ':fallback/cards').splitlines()
        card, races = build_card(dataset, datetime.now(timezone.utc).isoformat(),
                                 [name for name in names if re.fullmatch(r'\d{8}', name)])
        target = card['target_date']
        stage_card(card, args.run_key, output, ref)
    official_card(card, races)
    lineups_refreshed=False
    if not collected and mode=='publish' and 'data-contest-odds="true"' not in card['html']:
        require(now.astimezone(JST).date().isoformat()<=target,'Refusing to refresh archived lineups')
        card,races=refresh_lineups(card)
        stage_card(card,args.run_key,output,ref)
        lineups_refreshed=True
    publish_pages = mode != 'odds' or collected
    odds_stats = {}
    odds_feed = saved_odds(ref, target)
    if (mode == 'odds' or migration) and should_collect(target, now, args.schedule if args.event == 'schedule' else ''):
        fresh, odds_stats = refresh(races, odds_feed)
        if odds_stats['observations']:
            run_path = ODDS_PREFIX + '/' + target.replace('-', '') + '/runs/' + args.run_key + '.json'
            require(git_read(ref, run_path, optional=True) is None, 'Immutable odds run already exists')
            stage_feed(fresh, target, args.run_key, output)
            odds_feed = {**fresh, 'target_date': target}
        else:
            print('All K Dreams odds reads failed; previous successful feed is unchanged', flush=True)
    if publish_pages:
        source = (ROOT / 'site/index.html').read_text()
        materialize = (collected or lineups_refreshed or page_date(source) != target.replace('-', '')
                       or any(identity(r['source'])['provider'] != PROVIDER for r in parse_page(source)))
        if materialize:
            materialize_card(card, ROOT / 'site')
        current_races = parse_page((ROOT / 'site/index.html').read_text())
        official_card(card, current_races)
        dated = ROOT / 'site' / ('line' + target.replace('-', '') + '.html')
        # Assets stay bound to the source record, including stable JKA IDs.
        marks_path = dated / 'rakuten-marks.json'
        identities_path = dated / 'rider-identities.json'
        details_path=dated/'rider-details.json'
        marks = validate_marks(json.loads(marks_path.read_text()), current_races, target)
        identities = validate_identities(json.loads(identities_path.read_text()), current_races, target)
        marks_path.write_text(encode(marks))
        identities_path.write_text(encode(identities))
        if details_path.exists():
            validate_details(json.loads(details_path.read_text()),current_races,target)
        else:
            require(now.astimezone(JST).date().isoformat()<=target,'Refusing to add new details to an archived card')
            details_raw=git_read(ref,'fallback/details/'+target.replace('-','')+'/latest.json',optional=True)
            details=(validate_details(json.loads(details_raw),current_races,target) if details_raw
                     else collect_details(current_races,target))
            if not details_raw:
                details_run='fallback/details/'+target.replace('-','')+'/runs/'+args.run_key+'.json'
                require(git_read(ref,details_run,optional=True) is None,'Immutable details run already exists')
                stage_details(details,args.run_key,output)
            details_path.write_text(encode(details))
        # Validate the complete exported page before advancing either shared
        # card pointers or the main branch. A rejected layout keeps both old
        # published records intact.
        report = export(ROOT / 'site', ROOT / 'public', repository)
        local_odds = args.work / 'display-odds.json'
        local_odds.write_text(encode(odds_feed) if odds_feed else card['assets']['odds.json'])
        report['local_odds_file'] = str(local_odds)
    else:
        report = {'target_date': target, 'database_writes': 0}
    feed_commit = publish_feed(output, ref, args.work, repository) if (output / 'fallback').exists() else None
    if publish_pages:
        git('add', '--', 'site')
        if git('status', '--porcelain', '--', 'site'):
            git('commit', '-m', 'Update official public card ' + target + ' [skip ci]')
            git('push', 'origin', 'HEAD:main')
    report.update({'mode': mode, 'publish_pages': publish_pages, 'feed_commit': feed_commit,
                   'source_commit': git('rev-parse', 'HEAD'), 'source_providers': card['summary'].get('source_providers',[PROVIDER]),
                   'provider_migration': migration, 'lineups_refreshed':lineups_refreshed, 'odds': odds_stats})
    (args.work / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
            handle.write('publish=' + str(publish_pages).lower() + '\n')
    print('OFFICIAL PUBLIC UPDATE READY', json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
