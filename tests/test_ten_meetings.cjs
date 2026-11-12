const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const project=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(project,'site/ten-meetings.js'),'utf8');
const css=fs.readFileSync(path.join(project,'site/ten-meetings.css'),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const target='2026-11-12';
const races=[6,7].map(number=>({source:'https://keirin.kdreams.jp/takeo/racedetail/84202611120100'+String(number).padStart(2,'0')+'/',
 meetingStart:'20261112',players:[1,2].map(no=>({no,name:'選手'+number+no,period:100+no,playerId:'015'+number+'0'+no}))}));
function meeting(index){
 const start=new Date(Date.UTC(2026,7,1+index*9));
 const venue=index===9?'小倉':index===8?'いわき平':'京王閣',code=index===9?'81':index===8?'13':'27';
 const grade=index===9?4:index===8?3:2;
 const days=Array.from({length:index===9?5:3},(_,offset)=>{
  const date=new Date(start);date.setUTCDate(date.getUTCDate()+offset);
  const raw=date.toISOString().slice(0,10),number=offset+1;
  return {race_date:raw,race_id:String(number).padStart(2,'0')+code+raw.replaceAll('-',''),race_number:number,
   order:number,accident:'',race_type:['Ｓ級初日特選','S級準決勝','S級準々決勝','S級決勝','S級一般'][offset],
   video_url:'https://keirin.kdreams.jp/stadium/digest/?kyogijoCd='+code+'&kaisaiDate='+raw.replaceAll('-','')+'&gradeCd='+grade+'&raceNo='+number};
 });
 return {venue,venue_code:code,grade_code:grade,start_date:start.toISOString().slice(0,10),days};
}
function payload(){return {schema_version:1,provider:'keirin.jp',target_date:target,races:races.map(race=>({source_url:race.source,
 players:race.players.map(player=>({no:player.no,name:player.name,period:player.period,player_id:player.playerId,
 meetings:Array.from({length:10},(_,index)=>meeting(index)).slice(player.no===2?2:0)}))}))};}
function rowsMarkup(){return races.map(race=>'<tr><td><a class="race-link" href="'+race.source+'">6R</a><div class="lineup"><div class="line-group">'+race.players.map(player=>'<div class="rider"><span class="car">'+player.no+'</span><span class="stat-b">10</span><span class="meeting-rank previous-important-rank">1</span><span class="meeting-rank previous-semifinal-rank">2</span><div class="previous-controls"><button class="previous-toggle">前回</button><div class="previous-results" hidden></div></div></div>').join('')+'</div></div></td></tr>').join('');}
async function open({data=payload(),opted=true,fail=false,files={}}={}){
 let calls=0;const videos=[],errors=[],requested=[];
 const html='<!doctype html><html><head><base href="/keirin-lineup2/data/20261112/"><style>.rider{display:flex;flex-direction:column;width:22px}.line-group{display:flex;gap:0}'+css+'</style></head><body'+(opted?' data-ten-meetings="true"':'')+'><table><tbody id="rows">'+rowsMarkup()+'</tbody></table><script>const races='+JSON.stringify(races)+';const conditionDate="'+target+'";</script></body></html>';
 const dom=new JSDOM(html,{url:'https://itaingtr.github.io/keirin-lineup2/index2.html',runScripts:'dangerously',beforeParse(w){
  w.fetch=async (url,options)=>{calls++;requested.push(String(url));if(fail)throw Error('offline');
   const file=files[new URL(String(url)).pathname];
   if(file){assert.equal(options.cache,'force-cache');return {ok:true,json:async()=>JSON.parse(JSON.stringify(file))};}
   assert.equal(String(url),'https://itaingtr.github.io/keirin-lineup2/data/20261112/ten-meetings.json');assert.equal(options.cache,'no-store');
   return {ok:true,json:async()=>JSON.parse(JSON.stringify(data))};};
  w.openVideo=(event,url)=>{event.preventDefault();videos.push(url);};
  Object.defineProperty(w,'keirinBoard',{get(){assert.fail('The compact history must not access the database client');}});
  w.addEventListener('error',event=>errors.push(event.error||event.message));
 }});
 dom.window.eval(script);await pause();return {dom,videos,errors,requested,calls:()=>calls};
}
async function basic(){
 const app=await open();
 try{
  const doc=app.dom.window.document,rows=[...doc.querySelectorAll('#rows > tr')],first=rows[0];
  assert.equal(doc.body.dataset.tenMeetingsStatus,'ready');assert.equal(app.calls(),1);
  assert.equal(doc.querySelectorAll('.ten-toggle').length,4);
  assert.deepEqual([...first.querySelector('.rider').querySelectorAll('button')].map(n=>n.textContent),['前回','成績']);
  assert.ok([...doc.querySelectorAll('.ten-results')].every(panel=>panel.hidden));
  first.querySelector('.ten-toggle').click();
  assert.ok([...first.querySelectorAll('.ten-results')].every(panel=>!panel.hidden));
  assert.ok([...rows[1].querySelectorAll('.ten-results')].every(panel=>panel.hidden));
  assert.equal(first.querySelector('.previous-results').hidden,true,'The 前回 and 成績 controls stay independent');
  const panels=first.querySelectorAll('.ten-results'),blocks=panels[0].querySelectorAll('.ten-meeting');
  assert.equal(blocks.length,10);assert.equal(panels[1].querySelectorAll('.ten-meeting[aria-hidden="true"]').length,2);
  assert.equal(blocks[7].querySelector('.ten-venue').textContent,'10京王');
  assert.equal(blocks[8].querySelector('.ten-venue').textContent,'平');
  assert.equal(blocks[9].querySelector('.ten-heading').textContent,'小倉1');
  assert.equal(blocks[9].querySelector('.ten-ranks').textContent,'2345');
  assert.equal(app.dom.window.getComputedStyle(blocks[9].querySelector('.ten-venue')).backgroundColor,'rgb(243, 229, 245)');
  assert.equal(app.dom.window.getComputedStyle(blocks[8].querySelector('.ten-venue')).backgroundColor,'rgb(255, 235, 238)');
  const lastRanks=blocks[9].querySelectorAll('.ten-rank');
  assert.deepEqual([...lastRanks].map(n=>n.classList.contains('ten-rank-highlight')),[true,true,false,true,false]);
  for(const rank of [...lastRanks].filter(n=>n.classList.contains('ten-rank-highlight')))assert.equal(app.dom.window.getComputedStyle(rank).color,rank.classList.contains('ten-rank-semifinal')?'rgb(232, 90, 154)':'rgb(211, 47, 47)');
  for(const rank of doc.querySelectorAll('.previous-important-rank,.previous-semifinal-rank'))assert.equal(app.dom.window.getComputedStyle(rank).color,rank.classList.contains('previous-semifinal-rank')?'rgb(232, 90, 154)':'rgb(211, 47, 47)');
  assert.equal(app.dom.window.getComputedStyle(doc.querySelector('.stat-b')).fontWeight,'700');
  assert.equal(app.dom.window.getComputedStyle(blocks[0]).height,'18px');
  assert.equal(app.dom.window.getComputedStyle(doc.querySelector('.rider')).width,'22px');
  lastRanks[0].click();assert.equal(app.videos.length,1);assert.match(app.videos[0],/kyogijoCd=81/);
  first.querySelectorAll('.ten-toggle')[1].click();assert.ok([...first.querySelectorAll('.ten-results')].every(panel=>panel.hidden));
  first.querySelector('.ten-toggle').click();
  doc.getElementById('rows').innerHTML=rowsMarkup();await pause();
  assert.equal(doc.querySelectorAll('.ten-toggle').length,4);assert.ok([...doc.querySelector('#rows > tr').querySelectorAll('.ten-results')].every(panel=>!panel.hidden),'Search rerender retains race expansion');
  assert.equal(app.calls(),1);assert.deepEqual(app.errors,[]);
 }finally{app.dom.window.close();}
}
async function guards(){
 const supplemental=payload();
 const second=supplemental.races[0].players[0].meetings[1];second.start_date='2026-08-03';second.days=second.days.slice(0,1);
 Object.assign(second.days[0],{race_date:'2026-08-05',race_id:'012720260805',video_url:'https://keirin.kdreams.jp/stadium/digest/?kyogijoCd=27&kaisaiDate=20260805&gradeCd=2&raceNo=1'});
 const joined=await open({data:supplemental});
 try{assert.equal(joined.dom.window.document.body.dataset.tenMeetingsStatus,'ready','Meeting starts can overlap when actual supplementary rides do not');}finally{joined.dom.window.close();}
 const missing=payload();Object.assign(missing.races[0].players[0].meetings[0].days[0],{race_id:null,race_number:null,video_url:null});
 const partial=await open({data:missing});
 try{assert.equal(partial.dom.window.document.body.dataset.tenMeetingsStatus,'ready');
  const first=partial.dom.window.document.querySelector('.ten-rank');assert.equal(first.tagName,'SPAN');assert.equal(first.textContent,'1');assert.doesNotMatch(first.title,/null/);
 }finally{partial.dom.window.close();}
 const normal=await open({opted:false});
 try{assert.equal(normal.calls(),0);assert.equal(normal.dom.window.document.querySelector('.ten-toggle'),null);}finally{normal.dom.window.close();}
 for(const alter of [data=>data.target_date='2026-11-11',data=>data.races[0].players[0].player_id='999999',
  data=>data.races[0].players[0].meetings[0].days[0].video_url='https://example.com/video',
  data=>data.races[0].players[0].meetings[0].days[0].video_url+='&raceNo=12',
  data=>data.races[0].players[0].meetings[0].days[0].race_id='129920261001',
  data=>data.races[0].players[0].meetings.reverse()]){
  const data=payload();alter(data);const app=await open({data});
  try{assert.equal(app.dom.window.document.body.dataset.tenMeetingsStatus,'error');assert.ok([...app.dom.window.document.querySelectorAll('.ten-toggle')].every(button=>button.disabled));assert.deepEqual(app.errors,[]);}finally{app.dom.window.close();}
 }
 const offline=await open({fail:true});try{assert.equal(offline.dom.window.document.body.dataset.tenMeetingsStatus,'error');}finally{offline.dom.window.close();}
}
async function sharedMaster(){
 const data=payload(),files={};data.history_storage='rider-master';
 for(const race of data.races)for(const player of race.players){
  const record={schema_version:1,player_id:player.player_id,name:player.name,period:player.period,meetings:player.meetings};
  const sha=require('node:crypto').createHash('sha256').update(JSON.stringify(record)).digest('hex');
  player.history_ref={path:'rider-history/'+player.player_id+'/'+sha+'.json',sha256:sha};
  files['/keirin-lineup2/'+player.history_ref.path]=record;delete player.meetings;
 }
 const app=await open({data,files});
 try{
  const doc=app.dom.window.document,rows=doc.querySelectorAll('#rows > tr');
  assert.equal(doc.body.dataset.tenMeetingsStatus,'ready');assert.equal(app.calls(),1,'Only small card references are loaded initially');
  rows[0].querySelector('.ten-toggle').click();await pause();
  assert.ok([...rows[0].querySelectorAll('.ten-results')].every(n=>!n.hidden));
  assert.equal(app.calls(),3,'Only the selected race riders are fetched');
  assert.equal(rows[1].querySelector('.ten-results').hidden,true);
  rows[0].querySelector('.ten-toggle').click();await pause();rows[0].querySelector('.ten-toggle').click();await pause();
  assert.equal(app.calls(),3,'Reopening uses the same immutable rider files');
  rows[1].querySelector('.ten-toggle').click();await pause();assert.equal(app.calls(),5);
  assert.deepEqual(app.errors,[]);
 }finally{app.dom.window.close();}
 const broken=JSON.parse(JSON.stringify(files));broken[Object.keys(broken)[0]].player_id='999999';
 const bad=await open({data,files:broken});
 try{const first=bad.dom.window.document.querySelector('.ten-toggle');first.click();await pause();assert.equal(first.getAttribute('aria-expanded'),'false');assert.equal(first.disabled,false);assert.deepEqual(bad.errors,[]);}
 finally{bad.dom.window.close();}
}
async function actual(htmlPath,jsonPath){
 const html=fs.readFileSync(htmlPath,'utf8'),sourceData=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
 const publicRoot=path.resolve(path.dirname(jsonPath),'../..');
 const data=JSON.parse(JSON.stringify(sourceData));
 if(data.history_storage==='rider-master')for(const r of data.races)for(const p of r.players)p.meetings=JSON.parse(fs.readFileSync(path.join(publicRoot,p.history_ref.path),'utf8')).meetings;
 const previousFile=/data-previous-meetings-src="([^"]+)"/.exec(html)?.[1]||'previous-meetings.json';
 const prior=JSON.parse(fs.readFileSync(path.join(path.dirname(jsonPath),previousFile),'utf8'));
 const dom=new JSDOM(html,{url:'https://itaingtr.github.io/keirin-lineup2/index2.html',runScripts:'dangerously',beforeParse(w){
  w.matchMedia=()=>({matches:false});w.setInterval=()=>0;w.keirinBoard={ready:false};
  w.fetch=async input=>{const url=new URL(String(input));return {ok:true,json:async()=>url.pathname.includes('/rider-history/')
    ?JSON.parse(fs.readFileSync(path.join(publicRoot,url.pathname.replace('/keirin-lineup2/','')),'utf8'))
    :url.pathname.endsWith('/ten-meetings.json')?sourceData:prior};};
 }});
 try{
  dom.window.eval(fs.readFileSync(path.join(project,'site/previous-meetings.js'),'utf8'));
  dom.window.eval(script);
  for(let i=0;i<40&&dom.window.document.body.dataset.tenMeetingsStatus!=='ready';i++)await pause();
  assert.equal(dom.window.document.body.dataset.tenMeetingsStatus,'ready');
  const rows=[...dom.window.document.querySelectorAll('#rows > tr')];let riders=0,results=0,linked=0;
  for(const race of data.races){
   const row=rows.find(row=>{const a=row.querySelector('.race-link');return (a.dataset.raceSource||a.href)===race.source_url;});
   assert.ok(row);row.querySelector('.ten-toggle').click();await pause();
   for(const player of race.players){
    const rider=[...row.querySelectorAll('.lineup .rider')].find(n=>Number(n.querySelector('.car').textContent)===player.no);
    const panel=rider.querySelector('.ten-results');assert.equal(panel.hidden,false);riders++;
    assert.equal(panel.querySelectorAll('.ten-meeting').length,10);
    const expected=player.meetings.flatMap(m=>m.days),actual=[...panel.querySelectorAll('.ten-rank')];
    assert.equal(actual.length,expected.length);
    actual.forEach((node,i)=>{const r=expected[i];assert.equal(node.textContent,r.order?String(r.order):r.accident||'');
      assert.equal(node.tagName==='A',Boolean(r.video_url));if(r.video_url){assert.equal(node.href,r.video_url);linked++;}results++;});
   }
  }
  console.log('ACTUAL TEN MEETINGS DOM PASS',JSON.stringify({races:data.races.length,riders,results,linked}));
 }finally{dom.window.close();}
}
(async()=>{await basic();await guards();await sharedMaster();if(process.argv[2]&&process.argv[3])await actual(process.argv[2],process.argv[3]);console.log('TEN MEETINGS UI PASS: shared immutable rider references, race-only lazy fetch and cache, compact ten meetings, verified links, special/final red, semifinal pink, bold B and archive isolation.');})().catch(error=>{console.error(error);process.exitCode=1;});
