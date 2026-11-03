"""Inspect anonymous official result fields without saving HTML or session data.

This is a diagnostic, not a production data provider. An accessible page alone
does not establish collection or redistribution permission.
"""
import argparse
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener


HOSTS = {'keirin.jp', 'www.keirin.jp'}


def check_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in HOSTS
            or parsed.username or parsed.password or parsed.port or parsed.fragment
            or not parsed.path.startswith('/pc/')):
        raise ValueError('Unexpected official result URL')


class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def embedded(page, key):
    match = re.search(r'jsonData\[[\'\"]' + re.escape(key) + r'[\'\"]\]\s*=\s*', page)
    if match is None:
        return None
    return json.JSONDecoder().raw_decode(page[match.end():].lstrip())[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True)
    parser.add_argument('--code', required=True)
    parser.add_argument('--race', type=int, required=True)
    args = parser.parse_args()
    datetime.strptime(args.date, '%Y%m%d')
    if not re.fullmatch(r'\d{2}', args.code) or not 1 <= args.race <= 12:
        raise ValueError('Invalid public race identity')
    opener = build_opener(OfficialRedirect(), HTTPCookieProcessor(CookieJar()))

    def read(url, referer=None):
        check_url(url)
        headers = {'User-Agent': 'KeirinLineup2/1.0', 'Accept': 'text/html,application/json'}
        if referer:
            headers['Referer'] = referer
        with opener.open(Request(url, headers=headers), timeout=25) as response:
            check_url(response.url)
            raw = response.read(6_000_001)
            if len(raw) > 6_000_000:
                raise ValueError('Official response exceeds size limit')
            return raw.decode(response.headers.get_content_charset() or 'utf-8')

    # Follow the ordinary anonymous page flow. Cookies remain only in memory.
    top = 'https://keirin.jp/pc/top'
    read(top)
    program_url = 'https://keirin.jp/pc/dfw/dataplaza/guest/raceprogram?' + urlencode(
        {'KCD': args.code, 'KST': args.date})
    page = read(program_url, top)
    program = embedded(page, 'PC0201')
    if not isinstance(program, dict):
        raise ValueError('Official program JSON is unavailable')
    data = program.get('C0201data')
    if not isinstance(data, dict):
        raise ValueError('Official program data is unavailable')
    races = data.get('C0201race')
    if not isinstance(races, list) or len(races) < args.race:
        raise ValueError('Requested official race is unavailable')
    navigation = races[args.race - 1].get('encParaR')
    if not isinstance(navigation, str) or not navigation or len(navigation) > 2000:
        raise ValueError('Official public race navigation is unavailable')
    result_url = 'https://keirin.jp/pc/json?' + urlencode({'type': 'JSJ012', 'encp': navigation})
    payload = json.loads(read(result_url, program_url))
    if not isinstance(payload, dict):
        raise ValueError('Official result is not an object')
    fields = ('tyaku', 'syaban', 'sensyuRegistNo', 'sensyuName', 'sotugyouki',
              'agari', 'BH', 'S', 'H', 'B', 'kimarite', 'kojinStateItemSubData')
    rows = payload.get('tyakujyunItemSubData', [])
    if not isinstance(rows, list):
        raise ValueError('Official result rows are unavailable')
    print('KEIRIN JP PUBLIC RESULT ' + json.dumps({
        'provider': 'keirin.jp', 'date': args.date, 'code': args.code, 'race': args.race,
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'program_fields': sorted(data),
        'program_identity': {k: data.get(k) for k in ('joName', 'selKaisai', 'naibuKeirinCd')},
        'result_fields': sorted(payload),
        'row_fields': sorted(set().union(*(set(row) for row in rows))) if rows else [],
        'rows': [{k: row[k] for k in fields if k in row} for row in rows],
    }, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
