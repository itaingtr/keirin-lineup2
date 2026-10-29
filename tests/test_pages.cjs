const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {JSDOM}=require('jsdom');const vm=require('node:vm');
const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const root=path.resolve(__dirname,'..'),publicDir=path.join(root,'public');
const day=report.target_date.replaceAll('-','');
const feed=JSON.parse(fs.readFileSync(report.local_odds_file,'utf8'));
const expected=new Map(feed.results.filter(x=>x.ok).map(x=>[x.snapshot.race_key,x.snapshot]));
const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
assert.equal(html,fs.readFileSync(path.join(publicDir,'line'+day+'.html'),'utf8'));
const config=JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'odds-config.json'),'utf8'));
const media=JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'media.json'),'utf8'));
const usesRakuten=day>='20261030';
const rakutenMarks=usesRakuten?JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'rakuten-marks.json'),'utf8')):null;
const sourceRaces=JSON.parse(/const races=(.*);\nconst body=/.exec(html)[1]);
const videoGrades=JSON.parse(/const videoGrades=(.*);\n/.exec(html)[1]);
const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
let pairs=0,links=0,riders=0,replays=0,jumps=0,historyReplays=0;
(async()=>{
 for(const route of ['', 'line'+day+'.html']){
  const url='https://itaingtr.github.io/keirin-lineup2/'+route;
  const errors=[];
  const dom=new JSDOM(html,{url,runScripts:'dangerously',beforeParse(window){
   window.matchMedia=()=>({matches:false});
   window.fetch=async input=>{
    const u=new URL(String(input),window.document.baseURI);
    if(u.hostname==='raw.githubusercontent.com'){
     const saved=new URL(config.endpoint);assert.equal(u.origin+u.pathname,saved.origin+saved.pathname);
     return {ok:true,json:async()=>feed};
    }
    assert.equal(u.origin,'https://itaingtr.github.io');
    assert.ok(u.pathname.startsWith('/keirin-lineup2/data/'+day+'/'));
    return {ok:true,json:async()=>u.pathname.endsWith('odds-config.json')?config:u.pathname.endsWith('media.json')?media:feed};
   };
   window.addEventListener('error',e=>errors.push(e.error||e.message));
  }});
  const {window}=dom;const doc=window.document;
  for(const file of usesRakuten?['odds-current-rakuten.js','odds-comparison.js']:['predictions.js','odds-current.js','odds-comparison.js'])window.eval(fs.readFileSync(path.join(publicDir,file),'utf8'));
  await pause();
  assert.equal(doc.querySelectorAll('.race-link').length,report.races);
  assert.equal(doc.querySelectorAll('.lineup .rider').length,report.riders);
  assert.equal(doc.querySelector('iframe,dialog,video,script[src*="viewer.js"]'),null);
  const firstByVenue=new Map();for(const race of sourceRaces)if(!firstByVenue.has(race.venueCode))firstByVenue.set(race.venueCode,race);
  const venueButtons=[...doc.querySelectorAll('#venue-nav .venue-button')];
  assert.deepEqual(venueButtons.map(a=>a.textContent),[...firstByVenue.values()].map(r=>r.venue));
  for(const [index,button] of venueButtons.entries()){
   const race=[...firstByVenue.values()][index],destination=new URL(button.href);
   assert.equal(destination.origin,new URL(url).origin);assert.equal(destination.pathname,new URL(url).pathname);
   const target=doc.getElementById(destination.hash.slice(1));assert.ok(target);
   assert.equal(target.querySelector('.race-link').href,usesRakuten?'https://my.keirin.kdreams.jp'+race.commentKey:race.source);
   assert.equal(race.race,Math.min(...sourceRaces.filter(r=>r.venueCode===race.venueCode).map(r=>r.race)));
   button.click();await pause();assert.equal(window.location.hash,destination.hash);jumps++;
  }
  const search=doc.getElementById('search'),selected=sourceRaces.find(r=>r.venue==='岐阜')||sourceRaces[0];
  search.value=selected.venue;search.dispatchEvent(new window.Event('input'));await pause();
  assert.equal(doc.querySelectorAll('#venue-nav .venue-button').length,1);
  assert.equal(doc.querySelector('#venue-nav .venue-button').textContent,selected.venue);
  search.value='';search.dispatchEvent(new window.Event('input'));await pause();
  for(const script of doc.querySelectorAll('script[src]')){
   const p=new URL(script.src).pathname;assert.ok(p.startsWith('/keirin-lineup2/'));
   assert.ok(fs.existsSync(path.join(publicDir,p.slice('/keirin-lineup2/'.length))));
  }
  for(const a of doc.querySelectorAll('.live-link')){
   assert.equal(a.target,'_self');assert.equal(a.href,a.dataset.sourceUrl);
   assert.equal(new URL(a.href).origin,'https://www.winticket.jp');
   links++;
  }
  for(const option of doc.querySelectorAll('#date-select option')){
   const u=new URL(option.value,url);assert.ok(u.pathname.startsWith('/keirin-lineup2/line'));
   assert.ok(fs.existsSync(path.join(publicDir,path.basename(u.pathname))));
  }
  for(const [i,row] of [...doc.querySelector('#rows').children].entries()){
   const race=sourceRaces[i];riders+=race.players.length;
   assert.equal(row.id,'race-'+race.venueCode+'-'+race.race);
   if(usesRakuten){
    const heading=row.querySelector('.race-link');assert.equal(heading.href,'https://my.keirin.kdreams.jp'+race.commentKey);
    assert.equal(heading.dataset.raceSource,race.source);assert.equal(heading.dataset.commentKey,race.commentKey);
    const published=rakutenMarks.races.find(r=>r.source_url===race.source);assert.ok(published);
    for(const rider of row.querySelectorAll('.lineup .rider')){
     const number=Number(rider.querySelector('.car').textContent),player=published.players.find(p=>p.no===number);
     assert.equal(rider.querySelector('.prediction-mark').textContent,player.mark);
     assert.equal(rider.querySelector('.prediction-mark').title,'楽天Kドリームスの予想印');
    }
   }
   for(const rider of row.querySelectorAll('.lineup .rider')){
    const player=race.players.find(p=>p.no===Number(rider.querySelector('.car').textContent));
    assert.equal(rider.querySelectorAll('.meeting-order').length,player.meetingResults.length);
    for(const result of player.meetingResults){
     const order=rider.querySelector('.meeting-result[data-meeting-day="'+result.meeting_day+'"] .meeting-order');
     assert.ok(order);const historyVideo=new URL(order.href);
     assert.equal(historyVideo.origin,'https://my.keirin.kdreams.jp');assert.equal(historyVideo.pathname,'/stadium/digest/');
     assert.equal(historyVideo.searchParams.get('kyogijoCd'),race.venueCode);
     assert.equal(historyVideo.searchParams.get('kaisaiDate'),result.race_date.replaceAll('-',''));
     assert.equal(historyVideo.searchParams.get('raceNo'),String(result.race_number));
     assert.equal(historyVideo.searchParams.get('gradeCd'),videoGrades[race.venueCode+race.meetingStart]);
     assert.equal(historyVideo.searchParams.get('l-id'),'Highlightreel');
     assert.equal(order.href,order.dataset.sourceUrl);assert.equal(order.target,'_blank');
     assert.equal(order.querySelector('.meeting-rank').textContent,result.has_accident?result.accident:String(result.order));
     assert.equal(Boolean(order.querySelector('.meeting-back')),result.back);
     let opened;window.open=(...args)=>{opened=args;};order.click();
     assert.deepEqual(opened,[order.href,'kdreams-video','width=750,height=470,toolbar=no,location=no,menubar=no,status=no,scrollbars=yes,resizable=yes']);
     historyReplays++;
    }
   }
   const replay=row.querySelector('.video-link:not(.live-link)'),video=new URL(replay.href);
   assert.equal(video.origin,'https://my.keirin.kdreams.jp');assert.equal(video.pathname,'/stadium/digest/');
   assert.equal(video.searchParams.get('kyogijoCd'),race.venueCode);
   assert.equal(video.searchParams.get('kaisaiDate'),day);
   assert.equal(video.searchParams.get('raceNo'),String(race.race));
   assert.equal(video.searchParams.get('gradeCd'),videoGrades[race.venueCode+race.meetingStart]);
   assert.equal(video.searchParams.get('l-id'),'Highlightreel');
   assert.equal(replay.href,replay.dataset.sourceUrl);assert.equal(replay.target,'_blank');
   let opened;window.open=(...args)=>{opened=args;};replay.click();
   assert.deepEqual(opened,[replay.href,'kdreams-video','width=750,height=470,toolbar=no,location=no,menubar=no,status=no,scrollbars=yes,resizable=yes']);
   const mobileLocation={href:''};let prevented=false;
   vm.runInNewContext('('+window.openVideo.toString()+')(event,url)',{
    event:{preventDefault(){prevented=true;}},url:replay.href,location:mobileLocation,
    window:{matchMedia(query){assert.equal(query,'(max-width: 640px)');return {matches:true};},open(){assert.fail('Mobile replay must use the same tab');}}
   });
   assert.ok(prevented);assert.equal(mobileLocation.href,replay.href);replays++;
   row.querySelector('.odds-toggle').click();await pause();
   const snapshot=expected.get(new URL(race.source).pathname);
   if(!snapshot||snapshot.status!=='snapshot')continue;
   const tables=[...row.querySelectorAll('.exacta-matrix')];assert.equal(tables.length,2);
   assert.equal(tables[0].dataset.oddsOrder,'number');assert.equal(tables[1].dataset.oddsOrder,'lineup');
   for(const table of tables)for(const quote of snapshot.odds){
    const cell=table.querySelector(`[data-combination="${quote.first}-${quote.second}"]`);assert.ok(cell);
    assert.equal(cell.textContent,quote.value===null?'—':quote.value>=100?String(Math.floor(quote.value)):quote.value.toFixed(1));pairs++;
   }
  }
  if(usesRakuten){assert.doesNotMatch(doc.querySelector('main').textContent,/ウィンチケット|WINTICKET/i);assert.equal(doc.querySelector('script[src*="predictions.js"]'),null);}
  assert.deepEqual(errors,[]);dom.window.close();
 }
 console.log('PUBLIC PAGES DOM PASS',JSON.stringify({races:report.races,riders,paired_odds_cells:pairs,same_tab_links:links,replay_links:replays,history_replay_links:historyReplays,venue_jumps:jumps,urls:2}));
})().catch(error=>{console.error(error);process.exitCode=1;});
