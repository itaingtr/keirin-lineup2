const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'site/previous-meetings.js'),'utf8');
const css=fs.readFileSync(path.join(root,'site/previous-meetings.css'),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const target='2026-11-10';
const races=[1,2].map(number=>({source:'https://keirin.kdreams.jp/kumamoto/racedetail/872026110902000'+number+'/',race:number,venueCode:'87',meetingStart:'20261109',meetingDay:2,players:[1,2,3].map(no=>({no,name:'選手'+number+no,period:100+no,playerId:'015'+number+'0'+no,stats:[no===3?0:number===1?3:3-no,0,0,0,0,0],meetingResults:no===3?[]:[{meeting_day:1,race_id:(no===1?'12':'11')+'8720261109',order:2}]}))}));

function result(player,slot,date,flags={}){
 return {slot,meeting_day:slot,race_date:date,race_date_inferred:false,race_id:'1287'+date.replaceAll('-',''),race_number:12,player_id:player.playerId,order:slot===1?2:3,accident:'',final_half_record:slot===1?'11.7':'11.8',home:null,back:null,start:null,...flags,
  video_url:'https://my.keirin.kdreams.jp/stadium/digest/?kyogijoCd=87&kaisaiDate='+date.replaceAll('-','')+'&gradeCd=2&raceNo=12',result_url:null};
}
function meeting(player,position,first,count=3){
 const days=[];
 for(let i=0;i<count;i++){
  const date=new Date(first+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+i);
  days.push(result(player,i+1,date.toISOString().slice(0,10),i===0?{home:true,back:true}:{}));
 }
 return {position,start_date:first,start_date_inferred:true,venue:'熊本',venue_code:'87',grade_code:2,days};
}
function payload(){
 return {schema_version:1,target_date:target,current_result_types:{'128720261109':'S級初日特選','118720261109':'S級予選'},races:races.map(race=>({source_url:race.source,players:race.players.map(player=>({no:player.no,name:player.name,period:player.period,player_id:player.playerId,meetings:[meeting(player,'previous_previous','2026-10-20',player.no===2?4:3),meeting(player,'previous','2026-11-02')]}))}))};
}
const conditionKey=(date,id,player)=>'condition:v1:'+date+':'+id+':'+player;
function markup(opted=true,source=''){
 const rows=races.map(race=>'<tr><td><a class="race-link" href="'+race.source+'">'+race.race+'R</a></td><td><div class="lineup"><div class="line-group">'+race.players.map(player=>'<div class="rider"><span class="car">'+player.no+'</span><span class="name">'+player.name+'</span><span class="period">'+player.period+'</span><span class="recent-s">'+(player.stats[0]||'')+'</span><div class="stats">1</div><div class="meeting-results">'+(player.meetingResults.length?player.meetingResults.map(result=>'<div class="meeting-result" data-meeting-day="'+result.meeting_day+'"><span class="meeting-rank">'+result.order+'</span><span class="meeting-time">11.7</span></div>').join(''):'<span class="meeting-first-day">初日</span>')+'</div><span class="condition-today"></span></div>').join('')+'</div></div></td></tr>').join('');
 return '<!doctype html><html><head><base href="/keirin-lineup2/data/20261110/"><style>.rider{display:flex;flex-direction:column;flex:0 0 22px;width:22px}.line-group{display:flex;gap:0}.lineup{display:flex;gap:12px}'+css+'</style></head><body'+(opted?' data-previous-meetings="true"':'')+(source?' data-previous-meetings-src="'+source+'"':'')+'><div class="table-wrap"><table><tbody id="rows">'+rows+'</tbody></table></div><p class="notice">初日には前日までの今場所成績がないため「初日」と表示します。</p><script>const races='+JSON.stringify(races)+';const conditionDate="'+target+'";</script></body></html>';
}
async function open({data=payload(),opted=true,posts=[],source=''}={}){
 let calls=0,reads=0,fail=false;
 const errors=[],requested=[],intervals=[],videos=[];
 const dom=new JSDOM(markup(opted,source),{url:'https://itaingtr.github.io/keirin-lineup2/index2.html',runScripts:'dangerously',beforeParse(w){
  Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});
  w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
  w.fetch=async(input,options)=>{calls++;assert.equal(String(input),'https://itaingtr.github.io/keirin-lineup2/data/20261110/'+(source==='previous-daily.json'?source:'previous-meetings.json'));assert.equal(options.cache,'no-store');return {ok:true,json:async()=>data};};
  w.openVideo=(event,url)=>{event.preventDefault();videos.push(url);};
  w.keirinBoard={ready:true,canWrite:false,client:{from(table){assert.equal(table,'race_comments');return {
   select(columns){assert.equal(columns,'id, race_key, body, created_at');let batch=[];return {
    in(column,keys){assert.equal(column,'race_key');assert.ok(keys.length<=50);assert.ok(keys.every(key=>/^condition:v1:\d{4}-\d{2}-\d{2}:\d{12}:\d{6}$/.test(key)));batch=keys;requested.push(...keys);return this;},
    order(){return this;},async range(start,end){reads++;if(fail)return {data:null,error:{message:'offline'}};const rows=posts.filter(row=>batch.includes(row.race_key)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));return {data:rows.slice(start,end+1),error:null};}
   };},insert(){assert.fail('Previous-meeting notes must never write');},update(){assert.fail('Previous-meeting notes must never overwrite');},delete(){assert.fail('Previous-meeting notes must never delete');}
  };}}};
  w.addEventListener('error',event=>errors.push(event.error||event.message));
 }});
 dom.window.eval(script);await pause();
 return {dom,get rows(){return [...dom.window.document.querySelectorAll('#rows > tr')];},calls:()=>calls,reads:()=>reads,requested,intervals,videos,errors,posts,fail(value){fail=value;},async refresh(){dom.window.dispatchEvent(new dom.window.Event('keirin-board-state'));await pause();},async rerender(){const body=dom.window.document.getElementById('rows');body.innerHTML=body.innerHTML;await pause();}};
}

