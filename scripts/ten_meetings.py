"""Read public KEIRIN.JP profile results for the isolated ten-meeting preview.

Profile navigation strings are never decoded, evaluated, or saved. Exact race
numbers and types are joined through the existing official daily entry client.
"""
from copy import deepcopy
from datetime import date,datetime,timedelta,timezone
from http.cookiejar import CookieJar
import re
import time
from urllib.error import HTTPError,URLError
from urllib.parse import parse_qsl,urlencode,urlsplit
from urllib.request import HTTPRedirectHandler,HTTPCookieProcessor,Request,build_opener

from keirin_jp_provider import OfficialClient,compact,program_url
from previous_presentation import highlight,semifinal
from source_http import Document,Node,cells
from venues import VENUES,identity

PROVIDER='keirin.jp'
GRADES={'F2':1,'F1':2,'G3':3,'G2':4,'G1':5,'GP':6}
ALIASES={
 '函':('11',),'青':('12',),'平':('13',),'弥':('21',),'前':('22',),'取':('23',),
 '宇':('24',),'宮':('25',),'西':('26',),'京':('27',),'閣':('27',),'立':('28',),
 '松':('31','47','75'),'戸':('31',),'千':('32',),'川':('34',),'塚':('35',),'小':('36','73'),
 '小田':('36',),'原':('36',),'伊':('37',),'静':('38',),'名':('42',),'岐':('43',),
 '垣':('44',),'豊':('45',),'富':('46',),'阪':('47',),'四':('48',),'井':('51',),
 '福':('51',),'奈':('53',),'向':('54',),'和':('55',),'岸':('56',),'玉':('61',),
 '広':('62',),'防':('63',),'高':('71',),'小松':('73',),'知':('74',),'山':('75',),
 '倉':('81',),'久':('83',),'武':('84',),'佐':('85',),'別':('86',),'熊':('87',),
}
for _code,(_name,_) in VENUES.items():ALIASES[_name]=(_code,)
ALIASES['いわき']=('13',)
ALIASES['島']=('73',)


def require(value,message):
    if not value:raise ValueError(message)


def profile_url(player_id):
    require(isinstance(player_id,str) and re.fullmatch(r'\d{6}',player_id),'Invalid official profile identity')
    return 'https://keirin.jp/pc/racerprofile?'+urlencode({'snum':player_id})


def check_profile_url(url):
    parsed=urlsplit(url);pairs=parse_qsl(parsed.query);query=dict(pairs)
    require(parsed.scheme=='https' and parsed.hostname in ('keirin.jp','www.keirin.jp')
            and not(parsed.username or parsed.password or parsed.port or parsed.fragment),
            'Unexpected official profile source')
    require((parsed.path=='/pc/top' and not query) or
            (parsed.path=='/pc/racerprofile' and len(pairs)==1 and set(query)=={'snum'}
             and re.fullmatch(r'\d{6}',query['snum'])),'Unexpected official profile path')
    return url


class ProfileRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        check_profile_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)


class ProfileReader:
    def __init__(self):
        self.opener=build_opener(ProfileRedirect(),HTTPCookieProcessor(CookieJar()))
        self.started=False

    def __call__(self,url):
        check_profile_url(url)
        if not self.started:
            self.started=True;self('https://keirin.jp/pc/top')
        for attempt in range(3):
            try:
                time.sleep(.2)
                request=Request(url,headers={'User-Agent':'KeirinLineup2/1.0','Accept':'text/html'})
                with self.opener.open(request,timeout=25) as response:
                    check_profile_url(response.url);raw=response.read(6_000_001)
                    require(len(raw)<=6_000_000,'Official profile exceeds size limit')
                    page=raw.decode(response.headers.get_content_charset() or 'utf-8')
                return Document(page).root,datetime.now(timezone.utc).isoformat()
            except (HTTPError,URLError,TimeoutError) as error:
                if attempt==2 or isinstance(error,HTTPError) and error.code not in (404,408,500,502,503,504):
                    raise ValueError('Official profile read failed: '+type(error).__name__) from None
                time.sleep((2,5)[attempt])


