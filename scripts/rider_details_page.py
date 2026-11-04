"""Opt verified current/future cards into compact expandable rider details."""
import re

from published_card import parse_page
from render_races import script_json
from venues import identity


DETAILS_STYLE = '''<style id="rider-details-style">
body[data-rider-details="true"] .meeting-order-line{font-size:8px;font-variant-numeric:tabular-nums;box-sizing:border-box;padding-left:calc((22px - 4ch)/2)}
body[data-rider-details="true"] .meeting-time{font-size:8px;font-variant-numeric:tabular-nums}
body[data-rider-details="true"] .meeting-time-value{display:block;width:4ch;margin-inline:auto;text-align:left}
body[data-rider-details="true"] .period-toggle{display:block;appearance:none;border:0;background:none;padding:0;margin:0;cursor:pointer;touch-action:manipulation;font-family:inherit}
body[data-rider-details="true"] .period-toggle:focus-visible{outline:1px solid #155eef;outline-offset:1px;border-radius:2px}
body[data-rider-details="true"] .rider-profile{display:block;width:22px;height:20px;color:#627086;font-size:8px;font-weight:400;line-height:10px;text-align:center;writing-mode:horizontal-tb;font-variant-numeric:tabular-nums}
body[data-rider-details="true"] .rider-profile[hidden]{display:none}
body[data-rider-details="true"] .rider-prefecture,body[data-rider-details="true"] .rider-age{display:block;width:22px;height:10px;line-height:10px;white-space:nowrap}
</style>'''

DETAILS_FUNCTIONS = '''const riderDetailsExpanded=new Set();
function riderDetailsKey(p,r){return r.source;}
function riderDetailsId(p,r){return 'rider-details-'+r.venueCode+'-'+r.meetingStart+'-'+r.meetingDay+'-'+r.race+'-'+p.playerId;}
function riderProfileMarkup(p,r){
 const key=riderDetailsKey(p,r),id=riderDetailsId(p,r),expanded=riderDetailsExpanded.has(key);
 return '<button type="button" class="period period-toggle" data-details-key="'+escapeHtml(key)+'" data-rider-name="'+escapeHtml(p.name)+'" aria-expanded="'+expanded+'" aria-controls="'+id+'" aria-label="'+escapeHtml(p.name+'の期別：このレース全員の府県と年齢を'+(expanded?'閉じる':'表示'))+'">'+p.period+'</button><span id="'+id+'" class="rider-profile"'+(expanded?'':' hidden')+'><span class="rider-prefecture" title="'+escapeHtml(p.prefecture)+'" aria-label="'+escapeHtml('府県 '+p.prefecture)+'">'+escapeHtml(Array.from(p.prefecture).slice(0,2).join(''))+'</span><span class="rider-age" aria-label="年齢 '+p.age+'歳">'+p.age+'</span></span>';
}
'''

DETAILS_EVENTS = '''body.addEventListener('click',event=>{
 const toggle=event.target.closest?.('.period-toggle');
 if(!toggle||!body.contains(toggle))return;
 event.preventDefault();
 const key=toggle.dataset.detailsKey,expanded=!riderDetailsExpanded.has(key);
 if(expanded)riderDetailsExpanded.add(key);else riderDetailsExpanded.delete(key);
 const row=toggle.closest('tr');
 for(const member of row.querySelectorAll('.period-toggle')){
  member.setAttribute('aria-expanded',String(expanded));
  member.setAttribute('aria-label',member.dataset.riderName+'の期別：このレース全員の府県と年齢を'+(expanded?'閉じる':'表示'));
  document.getElementById(member.getAttribute('aria-controls')).hidden=!expanded;
 }
 row.classList.toggle('rider-details-open',expanded);
});
'''


def apply_details(page, details):
    """Apply after official_page; return the page and its verified rider data.

    All disclosure state remains in memory. Neither opening a profile nor
    searching causes a new source request, database write or odds refresh.
    """
    from rider_details import validate_details

    races = parse_page(page)
    days = {identity(r['source'])['date'] for r in races}
    if len(days) != 1 or 'data-official-results="true"' not in page:
        raise ValueError('Rider details require one verified official card')
    day = days.pop(); target = day[:4]+'-'+day[4:6]+'-'+day[6:]
    validate_details(details, races, target)
    records = {r['source_url']: {p['no']: p for p in r['players']} for r in details['races']}
    for race in races:
        for player in race['players']:
            source = records[race['source']][player['no']]
            player['prefecture'], player['age'] = source['prefecture'], source['age']
    period = '''<span class="period">'+p.period+'</span>'''
    clock = '''>'+escapeHtml(time)+'</span></div>';'''
    row = '''shown.map(r=>'<tr id="race-'''
    old_listener = '''search.addEventListener("input",draw);'''
    expected = (period, clock, row, old_listener, 'function riderMarkup(n,r,contestPosition=""){')
    if (any(page.count(fragment) != 1 for fragment in expected)
            or 'rider-details-style' in page or len(re.findall(r'<body\b[^>]*>',page)) != 1):
        raise ValueError('Rider detail renderer differs')
    page = re.sub(r'const races=(.*);\nconst body=', lambda _: 'const races='+script_json(races)+';\nconst body=', page, count=1)
    page = page.replace(period, "'+riderProfileMarkup(p,r)+'", 1)
    page = page.replace(clock, '''><span class="meeting-time-value">'+escapeHtml(time)+'</span></span></div>';''', 1)
    page = page.replace('function riderMarkup(n,r,contestPosition=""){', DETAILS_FUNCTIONS+'function riderMarkup(n,r,contestPosition=""){', 1)
    page = page.replace(row, '''shown.map(r=>'<tr class="'+(r.players.some(p=>riderDetailsExpanded.has(riderDetailsKey(p,r)))?'rider-details-open':'')+'" id="race-''', 1)
    page = page.replace(old_listener, DETAILS_EVENTS+old_listener, 1)
    page = re.sub(r'<body\b', '<body data-rider-details="true"', page, count=1)
    return page.replace('</head>', DETAILS_STYLE+'</head>', 1), races