async function basic(){
 const data=payload(),first=races[0].players[0];
 // A missing video leaves the actual rank/time visible and unlinked; there
 // is no guessed race ID and no condition read for that record.
 Object.assign(data.races[0].players[2].meetings[1].days[0],{race_id:null,race_number:null,video_url:null,race_date_inferred:true});
 // Only the older group may be present after a source leaves the newer blank.
 data.races[0].players[2].meetings=[data.races[0].players[2].meetings[0]];
 const negative=conditionKey('2026-10-20','128720261020',first.playerId),cleared=conditionKey('2026-11-02','128720261102',first.playerId);
 const posts=[{id:'a',race_key:negative,body:'-1',created_at:'2026-10-20T01:00:00Z'},{id:'b',race_key:cleared,body:'5',created_at:'2026-11-02T01:00:00Z'},{id:'c',race_key:cleared,body:'0',created_at:'2026-11-02T02:00:00Z'},{id:'d',race_key:negative,body:'9',created_at:'2026-10-20T03:00:00Z'},{id:'wrong',race_key:conditionKey('2026-10-20','128720261020','999999'),body:'5',created_at:'2026-10-20T03:00:00Z'}];
 const app=await open({data,posts});
 try{
  const doc=app.dom.window.document;
  assert.equal(doc.body.dataset.previousMeetingsStatus,'ready');assert.equal(app.calls(),1);assert.equal(doc.querySelectorAll('.previous-toggle').length,6);
  assert.equal(doc.querySelector('.meeting-first-day'),null);assert.doesNotMatch(doc.querySelector('.notice').textContent,/初日/);
  assert.equal(doc.querySelectorAll('.previous-results:not([hidden])').length,0);assert.equal(app.reads(),0,'closed history does not add note reads');
  const before=app.rows[0].querySelector('.rider').getAttribute('style');
  app.rows[0].querySelector('.previous-toggle').click();await pause();
  assert.equal(app.rows[0].querySelectorAll('.previous-results:not([hidden])').length,3);
  assert.equal(app.rows[1].querySelectorAll('.previous-results:not([hidden])').length,0,'races toggle independently');
  for(const panel of app.rows[0].querySelectorAll('.previous-results')){assert.equal(panel.querySelectorAll('.previous-meeting').length,2);assert.equal(panel.querySelectorAll('.previous-result').length,8);}
  const panel=app.rows[0].querySelector('.previous-results');
  assert.equal(panel.querySelector('[data-previous-meeting="older"] .previous-order-line').textContent,'2HB-1');
  assert.equal(panel.querySelector('.previous-time').textContent,'11.7');
  assert.equal(panel.querySelector('[data-previous-meeting="older"] [data-previous-slot="4"]').textContent,'','3-day riders reserve the fourth empty slot');
  assert.equal(panel.querySelector('[data-previous-meeting="newer"] .previous-condition').textContent,'','latest zero clears an older nonzero note');
  const style=app.dom.window.getComputedStyle(panel.querySelector('.previous-condition'));
  assert.equal(style.color,'rgb(211, 47, 47)');assert.equal(style.fontSize,'8px');assert.equal(style.fontWeight,'400');
  assert.equal(app.dom.window.getComputedStyle(panel.querySelector('.previous-flag')).fontWeight,'400');
  assert.equal(app.dom.window.getComputedStyle(panel.querySelector('.previous-time')).fontSize,'8px');
  assert.equal(app.rows[0].querySelector('.rider').getAttribute('style'),before);assert.equal(app.dom.window.getComputedStyle(app.rows[0].querySelector('.rider')).width,'22px');
  panel.querySelector('.previous-order').click();assert.equal(app.videos.length,1);assert.match(app.videos[0],/kaisaiDate=20261020/);
  const third=app.rows[0].querySelectorAll('.previous-results')[2];
  assert.ok(third.querySelector('[data-previous-meeting="older"] .previous-order'));
  assert.equal(third.querySelector('[data-previous-meeting="newer"]').textContent,'—','a known older group is not moved to the newer position');
  app.posts.push({id:'new',race_key:negative,body:'3',created_at:'2026-10-20T04:00:00Z'});await app.refresh();
  assert.equal(panel.querySelector('.previous-condition').textContent,'3');
  app.fail(true);await app.refresh();assert.equal(panel.querySelector('.previous-condition').textContent,'3','a read failure keeps the last confirmed condition');
  await app.rerender();assert.equal(app.rows[0].querySelectorAll('.previous-results:not([hidden])').length,3,'search rerender retains open state');assert.equal(app.rows[0].querySelectorAll('.previous-controls').length,3,'rerender does not duplicate controls');
  app.rows[0].querySelectorAll('.previous-toggle')[1].click();assert.equal(app.rows[0].querySelectorAll('.previous-results:not([hidden])').length,0,'any member closes the whole race');
  assert.deepEqual(app.errors,[]);
 }finally{app.dom.window.close();}
}

