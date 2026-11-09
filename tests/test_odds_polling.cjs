const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'site/odds-current.js'),'utf8');
const comparison=fs.readFileSync(path.join(root,'site/odds-comparison.js'),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
const realNow=Date.now();
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(realNow));
const races=[1,2,3].map(n=>({source:'https://keirin.kdreams.jp/aomori/racedetail/122020010101000'+n+'/',players:[1,2,3].map(no=>({no,name:'選手'+no}))}));
function feed(offset=0,age=0){
 return {results:races.map(race=>({ok:true,snapshot:{provider:'kdreams',parser_version:2,race_key:new URL(race.source).pathname,bet_type:'exacta',status:'snapshot',
  observed_at:new Date(realNow-3600000+age).toISOString(),odds:[1,2,3].flatMap(first=>[1,2,3].filter(second=>second!==first).map(second=>({first,second,value:first*10+second+.25+offset})))}}))};
}
function rider(no){return '<div class="rider"><span class="score">100</span><span class="car">'+no+'</span><span class="name">選手'+no+'</span></div>';}
async function open(auto=true,date=today){
 let current=feed(),clock=realNow,loads=0,fail=false,visible=true;
 const intervals=[],errors=[];
 const rows=races.map(r=>'<tr><td class="race"><a class="race-link" href="'+r.source+'">1R</a></td><td class="lineup-cell"><div class="lineup"><div class="line-group">'+[1,2,3].map(rider).join('')+'</div></div></td></tr>').join('');
 const dom=new JSDOM('<!doctype html><body'+(auto?' data-auto-odds="true"':'')+'><div class="eyebrow">KEIRIN · '+date.replaceAll('-','.')+'</div><table><tbody id="rows" data-initial-odds data-odds-primary="number">'+rows+'</tbody></table><script>const races='+JSON.stringify(races)+';</script></body>',{
  url:'https://itaingtr.github.io/keirin-lineup2/',runScripts:'dangerously',beforeParse(w){
   w.Date.now=()=>clock;
   Object.defineProperty(w.document,'visibilityState',{get:()=>visible?'visible':'hidden'});
   w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
   w.fetch=async (input,options)=>{
    const url=String(input);assert.equal(options.cache,'no-store');
    if(url.includes('odds-config.json'))return {ok:true,json:async()=>({endpoint:'https://example.test/latest.json'})};
    loads++;if(fail)throw new Error('temporary network failure');
    return {ok:true,json:async()=>current};
   };
   w.addEventListener('error',event=>errors.push(event.error||event.message));
  }
 });
 dom.window.eval(reader);dom.window.eval(comparison);await pause();
 return {dom,rows:[...dom.window.document.querySelectorAll('#rows > tr')],intervals,errors,loads:()=>loads,
  next(value){current=value;},advance(ms){clock+=ms;},failure(value){fail=value;},visible(value){visible=value;},
  async tick(){await intervals[0].fn();await pause();},
  async rerender(){dom.window.document.getElementById('rows').innerHTML=rows;await pause();this.rows=[...dom.window.document.querySelectorAll('#rows > tr')];},
  async visibility(){dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));await pause();}};
}
function price(row){return row.querySelector('.rider-odds [data-pair-combination="1-2"]').textContent;}
function panelPrice(row){return row.querySelector('.exacta-matrix td[data-combination="1-2"]').textContent;}

async function currentPage(){
 const app=await open();
 try{
  assert.equal(app.intervals.length,1);assert.equal(app.intervals[0].ms,15*60*1000);
  assert.equal(app.loads(),1);assert.equal(price(app.rows[0]),'12.3');
  for(const row of app.rows.slice(0,2))row.querySelector('.odds-toggle').click();
  await pause();assert.equal(app.loads(),1,'opening multiple panels reuses one checked feed');
  assert.equal(panelPrice(app.rows[0]),'12.3');
  const next=feed(10,15*60*1000);app.next(next);app.advance(15*60*1000);await app.tick();
  assert.equal(app.loads(),2,'one timed request refreshes all races');
  for(const row of app.rows)assert.equal(price(row),'22.3');
  for(const row of app.rows.slice(0,2)){
   assert.equal(panelPrice(row),'22.3');
   assert.equal(row.querySelector('.exacta-matrix').dataset.observedAt,next.results[0].snapshot.observed_at);
   assert.equal(row.querySelectorAll('.exacta-matrix').length,2);
  }
  assert.equal(app.rows[2].querySelector('.odds-cell').hidden,true,'polling does not open closed odds');
  app.failure(true);app.advance(15*60*1000);await app.tick();
  assert.equal(price(app.rows[0]),'22.3');assert.equal(panelPrice(app.rows[0]),'22.3');
  app.failure(false);app.next(feed());app.advance(15*60*1000);await app.tick();
  assert.equal(price(app.rows[0]),'22.3','older source quotes cannot regress compact prices');
  assert.equal(panelPrice(app.rows[0]),'22.3','older source quotes cannot regress open tables');
  await app.rerender();assert.equal(price(app.rows[0]),'22.3','search rerenders retain the newest confirmed feed');
  for(const row of app.rows.slice(0,2))row.querySelector('.odds-toggle').click();await pause();
  const count=app.loads();await app.visibility();assert.equal(app.loads(),count,'visibility refresh is bounded to one minute');
  app.next(feed(20,30*60*1000));app.advance(61000);await app.visibility();
  assert.equal(app.loads(),count+1);assert.equal(price(app.rows[0]),'32.3');assert.equal(panelPrice(app.rows[1]),'32.3');
  app.visible(false);app.advance(15*60*1000);await app.tick();assert.equal(app.loads(),count+1,'hidden tabs do not poll');
  assert.deepEqual(app.errors,[]);
 }finally{app.dom.window.close();}
}
async function protectedPages(){
 const archive=await open(false);
 try{assert.equal(archive.intervals.length,0);const count=archive.loads();archive.advance(15*60*1000);await archive.visibility();assert.equal(archive.loads(),count);assert.deepEqual(archive.errors,[]);}
 finally{archive.dom.window.close();}
 const future=await open(true,'2099-01-01');
 try{assert.equal(future.loads(),0);future.advance(15*60*1000);await future.tick();assert.equal(future.loads(),0,'future page does not request today odds');assert.deepEqual(future.errors,[]);}
 finally{future.dom.window.close();}
}
(async()=>{await currentPage();await protectedPages();console.log('ODDS POLLING PASS: one feed updates compact odds and open tables every15min, visibility refresh, monotonic quotes, error retention and archive opt-in.');})()
 .catch(error=>{console.error(error);process.exitCode=1;});
