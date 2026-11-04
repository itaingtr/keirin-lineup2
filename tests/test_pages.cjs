const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {JSDOM}=require('jsdom');const vm=require('node:vm');
const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const root=path.resolve(__dirname,'..'),publicDir=report.public_dir||path.join(root,'public');
const day=report.target_date.replaceAll('-','');
const feed=JSON.parse(fs.readFileSync(report.local_odds_file,'utf8'));
const expected=new Map(feed.results.filter(x=>x.ok).map(x=>[x.snapshot.race_key,x.snapshot]));
const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
assert.equal(html,fs.readFileSync(path.join(publicDir,'line'+day+'.html'),'utf8'));
const config=JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'odds-config.json'),'utf8'));
const media=JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'media.json'),'utf8'));
const usesRakuten=day>='20261030';
const usesConditions=day>='20261102';
const usesRiderAppearance=day>='20261103';
const rakutenMarks=usesRakuten?JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'rakuten-marks.json'),'utf8')):null;
const sourceRaces=JSON.parse(/const races=(.*);\nconst body=/.exec(html)[1]);
const usesOfficial=sourceRaces.every(r=>new URL(r.source).hostname.endsWith('kdreams.jp'));
const detailsPath=path.join(publicDir,'data',day,'rider-details.json');
const riderDetails=fs.existsSync(detailsPath)?JSON.parse(fs.readFileSync(detailsPath,'utf8')):null;
if(usesOfficial){assert.equal(media.provider,'kdreams');assert.ok(config.endpoint.includes('/fallback/kdreams/exacta/'));assert.doesNotMatch(html,/winticket|ウィンチケット/i);}
const videoGrades=JSON.parse(/const videoGrades=(.*);\n/.exec(html)[1]);
let legacyLineup;
if(usesConditions){
 const old=new JSDOM(fs.readFileSync(path.join(publicDir,'line20261101.html'),'utf8'),{runScripts:'dangerously',url:'https://itaingtr.github.io/keirin-lineup2/line20261101.html'});
 const ow=old.window,od=ow.document;
 legacyLineup={riderBasis:ow.getComputedStyle(od.querySelector('.lineup .rider')).flexBasis,lineGap:ow.getComputedStyle(od.querySelector('.lineup')).gap,withinGap:ow.getComputedStyle(od.querySelector('.line-group')).gap};
 assert.equal(legacyLineup.riderBasis,'22px');old.window.close();
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
let pairs=0,links=0,riders=0,replays=0,jumps=0,historyReplays=0;
const activeWindows=[];
(async()=>{
 for(const route of ['', 'line'+day+'.html']){
  const url='https://itaingtr.github.io/keirin-lineup2/'+route;
  const errors=[];
  const styledHtml=usesConditions?html.replace(/<link\b[^>]*href="[^"]*\/rider-condition\.css[^"]*"[^>]*>/,()=>'<style>'+fs.readFileSync(path.join(publicDir,'rider-condition.css'),'utf8')+'</style>'):html;
  const dom=new JSDOM(styledHtml,{url,runScripts:'dangerously',beforeParse(window){
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
  activeWindows.push(dom.window);
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
   assert.equal(target.querySelector('.race-link').href,usesOfficial?race.source:usesRakuten?'https://my.keirin.kdreams.jp'+race.commentKey:race.source);
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
   assert.equal(new URL(a.href).origin,usesConditions?'https://keirin.kdreams.jp':'https://www.winticket.jp');
   if(usesConditions){const live=new URL(a.href);assert.equal(live.pathname,'/stadium/live/');assert.equal(live.searchParams.get('kyogijoCd'),a.closest('tr').id.split('-')[1]);}
   links++;
  }
  for(const option of doc.querySelectorAll('#date-select option')){
   const u=new URL(option.value,url);assert.ok(u.pathname.startsWith('/keirin-lineup2/line'));
   assert.ok(fs.existsSync(path.join(publicDir,path.basename(u.pathname))));
  }
  for(const [i,row] of [...doc.querySelector('#rows').children].entries()){
   const race=sourceRaces[i];riders+=race.players.length;
   assert.equal(row.id,'race-'+race.venueCode+'-'+race.race);
   if(usesConditions){
    const lineup=row.querySelector('.lineup'),groups=[...lineup.children];
    assert.deepEqual(groups.map(g=>[...g.querySelectorAll('.rider .car')].map(c=>Number(c.textContent))),race.groups.map(line=>line.flatMap(unit=>unit.riders)));
    assert.equal(window.getComputedStyle(lineup).gap,legacyLineup.lineGap);
    for(const group of groups){assert.equal(window.getComputedStyle(group).gap,legacyLineup.withinGap);}
    for(const rider of lineup.querySelectorAll('.rider'))assert.equal(window.getComputedStyle(rider).flexBasis,legacyLineup.riderBasis);
    const actions=[...row.querySelectorAll('.video-actions > a')];
    assert.deepEqual(actions.map(a=>a.textContent),['映像','結果','ライブ']);
    assert.ok(actions[0].classList.contains('video-link'));assert.ok(actions[1].classList.contains('result-link'));assert.ok(actions[2].classList.contains('live-link'));
    const result=new URL(actions[1].href);assert.equal(result.origin,'https://keirin.kdreams.jp');assert.equal(result.pathname,race.commentKey);assert.equal(result.searchParams.get('pageType'),'showResult');assert.equal(actions[1].target,'_self');
    for(const player of race.players){
     const car=row.querySelector('.condition-car[data-player-id="'+player.playerId+'"]');assert.ok(car);assert.equal(car.type,'button');assert.equal(car.textContent,String(player.no));
     assert.equal(car.dataset.raceId,String(race.race).padStart(2,'0')+race.venueCode+day);
     const today=car.closest('.rider').querySelector('.condition-today');assert.ok(today);assert.equal(today.textContent,'');
     if(usesRiderAppearance){
      const rider=car.closest('.rider'),period=rider.querySelector('.period'),s=rider.querySelector('.recent-s');
      if(riderDetails){
       const profile=period.nextElementSibling;assert.ok(profile.classList.contains('rider-profile'));assert.equal(profile.nextElementSibling,s);
       const saved=riderDetails.races.find(r=>r.source_url===race.source).players.find(p=>p.no===player.no);
       assert.equal(period.type,'button');assert.equal(period.getAttribute('aria-expanded'),'false');assert.equal(profile.hidden,true);
       assert.equal(profile.querySelector('.rider-prefecture').textContent,Array.from(saved.prefecture).slice(0,2).join(''));assert.equal(profile.querySelector('.rider-age').textContent,String(saved.age));
       period.click();assert.equal(profile.hidden,false);assert.ok(row.classList.contains('rider-details-open'));assert.equal(period.getAttribute('aria-expanded'),'true');
       period.click();assert.equal(profile.hidden,true);assert.equal(row.classList.contains('rider-details-open'),false);
      }else assert.equal(period.nextElementSibling,s);
      assert.ok(s.nextElementSibling.classList.contains('stats'));assert.equal(s.textContent,usesOfficial&&player.stats[0]===0?'':String(player.stats[0]));
      const back=s.nextElementSibling.firstElementChild;assert.ok(back.classList.contains('stat-b')||back.classList.contains('stat-b-zero'));assert.equal(back.textContent,String(player.stats[1]));
      assert.equal(window.getComputedStyle(back).fontSize,'10px');assert.equal(window.getComputedStyle(back).fontWeight,'400');
      assert.equal(window.getComputedStyle(today).fontSize,'8px');assert.equal(window.getComputedStyle(today).fontWeight,'400');assert.equal(window.getComputedStyle(today).color,'rgb(211, 47, 47)');
      for(const flag of rider.querySelectorAll('.meeting-back')){assert.equal(window.getComputedStyle(flag).fontSize,'8px');assert.equal(window.getComputedStyle(flag).fontWeight,'400');}
      for(const timing of rider.querySelectorAll('.meeting-time'))assert.equal(window.getComputedStyle(timing).fontSize,'8px');
     }
    }
   }
   if(usesRakuten){
    const heading=row.querySelector('.race-link');assert.equal(heading.href,usesOfficial?race.source:'https://my.keirin.kdreams.jp'+race.commentKey);
    assert.equal(heading.dataset.raceSource,race.source);assert.equal(heading.dataset.commentKey,race.commentKey);
    const published=rakutenMarks.races.find(r=>r.source_url===race.source);assert.ok(published);
    for(const rider of row.querySelectorAll('.lineup .rider')){
     const number=Number(rider.querySelector('.car').textContent),player=published.players.find(p=>p.no===number);
     const actualPlayer=race.players.find(p=>p.no===number);assert.equal(rider.querySelector('.prediction-mark').textContent,usesOfficial&&actualPlayer.absent?'欠':player.mark);
     assert.equal(rider.querySelector('.prediction-mark').title,usesOfficial&&actualPlayer.absent?'楽天Kドリームス掲載の欠場':'楽天Kドリームスの予想印');
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
     assert.equal(Boolean(order.querySelector('.meeting-back:not(.meeting-start):not(.meeting-home)')),result.back);
     if(usesOfficial){assert.equal(Boolean(order.querySelector('.meeting-start')),Boolean(result.start));assert.equal(Boolean(order.querySelector('.meeting-home')),Boolean(result.home));assert.equal(window.getComputedStyle(order.parentElement).justifyContent,'flex-start');}
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
 if(usesConditions){await require('./test_board_passphrase.cjs')();await require('./test_rider_conditions.cjs')({html,date:report.target_date});}
 console.log('PUBLIC PAGES DOM PASS',JSON.stringify({races:report.races,riders,paired_odds_cells:pairs,same_tab_links:links,replay_links:replays,history_replay_links:historyReplays,venue_jumps:jumps,urls:2}));
})().catch(error=>{for(const window of activeWindows)if(window.document)window.close();console.error(error);process.exitCode=1;});
