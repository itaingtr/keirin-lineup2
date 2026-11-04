from urllib.request import urlopen, Request
from html.parser import HTMLParser
import re
for p in ['/sp/static/js/SJ0201.js','/sp/raceschedule?cmdYearval=2026&cmdDayval=12','/pc/raceschedule?scyy=2027&scym=04']:
    print('PAGE',p)
    with urlopen(Request('https://keirin.jp'+p,headers={'User-Agent':'Mozilla/5.0'}),timeout=40) as r:
        html=r.read().decode('utf-8')
    if p.endswith('.js'):print(html)
    else:
        print('SELECTED',re.findall(r'<option[^>]*selected[^>]*>[^<]*',html))
        print('PERIODS',re.findall(r'\d\d/\d\d[^<]{0,40}',html)[:15])
        print('CELLS',re.findall(r'<td[^>]*(?:class="[^"]*(?:grade|kikan|stadium)[^"]*")[^>]*>[\s\S]*?</td>',html)[:10])
        print('NO MEETING',html.count('開催がありません'))