def _rows(table):
    def owner(node):
        parent=node.parent
        while parent and parent.tag!='table':parent=parent.parent
        return parent
    return [row for row in table.find_all('tr') if owner(row) is table]


def _verify_person(doc,player):
    names=[];periods=[];identifiers=[]
    for table in doc.find_all('table'):
        rows=_rows(table)
        for index,row in enumerate(rows[:-1]):
            headers=[compact(cell.visible_text()) for cell in cells(row)]
            values=[compact(cell.visible_text()) for cell in cells(rows[index+1])]
            if len(headers)!=len(values):continue
            for label,value in zip(headers,values):
                if label=='氏名':names.append(value)
                elif label=='登録番号':identifiers.append(value)
                elif label=='期別':periods.append(value)
    require(set(names)=={compact(player['name'])}
            and set(identifiers)=={player['playerId']}
            and set(periods)=={str(player['period'])+'期'},'Official profile name/registration/period differs')


def _past_date(label,before):
    label=compact(label);match=re.fullmatch(r'(\d{1,2})/(\d{1,2})',label)
    require(match is not None,'Unknown official profile meeting date')
    for year in (before.year,before.year-1):
        try:actual=date(year,int(match[1]),int(match[2]))
        except ValueError:continue
        if actual<=before:return actual
    raise ValueError('Invalid official profile meeting date')


def _rank(cell):
    badges=[node for node in cell.find_all('p') if 'imgbadge_s4' in node.attrs.get('class','').split()]
    require(len(badges)<=1,'Ambiguous official profile rank')
    if not badges:
        require(not any(n.attrs.get('onclick','').startswith('rbTyokinResultClick') for n in cell.find_all()),
                'Unrecognized official profile rank badge')
        return None
    label=compact(badges[0].attrs.get('title',''))
    if re.fullmatch(r'[1-9]',label):return int(label),''
    accidents={'欠':'欠','欠場':'欠','欠車':'欠','落':'落','落車':'落','落棄':'落','落再':'落',
               '落車棄権':'落','落車再入':'落','故':'故','故棄':'故','故再':'故','故障棄権':'故',
               '故障再入':'故','失':'失','失格':'失','棄':'棄','棄権':'棄','除':'除','除外':'除'}
    require(label in accidents,'Unknown official profile rank label')
    return 0,accidents[label]


def parse_profile(doc,player,before):
    """Read observed profile meeting cells; do not execute event handlers."""
    if isinstance(doc,str):doc=Document(doc).root
    _verify_person(doc,player)
    tables=[table for table in doc.find_all('table') if 'seiseki_kobetsu' in table.attrs.get('class','').split()]
    require(tables,'Official recent-meeting display is unavailable')
    output=[];seen=set()
    for table in tables:
        rows=_rows(table)
        require(len(rows)==2,'Official meeting result rows changed')
        headers=cells(rows[0]);require(len(headers)==2,'Official meeting headings changed')
        start=_past_date(headers[0].visible_text(),before)
        if start>=before:continue
        label=compact(headers[1].visible_text());match=re.fullmatch(r'(.+?)(F[12]|G[123]|GP)',label)
        require(match is not None and match[1] in ALIASES,'Unknown official venue/grade heading: '+label)
        venue,grade=match[1],GRADES[match[2]]
        require((venue,start) not in seen,'Duplicate official meeting');seen.add((venue,start))
        days=[]
        for index,cell in enumerate(cells(rows[1])):
            rank=_rank(cell)
            if rank is None:continue
            actual=start+timedelta(days=index)
            require(actual<before,'Previous official meeting is still in progress')
            days.append({'race_date':actual.isoformat(),'order':rank[0],'accident':rank[1],
                         'meeting_day':index+1})
        if days:
            output.append({'venue_label':venue,'venue_options':ALIASES[venue],'grade_code':grade,
                           'start_date':start.isoformat(),'days':days})
    return sorted(output,key=lambda item:item['start_date'])[-10:]


