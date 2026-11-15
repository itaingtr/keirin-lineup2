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
  function sortValue(player,key){
    if(key==='score')return scoreOf(player);
    if(key==='prefecture'){const index=PREFECTURES.indexOf(prefectureOf(player));return index<0?null:index;}
    return numeric(player[key]);
  }
  function sortPlayers(players,sorts=[]){
    const priorities=[...sorts].reverse();
    if(!priorities.some(sort=>sort.key==='score'))priorities.push({key:'score',direction:'desc'});
    return [...players].sort((a,b)=>{
      for(const {key,direction}of priorities){
        const first=sortValue(a,key),second=sortValue(b,key);
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
    // The requested threshold is inclusive: even exactly 50 riders get two
    // balanced pages, retaining every rider instead of truncating at 50.
    const total=rows.length,pageCount=total>=50?2:1,perPage=Math.ceil(total/pageCount);
    const page=Math.min(pageCount-1,Math.max(0,Number(state.page)||0));
    const start=page*perPage,end=Math.min(total,start+perPage);
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
  const api={normalize,findPlayers,samePerson,mergeMeetings,resultRows,REGIONS,PREFECTURES,SORT_LABELS,prefectureOf,regionOf,scoreOf,roleOf,cycleSort,sortPlayers,directory};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RiderSearch=api;
})(typeof window==='object'?window:globalThis);
