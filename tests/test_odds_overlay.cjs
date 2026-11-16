// Real odds readers with the scoped presentation adapter; all requests mocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.resolve(process.argv[2]||'public');
const now=Date.now(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const races=[1,2].map(n=>({source:'https://keirin.kdreams.jp/aomori/racedetail/122026111601000'+n+'/',players:[1,2,3].map(no=>({no,name:'選手'+no}))}));
const markup=races.map(race=>'<tr><td class="race"><a class="race-link" href="'+race.source+'">1R</a></td><td class="lineup-cell"><div class="lineup"><div class="line-group">'+race.players.map(p=>'<span class="rider"><span class="score">100</span><span class="car">'+p.no+'</span><span class="name">'+p.name+'</span></span>').join('')+'</div></div></td></tr>').join('');
function feed(offset=0,age=0){return {results:races.map(race=>({ok:true,snapshot:{provider:'kdreams',parser_version:2,race_key:new URL(race.source).pathname,bet_type:'exacta',status:'snapshot',observed_at:new Date(now-3600000+age).toISOString(),odds:race.players.flatMap(a=>race.players.filter(b=>a.no!==b.no).map(b=>({first:a.no,second:b.no,value:a.no*10+b.no+.25+offset})))}}))};}
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
(async()=>{
 let current=feed(),fail=false,loads=0;
 const errors=[];
 const dom=new JSDOM('<!doctype html><body data-odds-overlay="up-20261116" data-auto-odds="true" data-contest-odds="true" data-all-results-date="'+day.replaceAll('-','')+'"><table><tbody id="rows" data-initial-odds data-odds-primary="number">'+markup+'</tbody></table><script>const races='+JSON.stringify(races)+';</script></body>',{
  url:'https://itaingtr.github.io/keirin-lineup2/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
   w.fetch=async input=>{
    if(String(input).includes('odds-config.json'))return {ok:true,json:async()=>({endpoint:'https://example.test/latest.json'})};
    loads++;if(fail)throw new Error('network');return {ok:true,json:async()=>current};
   };
   w.addEventListener('error',event=>errors.push(event.message));
  }
 });
 try{
  const w=dom.window,d=w.document,root=d.getElementById('rows');
  // The adapter executes before the deferred readers in the actual export.
  for(const file of ['odds-overlay.js','odds-current-compact.js','odds-comparison-compact.js'])w.eval(fs.readFileSync(path.join(directory,file),'utf8'));
  await pause();let rows=[...root.children];
  const band=row=>row.querySelector('.rider-odds'),panel=row=>row.querySelector('.odds-cell');
  const price=row=>panel(row).querySelector('[data-combination="1-2"]').textContent;
  const time=row=>panel(row).querySelector('.exacta-time');
  const refresh=row=>panel(row).querySelector('.odds-refresh');
  assert.equal(loads,1);
  assert.equal(rows[0].querySelector('.odds-toggle').hidden,true);
  assert.equal(band(rows[0]).getAttribute('role'),'button');
  band(rows[0]).click();await pause();
  assert.equal(loads,1,'Opening reuses the confirmed initial feed');
  assert.equal(panel(rows[0]).hidden,false);assert.equal(rows[0].classList.contains('odds-open'),false);
  assert.equal(panel(rows[0]).querySelectorAll('.exacta-matrix').length,2);
  const control=refresh(rows[0]);
  assert.equal(control.closest('.exacta-column-rider').querySelector('.exacta-number').textContent,'1');
  assert.equal(control.nextElementSibling,time(rows[0]));
  assert.match(time(rows[0]).textContent,/^\d{2}:\d{2}$/);
  const observed=time(rows[0]).dateTime;
  fail=true;control.click();await pause();
  assert.equal(price(rows[0]),'12.3');assert.equal(time(rows[0]).dateTime,observed);assert.equal(time(rows[0]).dataset.stale,'true');
  fail=false;current=feed(10,900000);control.click();await pause();
  assert.equal(price(rows[0]),'22.3');assert.equal(time(rows[0]).dateTime,current.results[0].snapshot.observed_at);
  assert.equal(refresh(rows[0]),control,'The same native refresh listener survives a replaced matrix');
  assert.equal(time(rows[0]).dataset.stale,'false');
  const confirmed=time(rows[0]).dateTime;
  current=feed();control.click();await pause();assert.equal(price(rows[0]),'22.3');assert.equal(time(rows[0]).dateTime,confirmed);
  band(rows[1]).click();await pause();
  assert.equal(panel(rows[0]).hidden,true);assert.equal(panel(rows[1]).hidden,false,'Only the selected race stays open');
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();assert.equal(panel(rows[1]).hidden,true);
  band(rows[0]).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause();assert.equal(panel(rows[0]).hidden,false);
  band(rows[0]).dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',bubbles:true}));await pause();assert.equal(panel(rows[0]).hidden,true);
  band(rows[0]).click();await pause();d.body.click();await pause();assert.equal(panel(rows[0]).hidden,true);
  // A normal card search replaces the row elements. It must retain the
  // checked feed while installing fresh, closed triggers for those rows.
  root.innerHTML=markup;await pause();rows=[...root.children];
  assert.equal(panel(rows[0]).hidden,true);assert.equal(band(rows[0]).getAttribute('aria-expanded'),'false');
  band(rows[0]).click();await pause();assert.equal(price(rows[0]),'22.3');
  assert.deepEqual(errors,[]);
  console.log('ODDS OVERLAY PASS: hidden standalone control, compact time beside car1, live refresh after replacement, failure/older retention, single panel, keyboard, outside close and search redraw.');
 }finally{dom.window.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
