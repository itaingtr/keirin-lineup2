(()=>{
  'use strict';
  const M=window.RiderSearch,D=window.DailyResults,base=new URL('../',location.href),$=id=>document.getElementById(id);
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=String(text);return node;};
  let players=[],selected=null,token=0,queryTimer;
  let browse={region:'',role:'',sorts:[],all:false,page:0};
  const snapshots=new Map(),profiles=new Map();
  async function json(path,sha){
    const key=path+':'+sha;if(sha&&snapshots.has(key))return snapshots.get(key);
    const pending=(async()=>{
      const url=new URL(path,base);
      if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw new Error('参照先が違います');
      const response=await fetch(url,{cache:sha?'default':'no-store',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('資料を読み込めません');
      const bytes=await response.arrayBuffer();
      if(sha){const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(actual!==sha)throw new Error('資料を照合できません');}
      return JSON.parse(new TextDecoder().decode(bytes));
    })();
    if(sha)snapshots.set(key,pending);
    try{return await pending;}catch(error){snapshots.delete(key);throw error;}
  }
  const gradeName=code=>({1:'F2',2:'F1',3:'G3',4:'G2',5:'G1',6:'GP'})[code]||'';
  function personMeta(player){
    const meta=el('span','person-meta'),birthday=M.birthdayState(player);
    meta.append(el('span','directory-prefecture',M.prefectureOf(player)||'県不明'));
    const second=el('span','person-term-age');second.append(el('span','directory-period',(player.period||'—')+'期'));
    const age=el('span','directory-age',birthday.age!==null?birthday.age+'歳':'年齢不明');
    if(birthday.done){const done=el('small','birthday-done','済');done.title='4月1日以降の誕生日済み';age.append(done);}second.append(age);meta.append(second);return meta;
  }
  function countDisplay(counts,detail=false){
    const group=el('div','count-grid');
    for(const [key,label]of M.COUNT_FIELDS){const value=counts.values[key],item=el('span','count-item');item.dataset.stat=key;
      const threshold=key==='b'?15:key==='total_starts'?null:10;
      if(value!==null&&threshold!==null&&value>=threshold)item.classList.add('count-high');
      item.append(el('span','count-label',key==='total_starts'?'総':label),el('strong','count-value',value===null?'—':value));
      item.setAttribute('aria-label',(key==='total_starts'?'総出走数':label)+' '+(value===null?'未確認':value+'回'));group.append(item);
    }
    const date=counts.card_date||counts.observed_at?.slice(0,10);group.title=counts.scope+(date?' / 確認資料 '+date:'');
    if(detail)group.classList.add('detail-counts');return group;
  }
  function recentDisplay(player){
    const group=el('td','directory-recent');
    M.previousSlots(player).forEach((meeting,index)=>{
      const line=el('div','recent-line');line.dataset.position=index?'previous':'previous_previous';
      if(!meeting){line.append(el('span','recent-empty','—'));line.title=(index?'前場所':'前々場所')+'未確認';}
      else{
        line.title=(index?'前場所':'前々場所')+' '+meeting.start_date+' '+gradeName(meeting.grade_code)+meeting.venue;
        line.append(el('span','recent-venue',gradeName(meeting.grade_code)+M.shortVenue(meeting)));
        const placings=el('span','recent-placings');for(const result of meeting.days||[])placings.append(el('span','',D.rankLabel(result)));line.append(placings);
      }
      group.append(line);
    });return group;
  }
  function updateControls(){
    for(const button of $('region-buttons').children)button.setAttribute('aria-pressed',String(button.dataset.region===browse.region));
    for(const button of $('sort-buttons').children){
      const key=button.dataset.sort;
      if(key){
        const index=browse.sorts.findIndex(sort=>sort.key===key),sort=browse.sorts[index],priority=index<0?0:browse.sorts.length-index;
        button.dataset.direction=sort?.direction||'off';
        button.textContent=M.SORT_LABELS[key]+(sort?(sort.direction==='asc'?'↑':'↓')+priority:'');
        button.setAttribute('aria-pressed',String(Boolean(sort)));
        button.setAttribute('aria-label',M.SORT_LABELS[key]+'：'+(sort?(sort.direction==='asc'?'昇順':'降順')+'、優先'+priority:'解除'));
      }else button.setAttribute('aria-pressed',String(button.dataset.role===browse.role));
    }
    const priorities=[...browse.sorts].reverse().map(sort=>M.SORT_LABELS[sort.key]+(sort.direction==='asc'?'↑':'↓'));
    if(!browse.sorts.some(sort=>sort.key==='score'))priorities.push('得点↓');
    $('sort-order').textContent='並び：'+priorities.join(' → ');
  }
  function drawDirectory(){
    const listing=M.directory(players,{...browse,query:$('rider-query').value});browse.page=listing.page;
    $('directory-title').textContent=listing.home?'得点トップ30':(browse.region||'全地区')+(browse.role?'・'+(browse.role==='self'?'自力':'追込'):'');
    $('directory-status').textContent=listing.total?(listing.home?'得点確認済み'+listing.scopeTotal+'人中 / ':'全'+listing.total+'人 / ')+listing.start+'〜'+listing.end+'人'+(listing.pageCount>1?'（'+(listing.page+1)+' / 2ページ）':''):'一致する選手はいません';
    $('search-status').textContent='保存選手 '+players.length+'人。名前を押すと10場所と最新プロフィールを表示します。';
    const root=$('rider-list');root.replaceChildren();
    for(const [index,player]of listing.rows.entries()){
      const row=el('tr');row.dataset.playerId=player.player_id;
      const rank=el('td','directory-number',listing.start+index),name=el('td','directory-name'),button=el('button','directory-name-button',player.name);
      button.type='button';button.addEventListener('click',()=>choose(player));name.append(button);
      const details=el('td','directory-meta');details.append(personMeta(player));
      const counts=el('td','directory-counts');counts.append(countDisplay(M.countsOf(player)));
      const score=M.scoreOf(player),points=el('td','directory-score',score===null?'—':score.toLocaleString('ja-JP',{minimumFractionDigits:2,maximumFractionDigits:3}));
      points.title=player.last_card?.date?'最終掲載 '+player.last_card.date:'競走得点は未取得';
      row.append(rank,name,details,counts,points,recentDisplay(player));root.append(row);
    }
    for(const id of ['pages-top','pages-bottom']){
      const pagination=$(id);pagination.replaceChildren();pagination.hidden=listing.pageCount===1;
      if(listing.pageCount>1)for(let page=0;page<listing.pageCount;page++){
        const button=el('button','',String(page+1));button.type='button';button.setAttribute('aria-label',(page+1)+'ページ');
        if(page===listing.page)button.setAttribute('aria-current','page');
        button.addEventListener('click',()=>{browse.page=page;drawDirectory();});pagination.append(button);
      }
    }
    return listing;
  }
  function showDirectory(clearQuery=false){
    clearTimeout(queryTimer);selected=null;token++;$('rider').hidden=true;$('directory').hidden=false;$('matches').replaceChildren();
    if(clearQuery)$('rider-query').value='';
    const url=new URL(location.href);url.searchParams.delete('player_id');url.searchParams.delete('date');
    if($('rider-query').value.trim())url.searchParams.set('q',$('rider-query').value.trim());else url.searchParams.delete('q');
    history.replaceState(null,'',url);updateControls();return drawDirectory();
  }
  function buildControls(){
    for(const region of M.REGIONS){
      const button=el('button','',region.name);button.type='button';button.dataset.region=region.name;button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{browse.region=browse.region===region.name?'':region.name;browse.all=true;browse.page=0;showDirectory(true);});$('region-buttons').append(button);
    }
    for(const [key,label]of Object.entries(M.SORT_LABELS)){
      const button=el('button','',label);button.type='button';button.dataset.sort=key;
      button.addEventListener('click',()=>{browse.sorts=M.cycleSort(browse.sorts,key);browse.page=0;showDirectory(true);});$('sort-buttons').append(button);
    }
    for(const [key,label]of [['self','自力'],['chaser','追込']]){
      const button=el('button','',label);button.type='button';button.dataset.role=key;
      button.addEventListener('click',()=>{browse.role=browse.role===key?'':key;browse.page=0;showDirectory(true);});$('sort-buttons').append(button);
    }
    updateControls();
  }
  function updatePlayerMetadata(player,profile){
    if(typeof profile.age==='number'&&profile.age>=18&&profile.age<=100)player.age=profile.age;
    if(profile.prefecture)player.prefecture=profile.prefecture;
    if(['逃','両','追'].includes(profile.style))player.style=profile.style;
    if(profile.birth_date)player.birth_date=profile.birth_date;
    if(profile.counts)player.counts=profile.counts;
    if(profile.meetings?.length)player.recent_meetings=M.mergeMeetings({meetings:player.recent_meetings||[]},profile).slice(0,2).reverse();
  }
  function draw(){
    if(!selected)return;
    const {player,profile,stock}=selected,person=profile||player;
    $('rider').hidden=false;$('rider-name').textContent=person.name;
    $('official-profile').href='https://keirin.jp/pc/racerprofile?snum='+player.player_id;
    $('enjoy-profile').href='https://www.yen-joy.net/racer/data/'+player.player_id;
    $('rider-meta').replaceWith(Object.assign(personMeta({...player,...person,birth_date:person.birth_date||player.birth_date}),{id:'rider-meta'}));
    $('profile-summary').textContent=[person.class_name,person.style,player.player_id].filter(Boolean).join(' / ');
    const stats=$('techniques');stats.replaceChildren();
    const counts=M.countsOf(player,profile);stats.append(countDisplay(counts,true));
    const countDate=counts.card_date||counts.observed_at?.slice(0,10);
    $('count-source').textContent=counts.scope+'・回数'+(countDate?' / '+countDate+'確認資料':'')+' / 総＝総出走数';
    const meetings=M.mergeMeetings(stock,profile);selected.meetings=meetings;
    const root=$('rider-meetings');root.replaceChildren();
    $('history-note').textContent=meetings.length+'場所・新しい順';
    if(!meetings.length)root.append(el('p','empty',selected.loading?'成績を確認しています…':'保存済みの成績はありません。公式プロフから確認できます。'));
    for(const meeting of meetings){
      const row=el('section','meeting'),label=el('div','meeting-label');
      label.append(el('strong',meeting.grade_code===3?'grade-3':meeting.grade_code>=4?'grade-high':'',gradeName(meeting.grade_code)+meeting.venue),el('small','',meeting.start_date));
      const runs=el('div','meeting-results');
      for(const [i,result]of meeting.days.entries()){
        const run=el('span','run'),date=result.race_date;
        run.title=date?(date+(result.race_number?' '+result.race_number+'R':'')):(result.slot??i+1)+'走目（実施日未照合）';
        run.setAttribute('aria-label',run.title);
        run.append(el('span','run-slot',date?date.slice(5).replace('-','/')+(result.race_number?' '+result.race_number+'R':''):(result.slot??i+1)+'走目'));
        const line=el('span','placing '+D.rankClass(result,meeting));
        const url=D.replayUrl(result,player.player_id,meeting.venue_code),rank=el(url?'a':'span','',D.rankLabel(result));
        if(url){rank.href=url;rank.target='_self';rank.title='このレースの公式映像';}
        if(result.accident_name)rank.title=result.accident_name;
        line.append(rank,el('span','run-flags',['start','home','back'].map((flag,j)=>result[flag]===true?'SHB'[j]:'').join('')));
        run.append(line,el('span','run-time',result.final_half_record||''));runs.append(run);
      }
      row.append(label,runs);root.append(row);
    }
    $('rider-json').disabled=!meetings.length;$('rider-csv').disabled=!meetings.length;
  }
  async function latest(active,force=false){
    const {player}=active;
    if(!force&&profiles.has(player.player_id)){
      active.profile=profiles.get(player.player_id);active.loading=false;
      updatePlayerMetadata(player,active.profile);
      if(selected===active){draw();$('profile-status').textContent='このセッションで確認済みの公式プロフィールを表示しています。';}
      return;
    }
    try{
      const config=await json('daily-results/profile-config.json'),url=new URL(config.endpoint);
      url.searchParams.set('player_id',player.player_id);
      const source=player.counts?.source_url||player.last_card?.source_url;
      if(source&&/^https:\/\/keirin\.kdreams\.jp\/[a-z]+\/racedetail\/\d{16}\/$/.test(source)){
        url.searchParams.set('card_url',source);if(player.last_card?.source_url===source&&player.last_card.car_number)url.searchParams.set('car_number',player.last_card.car_number);
      }
      const response=await fetch(url,{headers:{apikey:config.anon_key,Authorization:'Bearer '+config.anon_key},signal:AbortSignal.timeout(41000)});
      if(!response.ok)throw new Error('公式プロフィールを取得できません');
      const profile=await response.json();
      if(profile.schema_version!==1||profile.player_id!==player.player_id||(!player.unidentified&&!M.samePerson(profile,player))||!Array.isArray(profile.meetings))throw new Error('公式の本人情報が一致しません');
      profiles.set(player.player_id,profile);active.profile=profile;active.loading=false;
      updatePlayerMetadata(player,profile);
      if(selected!==active)return;
      draw();$('profile-status').textContent='KEIRIN.JPの最新公開プロフィールを確認しました。レース日が未照合の履歴は走順のみを表示しています。';
    }catch{
      active.loading=false;if(selected!==active)return;draw();
      $('profile-status').textContent=active.profile||active.stock?'公式の再確認に失敗しました。保存済みの成績・確認済みの決まり手を表示しています。':'公式を読み込めません。公式プロフ・エンジョイのリンクから確認できます。';
    }
  }
  async function choose(player){
    const current=++token,active={player,profile:null,stock:null,meetings:[],loading:true};selected=active;
    $('directory').hidden=true;
    const url=new URL(location.href);url.searchParams.delete('date');url.searchParams.set('player_id',player.player_id);url.searchParams.set('q',player.name);history.replaceState(null,'',url);
    $('matches').replaceChildren();$('search-status').textContent='出走日に関係なく '+player.name+' の成績を確認します';$('profile-status').textContent='保存済み成績を読込中…';draw();
    await Promise.allSettled([['stock',player.history_ref],['profile',player.profile_ref]].filter(([,ref])=>ref).map(async([key,ref])=>{
      const data=await json(ref.path,ref.sha256);if(!M.samePerson(data,player))throw new Error('保存資料の本人が違います');active[key]=data;if(current===token)draw();
    }));
    if(current!==token)return;
    $('profile-status').textContent='保存済み成績を表示し、公式プロフィールを確認しています…';draw();latest(active);
  }
  function search(chooseExact=true){
    const query=$('rider-query').value.trim();browse.page=0;
    const listing=M.directory(players,{...browse,query});
    if(query&&listing.total===1&&chooseExact){choose(listing.rows[0]);return;}
    if(query&&!listing.total&&/^\d{6}$/.test(query)){choose(players.find(player=>player.player_id===query)||{player_id:query,name:query,period:null,unidentified:true});return;}
    showDirectory();
  }
  function download(csv){
    if(!selected?.meetings.length)return;
    const record={player:selected.profile||selected.player,meetings:selected.meetings};
    const rows=M.resultRows(record.player,record.meetings),text=csv?D.csv(Object.keys(rows[0]),rows):JSON.stringify(record,null,2);
    const url=URL.createObjectURL(new Blob([text],{type:csv?'text/csv;charset=utf-8':'application/json;charset=utf-8'})),link=el('a');
    link.href=url;link.download=selected.player.player_id+'-results.'+(csv?'csv':'json');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('rider-search').addEventListener('submit',event=>{event.preventDefault();clearTimeout(queryTimer);search();});
  $('rider-query').addEventListener('input',()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>search(),250);});
  $('profile-refresh').addEventListener('click',()=>{if(selected){$('profile-status').textContent='公式プロフィールを確認しています…';latest(selected,true);}});
  $('rider-json').addEventListener('click',()=>download(false));$('rider-csv').addEventListener('click',()=>download(true));
  $('directory-back').addEventListener('click',()=>showDirectory());
  $('show-all').addEventListener('click',()=>{browse={region:'',role:'',sorts:[],all:true,page:0};showDirectory(true);});
  $('show-top').addEventListener('click',()=>{browse={region:'',role:'',sorts:[],all:false,page:0};showDirectory(true);});
  buildControls();
  let displayedDay=M.jstDay();
  function checkDay(){const today=M.jstDay();if(today!==displayedDay){displayedDay=today;if(selected)draw();else drawDirectory();}}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDay();});setInterval(checkDay,30000);
  (async()=>{
    try{
      const catalogue=await json('daily-results/riders.json');if(catalogue.schema_version!==1||catalogue.kind!=='rider_search')throw new Error('選手台帳を確認できません');players=catalogue.players;
      const params=new URL(location.href).searchParams,id=params.get('player_id'),query=params.get('q')||'';$('rider-query').value=query;
      if(id){const player=players.find(p=>p.player_id===id);if(player)choose(player);else if(/^\d{6}$/.test(id))choose({player_id:id,name:id,period:null,unidentified:true});else search();}
      else search();
    }catch{$('search-status').textContent='選手台帳を読み込めません。時間をおいて再読込してください。';}
  })();
})();