async function nullableAndLongMeeting(){
 const data=payload();
 data.races[0].players[0].meetings[0]=meeting(races[0].players[0],'previous_previous','2026-10-20',5);
 const unknown=data.races[0].players[0].meetings[1].days[0];Object.assign(unknown,{race_id:null,race_number:null,video_url:null,race_date_inferred:true});
 const app=await open({data});
 try{
  app.rows[0].querySelector('.previous-toggle').click();await pause();
  for(const panel of app.rows[0].querySelectorAll('.previous-results'))assert.equal(panel.querySelectorAll('.previous-result').length,10,'rare longer meetings expand both groups across the whole race');
  const unlinked=app.rows[0].querySelector('[data-previous-meeting="newer"] .previous-result');
  assert.equal(unlinked.querySelector('a'),null);assert.equal(unlinked.querySelector('.previous-rank').textContent,'2');assert.equal(unlinked.querySelector('.previous-time').textContent,'11.7');
  assert.equal(unlinked.querySelector('.previous-condition').dataset.conditionKey,undefined);
  assert.ok(app.requested.every(key=>!key.includes('null')));assert.deepEqual(app.errors,[]);
 }finally{app.dom.window.close();}
}

async function requestedAppearance(){
 const data=payload(),members=data.races[0].players;
 data.current_result_types['118720261109']='S級準決勝';
 const older=members[0].meetings[0],newer=members[0].meetings[1];
 older.venue='いわき平';older.grade_code=3;
 newer.venue='和歌山';newer.grade_code=4;
 older.days[0].race_type='Ｓ級初特選';older.days[1].race_type='Ｓ級準決勝';older.days[2].race_type='Ｓ級決勝';
 older.days[1].display_type=2;
 newer.days[0].race_type='Ｓ級特選';newer.days[0].meeting_day=1;
 newer.days[1].race_type='S級特選';newer.days[1].highlight_rank=true;
 newer.days[2].race_type='S級準々決勝';
 members[1].meetings[0].grade_code=2;
 members[1].meetings[0].days[0].semifinal_rank=true;
 members[2].meetings[0].grade_code=5;members[2].meetings[1].grade_code=6;
 const app=await open({data});
 try{
  const w=app.dom.window,doc=w.document;
  const counts=[...app.rows[0].querySelectorAll('.recent-s')];
  assert.deepEqual(counts.map(node=>node.textContent),['3','3','']);
  assert.ok(counts.every(node=>w.getComputedStyle(node).color==='rgb(8, 125, 54)'));
  assert.deepEqual(counts.map(node=>w.getComputedStyle(node).fontWeight),['700','700','400'],'all positive tied maxima are bold; zero stays blank');
  assert.deepEqual([...app.rows[1].querySelectorAll('.recent-s')].map(node=>w.getComputedStyle(node).fontWeight),['700','400','400'],'S maximum is independent in each race');
  const currentRanks=app.rows[0].querySelectorAll('.meeting-rank');
  assert.ok(currentRanks[0].classList.contains('previous-important-rank'));
  assert.equal(w.getComputedStyle(currentRanks[0]).color,'rgb(211, 47, 47)','current first-day special is red from the exact result-type sidecar');
  assert.equal(currentRanks[1].classList.contains('previous-important-rank'),false);
  assert.ok(currentRanks[1].classList.contains('previous-semifinal-rank'));
  assert.equal(w.getComputedStyle(currentRanks[1]).color,'rgb(239, 108, 0)','current semifinal is orange from the exact result-type sidecar');
  app.rows[0].querySelector('.previous-toggle').click();await pause();
  const headings=[...app.rows[0].querySelectorAll('.previous-heading')];
  assert.equal(headings[0].textContent,'いわき');assert.match(headings[0].title,/いわき平/);
  assert.equal(headings[1].textContent,'和歌山');
  assert.ok(headings.every(node=>Array.from(node.textContent).length<=3));
  assert.equal(w.getComputedStyle(headings[0]).backgroundColor,'rgb(255, 235, 238)');
  assert.equal(w.getComputedStyle(headings[1]).backgroundColor,'rgb(243, 229, 245)');
  assert.equal(headings[2].classList.contains('previous-grade-g3'),false,'F1 heading does not get a grade highlight');
  for(const node of headings.slice(4))assert.equal(w.getComputedStyle(node).backgroundColor,'rgb(243, 229, 245)','G1 and GP use the same pale purple');
  const panel=app.rows[0].querySelector('.previous-results');
  const ranks=[...panel.querySelectorAll('[data-previous-meeting="older"] .previous-rank')];
  assert.deepEqual(ranks.map(node=>node.classList.contains('previous-important-rank')),[true,false,true],'semifinal must not match final');
  assert.equal(w.getComputedStyle(ranks[0]).color,'rgb(211, 47, 47)');
  assert.equal(w.getComputedStyle(ranks[2]).color,'rgb(211, 47, 47)');
  assert.deepEqual(ranks.map(node=>node.classList.contains('previous-semifinal-rank')),[false,true,false]);
  assert.equal(w.getComputedStyle(ranks[1]).color,'rgb(239, 108, 0)');
  assert.equal(w.getComputedStyle(ranks[1]).backgroundColor,'rgb(255, 243, 224)','solid semifinal rank stays legible on pale orange');
  assert.equal(w.getComputedStyle(app.rows[0].querySelectorAll('.previous-results')[1].querySelector('.previous-rank')).color,'rgb(239, 108, 0)','verified metadata can color a semifinal with no raw type');
  const recentRanks=[...panel.querySelectorAll('[data-previous-meeting="newer"] .previous-rank')];
  assert.equal(recentRanks[0].classList.contains('previous-important-rank'),false,'a supplementary start is not guessed to be an opening-day special');
  assert.equal(recentRanks[1].classList.contains('previous-important-rank'),true,'verified backend classification can highlight a result');
  assert.equal(recentRanks[2].classList.contains('previous-important-rank'),false,'quarterfinal is not a final');
  assert.equal(recentRanks[2].classList.contains('previous-semifinal-rank'),false,'quarterfinal is not a semifinal');
  for(const node of panel.querySelectorAll('.previous-result')){
   const style=w.getComputedStyle(node);assert.equal(style.height,'16px');assert.equal(style.marginBottom,'0px');
  }
  assert.equal(w.getComputedStyle(panel.querySelector('.previous-time')).fontSize,'8px');
  assert.equal(w.getComputedStyle(panel.querySelector('.previous-time')).height,'8px');
  await app.rerender();
  assert.equal(w.getComputedStyle(app.rows[0].querySelector('.recent-s')).fontWeight,'700');
  assert.equal(app.rows[0].querySelector('.meeting-rank').classList.contains('previous-important-rank'),true);
  assert.equal(app.rows[0].querySelectorAll('.meeting-rank')[1].classList.contains('previous-semifinal-rank'),true);
  assert.deepEqual(app.errors,[]);
 }finally{app.dom.window.close();}
}

