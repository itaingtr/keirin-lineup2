"""Publish links to verified date pages and optional calendar static assets."""
from datetime import date
import json
from pathlib import Path
import re
import shutil

from published_card import parse_page
from venues import identity, VENUES


def require(condition, message):
    if not condition:
        raise ValueError(message)


def iso_day(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{8}', value), 'Use a compact calendar date')
    return date.fromisoformat(value[:4]+'-'+value[4:6]+'-'+value[6:])


def _has_anchor(page, fragment):
    # Race rows are normally built by the page's draw() function. Its ID
    # contract is also checked against the actual DOM in test_pages.cjs.
    renderer = 'id="race-\'+r.venueCode+\'-\'+r.race+\'"'
    return ('id="'+fragment+'"' in page or "id='"+fragment+"'" in page or renderer in page)


def _date_entry(output, compact_day, base):
    day = iso_day(compact_day)
    file = output / ('line'+compact_day+'.html')
    require(file.is_file() and not file.is_symlink(), 'Calendar date page has not been exported: '+compact_day)
    page = file.read_text()
    races = parse_page(page)
    href = base + file.name
    venues, seen = {}, set()
    for race in races:
        ident = identity(race['source'])
        number = race['race']; code = race['venueCode']
        require(ident['date'] == compact_day and code == ident['code']
                and type(number) is int and number == ident['race'], 'Calendar race date or identity differs')
        require(race['venue'] == VENUES[code][0], 'Calendar venue name differs')
        require((code, number) not in seen, 'Duplicate calendar race')
        seen.add((code, number))
        fragment = f'race-{code}-{number}'
        # Older archives predate venue-jump row IDs. Link to the date itself
        # rather than publish a fragment that cannot resolve on that page.
        venue_href = href+'#'+fragment if _has_anchor(page, fragment) else href
        key = (code, ident['start'])
        if key not in venues:
            venues[key] = {'name': race['venue'], 'code': code, 'first_race': number,
                           'race_count': 0, 'href': venue_href}
        venues[key]['race_count'] += 1
    return {'date': day.isoformat(), 'label': f'{day.month}月{day.day}日', 'href': href,
            'race_count': len(races), 'venues': list(venues.values())}


def _copy_calendar(site, destination):
    source = site / 'calendar'
    require(not destination.is_symlink(), 'Calendar output must be an ordinary directory')
    if destination.exists():
        require(destination.is_dir() and not any(p.is_symlink() for p in destination.rglob('*')),
                'Calendar output assets must not contain symlinks')
    if not source.exists() and not source.is_symlink():
        destination.mkdir(parents=True, exist_ok=True)
        return
    require(source.is_dir() and not source.is_symlink(), 'Calendar source must be an ordinary directory')
    nodes = sorted(source.rglob('*'))
    require(not any(p.is_symlink() for p in nodes), 'Calendar static assets must not contain symlinks')
    destination.mkdir(parents=True, exist_ok=True)
    for file in nodes:
        relative = file.relative_to(source)
        if relative.parts[0] == 'dates.json':
            # This public link index is always derived from exported pages.
            # A hand-written input may remain in source, but cannot replace it.
            require(file.is_file(), 'calendar/dates.json is reserved for the generated index')
            continue
        if not file.is_file():
            continue
        target = destination / relative
        require(not target.is_symlink(), 'Calendar output assets must not be symlinks')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)


def export_calendar(site, output, dates, current_day, base='/keirin-lineup2/'):
    """Write only calendar output; never edit source cards or their data.

    ``dates`` must be the successfully exported date list, rather than date
    selector options or a forecast of future race days. ``current_day`` is the
    top card's date and can be tomorrow after the nightly publication.
    """
    site, output = Path(site), Path(output)
    require(isinstance(base, str) and re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*', base), 'Unexpected public project base')
    dates = list(dates)
    require(dates and len(set(dates)) == len(dates), 'Calendar dates are empty or duplicated')
    for compact_day in dates:
        iso_day(compact_day)
    require(current_day in dates, 'Current calendar card has not been exported')
    days = [_date_entry(output, compact_day, base) for compact_day in sorted(dates)]
    manifest = {'schema_version': 1, 'site_base': base,
                'current_date': iso_day(current_day).isoformat(),
                'current_href': base+'line'+current_day+'.html', 'days': days}
    destination = output / 'calendar'
    _copy_calendar(site, destination)
    (destination / 'dates.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':'))+'\n')
    return manifest
