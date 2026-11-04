"""Read public official display fields and validate an isolated site export."""
import argparse
from datetime import date, datetime, timezone
import json
from pathlib import Path
import shutil

from export_pages import export, materialize_card
from kdreams_provider import collect_cards, collect_quote, fetch
from source_http import cells
from official_odds import blank_feed, refresh, should_collect
from official_publication import build_card, encode
from keirin_jp_provider import enrich_cards
from kdreams_history import enrich_start_flags

ROOT = Path(__file__).resolve().parents[1]


def diagnostic_reader():
    """Retain public semantic fields, never source markup, for parser failures."""
    seen = set()

    def read(url):
        read.last = {'url': url}
        try:
            doc, observed = fetch(url)
        except Exception as error:
            read.last['error'] = type(error).__name__ + ': ' + str(error)[:200]
            raise
        kind = 'calendar' if '/racecard/' in url else 'odds' if '?' in url else 'card'
        tables = []
        for table in doc.find_all('table'):
            names = table.attrs.get('class', '').split()
            if not any(name in names for name in ('racecard_table', 'raceinfo_table', 'odds_table')):
                continue
            rows = [row for row in table.find_all('tr')
                    if any('num' in cell.attrs.get('class', '').split() for cell in cells(row))]
            sample = rows[:1] if rows else list(table.find_all('tr'))[:2]
            tables.append({'class': table.attrs.get('class', ''),
                           'headers': [h.visible_text().strip()[:100] for h in table.find_all('th')][:45],
                           'sample_rows': [[{'class': c.attrs.get('class', ''),
                                            'text': c.visible_text().strip()[:180]}
                                           for c in cells(row)] for row in sample]})
        profiles = [{'href': a.attrs.get('href'), 'text': a.visible_text().strip()[:50]}
                    for a in doc.find_all('a') if 'athlete' in a.attrs.get('href', '')][:4]
        race_links = [a.attrs['href'] for a in doc.find_all('a')
                      if '/racedetail/' in a.attrs.get('href', '')][:16]
        lineups = [{'class': n.attrs.get('class', ''), 'text': n.visible_text().strip()[:100],
                    'child_classes': [c.attrs.get('class', '') for c in n.find_all()][:30]}
                   for n in doc.find_all() if 'line_position' in n.attrs.get('class', '').split()][:1]
        read.last = {'url': url, 'observed_at': observed,
                     'title': next((n.text() for n in doc.find_all('title')), ''),
                     'tables': tables, 'profile_links': profiles, 'race_links': race_links, 'lineup': lineups}
        if kind not in seen:
            seen.add(kind)
            read.describe_last()
        return doc, observed

    read.last = {}
    read.describe_last = lambda: print('SOURCE STRUCTURE', json.dumps(read.last, ensure_ascii=False), flush=True)
    return read


def verify_collection(target, output, *, source_site=ROOT / 'site', collector=collect_cards,
                      quote_collector=collect_quote, quote_limit=2, now=None, diagnostics=False):
    """No Git, database, feed-pointer or production-site mutation occurs here."""
    date.fromisoformat(target)
    if type(quote_limit) is not int or not 0 <= quote_limit <= 2:
        raise ValueError('Verify at most two official quotes')
    output, source_site = Path(output).resolve(), Path(source_site).resolve()
    if output == source_site or output in source_site.parents or source_site in output.parents:
        raise ValueError('Verification output must be separate from the source site')
    if any(path.is_symlink() for path in source_site.rglob('*')):
        raise ValueError('Verification source site must contain ordinary static files')
    output.mkdir(parents=True, exist_ok=True)
    preview_site, public = output / 'site', output / 'public'
    # Refuse reuse rather than mixing this observation with a previous run.
    if preview_site.exists() or public.exists() or (output / 'dataset.json').exists():
        raise ValueError('Use a fresh verification output directory')
    if diagnostics:
        read = diagnostic_reader()
        if collector is collect_cards:
            collector = lambda day: collect_cards(day, read=read)
        if quote_collector is collect_quote:
            quote_collector = lambda race: collect_quote(race, read=read)
    try:
        dataset = enrich_start_flags(enrich_cards(collector(target)))
    except Exception:
        if diagnostics:
            read.describe_last()
        raise
    # Only normalized public display records and their receipt metadata leave
    # the parser. Source HTML and credentials never form part of this artifact.
    display = {key: dataset[key] for key in ('schema_version', 'provider', 'target_date',
               'expected_races', 'races', 'excluded_meetings') if key in dataset}
    display['sources'] = [{key: row[key] for key in ('url', 'provider', 'observed_at')}
                          for row in dataset.get('sources', [])]
    display['history_sources'] = dataset.get('history_sources',[])
    (output / 'dataset.json').write_text(encode(display))
    checked_at = datetime.now(timezone.utc).isoformat()
    card, races = build_card(display, checked_at,
                             [p.name[4:12] for p in source_site.glob('line????????.html') if p.is_dir()])
    shutil.copytree(source_site, preview_site)
    materialize_card(card, preview_site)
    report = export(preview_site, public)
    now = now or datetime.now(timezone.utc)
    feed = blank_feed(races, target, checked_at)
    quote_stats = {}
    attempted = 0
    if quote_limit and should_collect(target, now):
        selected = races[:quote_limit]
        quotes, quote_stats = refresh(selected, collector=quote_collector, pause=1)
        by_key = {row.get('snapshot', {}).get('race_key', row.get('race_key')): row
                  for row in quotes['results']}
        feed['results'] = [by_key.get(row['snapshot']['race_key'], row) for row in feed['results']]
        feed['checked_at'] = quotes['checked_at']
        attempted = len(selected)
        if quote_stats['observations'] != attempted:
            (output / 'odds.json').write_text(encode(feed))
            if diagnostics:
                read.describe_last()
            raise ValueError('Live verification failed to validate every attempted official quote')
    local_odds = output / 'odds.json'
    local_odds.write_text(encode(feed))
    report.update({'public_dir': str(public), 'local_odds_file': str(local_odds),
                   'dataset_file': str(output / 'dataset.json'),
                   'source_providers': card['summary']['source_providers'], 'source_reads': len(display['sources'])+len(display['history_sources']),
                   'quotes_attempted': attempted, 'quotes': quote_stats,
                   'quote_check': 'checked' if attempted else 'outside_race_day_window_or_disabled',
                   'database_writes': 0, 'github_writes': 0})
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('SOURCE COLLECTION', json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--site-dir', type=Path, default=ROOT / 'site')
    parser.add_argument('--quote-limit', type=int, choices=(0, 1, 2), default=2)
    parser.add_argument('--diagnostics', action='store_true')
    args = parser.parse_args()
    try:
        verify_collection(args.date, args.output, source_site=args.site_dir, quote_limit=args.quote_limit,
                          diagnostics=args.diagnostics)
    except Exception as error:
        print('SOURCE COLLECTION', json.dumps({'target_date': args.date, 'ok': False,
              'error': type(error).__name__ + ': ' + str(error)[:300],
              'database_writes': 0, 'github_writes': 0}, ensure_ascii=False), flush=True)
        raise


if __name__ == '__main__':
    main()
