"""Venue identities used for source validation and official WINTICKET links."""
from datetime import date, timedelta
import re
from urllib.parse import urlsplit
VENUES = {
    '11': ('函館', 'hakodate'), '12': ('青森', 'aomori'), '13': ('いわき平', 'iwakidaira'),
    '21': ('弥彦', 'yahiko'), '22': ('前橋', 'maebashi'), '23': ('取手', 'toride'),
    '24': ('宇都宮', 'utsunomiya'), '25': ('大宮', 'omiya'), '26': ('西武園', 'seibuen'),
    '27': ('京王閣', 'keiokaku'), '28': ('立川', 'tachikawa'), '31': ('松戸', 'matsudo'),
    '32': ('千葉', 'chiba'), '34': ('川崎', 'kawasaki'), '35': ('平塚', 'hiratsuka'),
    '36': ('小田原', 'odawara'), '37': ('伊東', 'ito'), '38': ('静岡', 'shizuoka'),
    '42': ('名古屋', 'nagoya'), '43': ('岐阜', 'gifu'), '44': ('大垣', 'ogaki'),
    '45': ('豊橋', 'toyohashi'), '46': ('富山', 'toyama'), '47': ('松阪', 'matsusaka'),
    '48': ('四日市', 'yokkaichi'), '51': ('福井', 'fukui'), '53': ('奈良', 'nara'),
    '54': ('向日町', 'mukomachi'), '55': ('和歌山', 'wakayama'), '56': ('岸和田', 'kishiwada'),
    '61': ('玉野', 'tamano'), '62': ('広島', 'hiroshima'), '63': ('防府', 'hofu'),
    '71': ('高松', 'takamatsu'), '73': ('小松島', 'komatsushima'), '74': ('高知', 'kochi'),
    '75': ('松山', 'matsuyama'), '81': ('小倉', 'kokura'), '83': ('久留米', 'kurume'),
    '84': ('武雄', 'takeo'), '85': ('佐世保', 'sasebo'), '86': ('別府', 'beppu'),
    '87': ('熊本', 'kumamoto'),
}


def identity(url):
    """Validate a provider URL; never relabel another provider's saved data."""
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or parsed.fragment:
        raise ValueError('Expected a public HTTPS source URL')
    if parsed.hostname == 'www.yen-joy.net' and not parsed.query:
        match = re.fullmatch(r'/kaisai/race/forecast/detail/(\d{6})/(\d{2})/(\d{8})/(\d{8})/(\d{1,2})/?', parsed.path)
        if not match:
            raise ValueError('Expected an Enjoy race forecast URL')
        month, code, start, day, number = match.groups()
        if month != start[:6]:
            raise ValueError('Invalid meeting month')
        provider = 'enjoy'
    elif parsed.hostname == 'www.winticket.jp' and not parsed.query:
        match = re.fullmatch(r'/keirin/([a-z]+)/racecard/(\d{8})(\d{2})/(\d)/(\d{1,2})/?', parsed.path)
        if not match:
            raise ValueError('Expected a WINTICKET race card URL')
        slug, start, code, meeting_day, number = match.groups()
        first = date.fromisoformat(f'{start[:4]}-{start[4:6]}-{start[6:]}')
        day = (first + timedelta(days=int(meeting_day)-1)).strftime('%Y%m%d')
        if code not in VENUES or VENUES[code][1] != slug:
            raise ValueError('Venue slug does not match source code')
        provider = 'winticket'
    else:
        raise ValueError('Only independently collected Enjoy or WINTICKET data is accepted')
    if code not in VENUES or not 1 <= int(number) <= 12:
        raise ValueError('Unknown venue or invalid race number')
    return {'provider': provider, 'code': code, 'start': start, 'date': day, 'race': int(number)}