async function guarded(){
 const daily=await open({source:'previous-daily.json'});
 try{assert.equal(daily.dom.window.document.body.dataset.previousMeetingsStatus,'ready');assert.equal(daily.calls(),1);}
 finally{daily.dom.window.close();}
 const normal=await open({opted:false});
 try{assert.equal(normal.calls(),0);assert.equal(normal.dom.window.document.querySelector('.previous-toggle'),null);assert.equal(normal.dom.window.document.querySelector('.meeting-first-day').textContent,'初日');assert.equal(normal.intervals.length,0);}
 finally{normal.dom.window.close();}
 for(const alter of [data=>data.target_date='2026-11-09',data=>data.races[0].players[0].player_id='999999',data=>data.races[0].players[0].name='別人',data=>data.races[0].players[0].meetings[0].days[0].video_url='https://example.com/video',data=>data.races[0].players[0].meetings[0].days[0].race_id='118720261020']){
  const data=payload();alter(data);const app=await open({data});
  try{assert.equal(app.dom.window.document.body.dataset.previousMeetingsStatus,'error');assert.ok([...app.dom.window.document.querySelectorAll('.previous-toggle')].every(button=>button.disabled));assert.equal(app.reads(),0);assert.deepEqual(app.errors,[]);}
  finally{app.dom.window.close();}
 }
}

