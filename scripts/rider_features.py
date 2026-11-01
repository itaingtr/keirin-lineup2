"""Opt current and future cards into shared condition notes and official media links."""
import re
from render_races import script_json
from published_card import parse_page
from rider_identities import validate_identities


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
    new='''<button type="button" class="car condition-car c'+n+(contestPosition?' contest-'+contestPosition:'')+'" data-race-id="'+conditionRaceId(r)+'" data-player-id="'+p.playerId+'" data-race-date="'+conditionDate+'" data-player-name="'+escapeHtml(p.name)+'" aria-label="'+escapeHtml(p.name+'の調子を変更')+'" title="押すたびに調子1〜5">'+n+'</button>'''
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
    page=page.replace('</head>','<link rel="stylesheet" href="/keirin-lineup2/rider-condition.css?v=20261102"></head>',1)
    page=page.replace('</body>','<script src="/keirin-lineup2/rider-condition.js?v=20261102" defer></script></body>',1)
    return page,races
