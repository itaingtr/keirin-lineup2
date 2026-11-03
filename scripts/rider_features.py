"""Opt current and future cards into shared condition notes and official media links."""
import re
from render_races import script_json
from published_card import parse_page
from rider_identities import validate_identities

APPEARANCE_CUTOVER = '20261103'
APPEARANCE_STYLE = '''<style id="rider-appearance-style">
.lineup .stat-b,.lineup .stat-b-zero{font-size:10px;font-weight:400}
.lineup .meeting-back{font-weight:400}
.lineup .meeting-time{font-size:8px}
.lineup .condition-history,.lineup .condition-today,
.lineup .condition-history.is-negative,.lineup .condition-today.is-negative{color:#d32f2f;font-size:8px;font-weight:400}
.condition-note strong,.condition-note .condition-negative{color:#d32f2f;font-weight:400}
.condition-message:not(.is-error){color:#d32f2f}
.table-wrap .contest-pair::before,.table-wrap .contest-pair::after{top:27px}
.table-wrap .lineup-odds-visible .contest-pair::before,.table-wrap .lineup-odds-visible .contest-pair::after{top:62px}
</style>'''


def rider_appearance(page):
    s='''<span class="recent-s">'+p.stats[0]+'</span>'''
    period='''<span class="period">'+p.period+'</span>'''
    if page.count(s)!=1 or page.count(period)!=1 or len(re.findall(r'<body\b[^>]*>',page))!=1:
        raise ValueError('Rider appearance renderer differs')
    page=page.replace(s,'',1).replace(period,period+s,1)
    page=re.sub(r'<body\b','<body data-rider-appearance="red"',page,count=1)
    page=page.replace('</head>',APPEARANCE_STYLE+'</head>',1)
    return page.replace('rider-condition.js?v=20261102-signed','rider-condition.js?v=20261103-appearance')


def rider_features(page, day, identities):
    target=day[:4]+'-'+day[4:6]+'-'+day[6:]
    races=parse_page(page)
    validate_identities(identities,races,target)
    mapped={row['source_url']:{p['no']:p['player_id'] for p in row['players']}
            for row in identities['races']}
    for race in races:
        for player in race['players']:
            player['playerId']=mapped[race['source']][player['no']]
    page=re.sub(r'const races=(.*);\nconst body=',lambda _: 'const races='+script_json(races)+';\nconst body=',page,count=1)
    old="function liveUrl(r){ return 'https://www.winticket.jp/keirin/'+r.venueSlug+'/live'; }"
    new="""const conditionDate='"""+target+"""';
function conditionRaceId(r){return String(r.race).padStart(2,'0')+r.venueCode+conditionDate.replaceAll('-','');}
function resultUrl(r){return 'https://keirin.kdreams.jp'+r.commentKey+'?pageType=showResult';}
function liveUrl(r){return 'https://keirin.kdreams.jp/stadium/live/?'+new URLSearchParams({kyogijoCd:r.venueCode,'l-id':'Livebroadcast'}).toString();}"""
    if page.count(old)!=1:raise ValueError('Live URL renderer is missing')
    page=page.replace(old,new,1)
    old='>▶ 映像を見る</a><a class="video-link live-link"'
    new='''>映像</a><a class="video-link result-link" href="'+escapeHtml(resultUrl(r))+'" data-source-url="'+resultUrl(r)+'" target="_self" title="楽天Kドリームスのこのレースの結果を開きます">結果</a><a class="video-link live-link"'''
    if page.count(old)!=1:raise ValueError('Media action renderer is missing')
    page=page.replace(old,new,1)
    old='''<span class="car c'+n+(contestPosition?' contest-'+contestPosition:'')+'">'+n+'</span>'''
    new='''<button type="button" class="car condition-car c'+n+(contestPosition?' contest-'+contestPosition:'')+'" data-race-id="'+conditionRaceId(r)+'" data-player-id="'+p.playerId+'" data-race-date="'+conditionDate+'" data-player-name="'+escapeHtml(p.name)+'" aria-label="'+escapeHtml(p.name+'の調子を変更')+'" title="押す順番は1〜5、-2、-1、0。0は表示なし">'+n+'</button>'''
    if page.count(old)!=1:raise ValueError('Rider car renderer is missing')
    page=page.replace(old,new,1)
    old="+meetingMarkup(p,r)+'</div>'"
    new="""+meetingMarkup(p,r)+'<span class="condition-today" data-race-id="'+conditionRaceId(r)+'" data-player-id="'+p.playerId+'" data-race-date="'+conditionDate+'" aria-label="今日の調子" role="status"></span></div>'"""
    if page.count(old)!=1:raise ValueError('Current condition position is missing')
    page=page.replace(old,new,1)
    old='''<div class="meeting-result" data-meeting-day="'+day+'"><a class="meeting-order"'''
    new='''<div class="meeting-result" data-meeting-day="'+day+'"><div class="meeting-order-line"><a class="meeting-order"'''
    if page.count(old)!=1:raise ValueError('Previous result renderer is missing')
    page=page.replace(old,new,1)
    old="+'</a><span class=\"meeting-time\""
    new='''+'</a><span class="condition-history" data-race-id="'+result.race_id+'" data-player-id="'+p.playerId+'" data-race-date="'+result.race_date+'" aria-label="その日の調子"></span></div><span class="meeting-time"'''
    if page.count(old)!=1:raise ValueError('Previous condition position is missing')
    page=page.replace(old,new,1)
    page=page.replace('/comments.js?', '/comments-passphrase.js?')
    page=page.replace('</head>','<link rel="stylesheet" href="/keirin-lineup2/rider-condition.css?v=20261102-original-lineup"></head>',1)
    page=page.replace('</body>','<script src="/keirin-lineup2/rider-condition.js?v=20261102-signed" defer></script></body>',1)
    if day>=APPEARANCE_CUTOVER:page=rider_appearance(page)
    return page,races