async function actualPrototype(htmlPath,jsonPath){
 const html=fs.readFileSync(htmlPath,'utf8'),data=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
 const errors=[];
 const dom=new JSDOM(html,{url:'https://itaingtr.github.io/keirin-lineup2/index2.html',runScripts:'dangerously',beforeParse(w){
  w.matchMedia=()=>({matches:false});w.setInterval=()=>0;
  Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});
  w.keirinBoard={ready:false};
  w.fetch=async input=>{assert.equal(new URL(String(input)).pathname.split('/').at(-1),w.document.body.dataset.previousMeetingsSrc || 'previous-meetings.json');return {ok:true,json:async()=>data};};
  w.addEventListener('error',event=>errors.push(event.error||event.message));
 }});
 try{
  const style=dom.window.document.createElement('style');style.textContent=css;dom.window.document.head.append(style);
  const reader=/src="[^" ]*\/(previous-meetings-mp4\.js)\?/.exec(html)?.[1];
  dom.window.eval(reader?fs.readFileSync(path.join(path.dirname(htmlPath),reader),'utf8'):script);
  for(let i=0;i<40&&!dom.window.document.body.dataset.previousMeetingsStatus;i++)await pause();
  assert.equal(dom.window.document.body.dataset.previousMeetingsStatus,'ready','actual prototype data must pass every identity check');
  let riders=0,results=0,linked=0;
  const rows=[...dom.window.document.querySelectorAll('#rows > tr')];
  for(const record of data.races){
   const row=rows.find(row=>{const link=row.querySelector('.race-link');return (link?.dataset.raceSource||link?.href)===record.source_url;});
   assert.ok(row);row.querySelector('.previous-toggle').click();
   const slots=Math.max(4,...record.players.flatMap(player=>player.meetings.flatMap(meeting=>meeting.days.map(day=>day.slot??day.meeting_day))));
   for(const player of record.players){
    const rider=[...row.querySelectorAll('.lineup .rider')].find(rider=>Number(rider.querySelector('.car').textContent)===player.no);assert.ok(rider);
    const panel=rider.querySelector('.previous-results');assert.equal(panel.hidden,false);
    assert.equal(panel.querySelectorAll('.previous-result').length,slots*2);riders++;
    const meetings=player.meetings.some(meeting=>meeting.position!==undefined)?['previous_previous','previous'].map(position=>player.meetings.find(meeting=>meeting.position===position)):player.meetings.length===2?player.meetings:[null,player.meetings[0]];
    meetings.forEach((meeting,index)=>{
     if(!meeting)return;
     const block=panel.querySelectorAll('.previous-meeting')[index];
     for(const result of meeting.days){
      const node=block.querySelector('[data-previous-slot="'+(result.slot??result.meeting_day)+'"]');assert.ok(node);
      assert.equal(node.querySelector('.previous-rank').textContent,result.order?String(result.order):String(result.accident||''));
      assert.equal(node.querySelector('.previous-time').textContent,result.final_half_record||'');
      assert.equal([...node.querySelectorAll('.previous-flag')].map(flag=>flag.textContent).join(''),(result.start?'S':'')+(result.home?'H':'')+(result.back?'B':''));
      assert.equal(Boolean(node.querySelector('a.previous-order')),Boolean(result.video_url||result.result_url));
      if(result.video_url&&dom.window.document.body.dataset.replayLinks==='mp4'){
       const q=new URL(result.video_url).searchParams,code=q.get('kyogijoCd');
       assert.equal(node.querySelector('a.previous-order').href,'https://wm.st.keirin.jp/wm-keirin'+code+'/'+q.get('kaisaiDate')+'-'+code+'-'+q.get('gradeCd').padStart(2,'0')+'-'+String(+q.get('raceNo')).padStart(2,'0')+'-01-00.mp4');
      }
      results++;if(node.querySelector('a.previous-order'))linked++;
     }
    });
   }
   row.querySelector('.previous-toggle').click();assert.equal(row.querySelectorAll('.previous-results:not([hidden])').length,0);
  }
  assert.equal(riders,data.races.reduce((sum,race)=>sum+race.players.length,0));assert.deepEqual(errors,[]);
  console.log('ACTUAL PREVIOUS MEETINGS DOM PASS',JSON.stringify({races:data.races.length,riders,results,linked}));
 }finally{dom.window.close();}
}

(async()=>{await basic();await nullableAndLongMeeting();await requestedAppearance();await guarded();if(process.argv[2]&&process.argv[3])await actualPrototype(process.argv[2],process.argv[3]);console.log('PREVIOUS MEETINGS UI PASS: exact identities, per-race toggle, compact four-slot venue groups and grades, special/final ranks, green maximum S counts, raw times, SHB, latest shared notes including zero, rerender and archive isolation.');})().catch(error=>{console.error(error);process.exitCode=1;});
