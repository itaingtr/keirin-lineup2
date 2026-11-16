(function(root){
  'use strict';
  const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  function findPlayers(players,query){const key=normalize(query);if(!key)return[];return players.filter(p=>normalize(p.name).includes(key)||p.player_id===key);}
  function samePerson(a,b){return a.player_id===b.player_id && normalize(a.name)===normalize(b.name) && String(a.period)===String(b.period);}
  const REGIONS=[
    {name:'北日本',prefectures:['北海道','青森','岩手','宮城','秋田','山形','福島']},
    {name:'関東',prefectures:['茨城','栃木','群馬','埼玉','東京','新潟','長野','山梨']},
    {name:'南関東',prefectures:['千葉','神奈川','静岡']},
    {name:'中部',prefectures:['愛知','岐阜','三重','富山','石川']},
    {name:'近畿',prefectures:['福井','滋賀','京都','大阪','兵庫','奈良','和歌山']},
    {name:'中国',prefectures:['鳥取','島根','岡山','広島','山口']},
    {name:'四国',prefectures:['徳島','香川','愛媛','高知']},
    {name:'九州',prefectures:['福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄']},
  ];
  const PREFECTURES=['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];
  const SORT_LABELS={score:'得点',period:'期別',age:'年齢',prefecture:'県順'};
  function prefectureOf(player){const value=normalize(player.prefecture);return PREFECTURES.includes(value)?value:value.replace(/[都府県]$/,'');}
  function regionOf(player){const prefecture=prefectureOf(player);return REGIONS.find(region=>region.prefectures.includes(prefecture))?.name||null;}
  function numeric(value){return value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))?Number(value):null;}
  function jstDay(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
  function birthdayState(player,today=jstDay()){
    const birth=player.birth_date;
    if(typeof birth!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(Date.parse(birth))||new Date(birth).toISOString().slice(0,10)!==birth||birth>today)return {age:numeric(player.age),done:false};
    const year=Number(today.slice(0,4)),month=Number(birth.slice(5,7)),day=Number(birth.slice(8,10));
    const anniversary=anniversaryYear=>{
      const last=new Date(Date.UTC(anniversaryYear,month,0)).getUTCDate();
      return anniversaryYear+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
    };
    const current=anniversary(year),age=year-Number(birth.slice(0,4))-(today<current?1:0);
    const fiscalYear=today.slice(5)>='04-01'?year:year-1;
    const fiscalBirthday=anniversary(month>=4?fiscalYear:fiscalYear+1);
    if(age<0||age>120)return {age:numeric(player.age),done:false};
    return {age,done:today.slice(5)!=='04-01'&&fiscalBirthday<=today};
  }
  function ageOf(player,today=jstDay()){return birthdayState(player,today).age;}
  const COUNT_FIELDS=[['s','S'],['b','B'],['nige','逃'],['makuri','捲'],['sashi','差'],['mark','マ'],['total_starts','総']];
  function countsOf(player,profile=null){
    const checked=profile?.counts||player.counts;
    if(checked)return {...checked,values:Object.fromEntries(COUNT_FIELDS.map(([key])=>[key,numeric(checked.values?.[key])]))};
    const saved=player.last_card;
    if(Array.isArray(saved?.stats)&&saved.stats.length===6)return {scope:'直近4か月',provider:'kdreams',source_url:saved.source_url,observed_at:saved.observed_at,card_date:saved.date,
      values:{...Object.fromEntries(COUNT_FIELDS.slice(0,6).map(([key],i)=>[key,numeric(saved.stats[i])])),total_starts:numeric(saved.total_starts)}};
    const summary=profile?.summary||player.summary;
    return {scope:'直近4か月',provider:'keirin.jp',values:{s:null,b:numeric(summary?.back),nige:null,makuri:null,sashi:null,mark:null,total_starts:numeric(summary?.total_starts)}};
  }
  function gradeName(code){return ({1:'F2',2:'F1',3:'G3',4:'G2',5:'G1',6:'GP'})[code]||'';}
  function shortVenue(meeting){
    const venue=meeting.venue||meeting.venue_label||'';
    return ({'いわき平':'平','松戸':'戸','小田原':'小','小倉':'倉','小松島':'小松','西武園':'園'})[venue]||[...venue][0]||'—';
  }
  function previousSlots(player){
    const meetings=[...(player.recent_meetings||[])].sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||'')).slice(-2);
    if(meetings.length===2)return meetings;
    if(meetings.length===1)return meetings[0].position==='previous_previous'?[meetings[0],null]:[null,meetings[0]];
    return [null,null];
  }
  function scoreOf(player){return numeric(player.last_card?.score_raw??player.score_raw);}
  function roleOf(player){
    const style=normalize(player.style);
    if(['逃','両','追'].includes(style))return {kind:style==='追'?'chaser':'self',label:style==='追'?'追込型':'自力型',basis:'公式脚質 '+style,inferred:false};
    const stats=player.last_card?.stats;
    if(Array.isArray(stats)&&stats.length===6&&stats.every(value=>numeric(value)!==null)){
      if(Number(stats[1])+Number(stats[2])+Number(stats[3])>0)return {kind:'self',label:'自力型',basis:'保存済みのB・逃・捲による目安',inferred:true};
      if(Number(stats[4])+Number(stats[5])>0)return {kind:'chaser',label:'追込型',basis:'保存済みの差・マによる目安',inferred:true};
    }
    return {kind:null,label:'型不明',basis:'脚質・決まり手が未確認',inferred:false};
  }
  function cycleSort(sorts,key){
    if(!Object.hasOwn(SORT_LABELS,key))return sorts;
    const current=sorts.find(sort=>sort.key===key),rest=sorts.filter(sort=>sort.key!==key);
    const direction=!current?'asc':current.direction==='asc'?'desc':null;
    return direction?[...rest,{key,direction}]:rest;
  }
  function sortValue(player,key,today){
    if(key==='score')return scoreOf(player);
    if(key==='prefecture'){const index=PREFECTURES.indexOf(prefectureOf(player));return index<0?null:index;}
    if(key==='age')return ageOf(player,today);
    return numeric(player[key]);
  }
  function sortPlayers(players,sorts=[]){
    const today=jstDay();
    const priorities=[...sorts].reverse();
    if(!priorities.some(sort=>sort.key==='score'))priorities.push({key:'score',direction:'desc'});
    return [...players].sort((a,b)=>{
      for(const {key,direction}of priorities){
        const first=sortValue(a,key,today),second=sortValue(b,key,today);
        if(first===null||second===null){if(first!==second)return first===null?1:-1;continue;}
        if(first!==second)return (first-second)*(direction==='desc'?-1:1);
      }
      return String(a.player_id).localeCompare(String(b.player_id));
    });
  }
  function directory(players,state={}){
    const {region='',role='',sorts=[],query='',all=false}=state;
    let rows=players.filter(player=>(!region||regionOf(player)===region)&&(!role||roleOf(player).kind===role));
    if(normalize(query))rows=findPlayers(rows,query);
    const home=!region&&!role&&!sorts.length&&!normalize(query)&&!all;
    if(home)rows=rows.filter(player=>scoreOf(player)!==null);
    rows=sortPlayers(rows,sorts);
    const scopeTotal=rows.length;
    if(home)rows=rows.slice(0,30);
    // Keep the first 200 together; the second page contains only the overflow.
    const total=rows.length,pageCount=total>200?2:1,perPage=200;
    const page=Math.min(pageCount-1,Math.max(0,Number(state.page)||0));
    const start=page*perPage,end=page===0?Math.min(total,perPage):total;
    return {rows:rows.slice(start,end),total,scopeTotal,home,page,pageCount,start:total?start+1:0,end};
  }
  function mergeMeetings(stock,profile){
    if(!profile?.meetings?.length)return (stock?.meetings||[]).slice(-10).reverse();
    const merged=profile.meetings.slice(-10).reverse().map(meeting=>{
      const matches=(stock?.meetings||[]).filter(old=>old.start_date===meeting.start_date && old.grade_code===meeting.grade_code
        && old.days.length===meeting.days.length && old.days.every((day,i)=>day.order===meeting.days[i].order && (day.accident||'')===(meeting.days[i].accident||''))
        && (old.venue===meeting.venue || old.venue?.startsWith(meeting.venue_label||meeting.venue) || old.venue==='いわき平' && meeting.venue==='平'));
      return matches.length===1?matches[0]:meeting;
    });
    // Public profiles can lag a checked card. Keep newer stored meetings
    // instead of losing them when the profile has not caught up yet.
    const newest=merged.reduce((value,m)=>m.start_date>value?m.start_date:value,'');
    for(const meeting of stock?.meetings||[])if(meeting.start_date>newest)merged.push(meeting);
    return merged.sort((a,b)=>b.start_date.localeCompare(a.start_date)).slice(0,10);
  }
  function resultRows(player,meetings){return meetings.flatMap(meeting=>meeting.days.map((day,i)=>({
    player_id:player.player_id,name:player.name,meeting_start:meeting.start_date,venue:meeting.venue,
    slot:day.slot??i+1,race_date:day.race_date??null,race_number:day.race_number??null,race_id:day.race_id??null,
    order:day.order,accident:day.accident||'',accident_name:day.accident_name||'',final_half_record:day.final_half_record??null,
    start:day.start??null,home:day.home??null,back:day.back??null,race_date_inferred:day.race_date_inferred??null,
    provider:day.provider||meeting.provider,source_url:day.source_url||meeting.rank_source?.url||player.source_url||player.profile_url,
    observed_at:day.observed_at||meeting.rank_source?.observed_at||player.observed_at,video_url:day.video_url??null})));}
  const api={normalize,findPlayers,samePerson,mergeMeetings,resultRows,REGIONS,PREFECTURES,SORT_LABELS,prefectureOf,regionOf,scoreOf,roleOf,cycleSort,sortPlayers,directory,jstDay,birthdayState,ageOf,COUNT_FIELDS,countsOf,gradeName,shortVenue,previousSlots};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RiderSearch=api;
})(typeof window==='object'?window:globalThis);