def collect(races,target,read=None,client=None):
    """Collect current riders' last ten completed official meetings, oldest first."""
    actual=date.fromisoformat(target);read=read or ProfileReader();client=client or OfficialClient()
    require(races,'Empty ten-meeting preview card')
    output=[];sources=[];profiles={};entries={};failed_entries=set()
    total=len({player.get('playerId') or player.get('player_id') for race in races for player in race['players']})
    def cards(code,raw):
        key=(code,raw)
        if key not in entries and key not in failed_entries:
            try:entries[key]=client.cards(code,raw)
            except ValueError:failed_entries.add(key)
            if (len(entries)+len(failed_entries))%25==0:
                print('OFFICIAL TEN ENTRIES',len(entries)+len(failed_entries),'venue-days checked',
                      len(failed_entries),'unavailable',flush=True)
        return entries.get(key)
    for race in races:
        ident=identity(race['source'])
        require(ident['provider']=='kdreams' and ident['date']==actual.strftime('%Y%m%d'),'Ten-meeting current source date/provider differs')
        before=date.fromisoformat(ident['start'][:4]+'-'+ident['start'][4:6]+'-'+ident['start'][6:])
        members=[]
        for original in race['players']:
            player=deepcopy(original);player_id=player.get('playerId') or player.get('player_id')
            player['playerId']=player_id;url=profile_url(player_id)
            key=(player_id,compact(player['name']),str(player['period']),before.isoformat())
            if key not in profiles:
                print('OFFICIAL TEN PROFILE START',len(profiles)+1,'/',total,flush=True)
                doc,observed=read(url);history=parse_profile(doc,player,before)
                sources.append({'provider':PROVIDER,'url':url,'observed_at':observed,'kind':'ten_meeting_profile'})
                for meeting in history:
                    candidate_codes=[];resolved={}
                    for code in meeting['venue_options']:
                        matching={}
                        for day in meeting['days']:
                            raw=day['race_date'].replace('-','');response=cards(code,raw)
                            if response is None:continue
                            rows,stamp=response
                            hits=[(number,row,entry) for number,row in rows.items() for entry in row['players'].values()
                                  if entry['player_id']==player_id]
                            require(len(hits)<=1,'Official historical rider appears in multiple races')
                            if hits:
                                number,row,entry=hits[0]
                                require(compact(entry['name'])==compact(player['name']) and str(entry['period'])==str(player['period']),
                                        'Official historical rider name/period differs')
                                matching[day['race_date']]=(number,row['race_type'],stamp)
                        if matching:candidate_codes.append(code);resolved[code]=matching
                    require(len(candidate_codes)<=1,'Ambiguous official historical venue')
                    require(candidate_codes or len(meeting['venue_options'])==1,'Official abbreviated venue could not be verified')
                    code=candidate_codes[0] if candidate_codes else meeting['venue_options'][0]
                    meeting['venue_code']=code;meeting['venue']=VENUES[code][0]
                    for day in meeting['days']:
                        match=resolved.get(code,{}).get(day['race_date'])
                        day.update(race_id=None,race_number=None,race_type='',video_url=None,player_id=player_id,
                                   provider=PROVIDER,race_date_inferred=match is None)
                        if match:
                            number,kind,stamp=match;raw=day['race_date'].replace('-','')
                            day.update(race_id=f'{number:02}{code}{raw}',race_number=number,race_type=kind,
                                       video_url='https://keirin.kdreams.jp/stadium/digest/?'+urlencode({
                                           'kyogijoCd':code,'kaisaiDate':raw,'gradeCd':meeting['grade_code'],'raceNo':number}),
                                       highlight_rank=highlight(kind,day['meeting_day']),semifinal_rank=semifinal(kind),
                                       race_type_source_url=program_url(code,raw),race_type_observed_at=stamp)
                    meeting.pop('venue_options');meeting.pop('venue_label')
                profiles[key]=history
            members.append({'no':player['no'],'name':player['name'],'period':player['period'],
                            'player_id':player_id,'meetings':deepcopy(profiles[key])})
        output.append({'source_url':race['source'],'players':members})
        print('OFFICIAL TEN MEETINGS',race.get('venue',''),ident['race'],'R',len(members),'riders',flush=True)
    sources.extend(getattr(client,'receipts',[]))
    return {'schema_version':1,'provider':PROVIDER,'target_date':target,'races':output,'sources':sources}
