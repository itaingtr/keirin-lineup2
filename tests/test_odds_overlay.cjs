// Real odds readers with the scoped presentation adapter; all requests mocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.resolve(process.argv[2]||'public');
const now=Date.now(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const races=[1,2].map(n=>({source:'https://keirin.kdreams.jp/aomori/racedetail/122026111601000'+n+'/',players:[1,2,3].map(no=>({no,name:'選手'+no}))}));
const rider=no=>'<span class="rider"><span class="score">100</span><span class="car">'+no+'</span><span class="name">選手'+no+'</span></span>';
const markup=races.map((race,index)=>'<tr><td class="race"><a class="race-link" href="'+race.source+'">1R</a></td><td class="lineup-cell"><div class="lineup">'+(index===0?'<div class="line-group">'+rider(3)+rider(1)+'</div><div class="line-group">'+rider(2)+'</div>':'<div class="line-group">'+rider(1)+'<span class="contest-pair">'+rider(3)+rider(2)+'</span></div>')+'</div></td></tr>').join('');
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
  function axes(row,expected,offset=0){
   const table=panel(row).querySelector('.exacta-matrix');
   assert.equal(panel(row).querySelectorAll('.exacta-matrix').length,1);
   assert.equal(table.dataset.oddsOrder,'hybrid');
   const first=[...table.tHead.rows[0].cells].slice(1,-1).map(cell=>Number(cell.querySelector('.exacta-number').textContent));
   assert.deepEqual(first,expected);
   assert.deepEqual([...table.tBodies[0].rows].map(row=>Number(row.cells[0].querySelector('.exacta-number').textContent)),[1,2,3]);
   for(const line of table.tBodies[0].rows){
    const second=Number(line.cells[0].querySelector('.exacta-number').textContent);
    assert.equal(Number(line.cells[line.cells.length-1].querySelector('.exacta-number').textContent),second);
    first.forEach((number,index)=>{
     const cell=line.cells[index+1];
     if(number===second){assert.equal(cell.dataset.combination,undefined);assert.equal(cell.textContent,'·');}
     else{assert.equal(cell.dataset.combination,number+'-'+second);assert.equal(cell.textContent,(number*10+second+.25+offset).toFixed(1));}
    });
   }
   for(const name of table.querySelectorAll('.exacta-column-rider .exacta-rider-name'))assert.ok(name.parentElement.classList.contains('exacta-column-rider'),'Name columns must keep their natural layout');
  }
  assert.equal(loads,1);
  assert.equal(rows[0].querySelector('.odds-toggle').hidden,true);
  assert.equal(band(rows[0]).getAttribute('role'),'button');
  band(rows[0]).click();await pause();
  assert.equal(loads,1,'Opening reuses the confirmed initial feed');
  assert.equal(panel(rows[0]).hidden,false);assert.equal(rows[0].classList.contains('odds-open'),true);
  axes(rows[0],[3,1,2]);
  const control=refresh(rows[0]);
  assert.equal(control.closest('th'),panel(rows[0]).querySelector('.exacta-matrix').tHead.rows[0].cells[0]);
  assert.equal(panel(rows[0]).querySelector('.exacta-name-row'),null);
  assert.equal(control.nextElementSibling,time(rows[0]));
  assert.match(time(rows[0]).textContent,/^\d{2}:\d{2}$/);
  const observed=time(rows[0]).dateTime;
  fail=true;control.click();await pause();
  assert.equal(price(rows[0]),'12.3');assert.equal(time(rows[0]).dateTime,observed);assert.equal(time(rows[0]).dataset.stale,'true');
  fail=false;current=feed(10,900000);control.click();await pause();
  assert.equal(price(rows[0]),'22.3');assert.equal(time(rows[0]).dateTime,current.results[0].snapshot.observed_at);
  assert.equal(refresh(rows[0]),control,'The same native refresh listener survives a replaced matrix');
  axes(rows[0],[3,1,2],10);
  assert.equal(time(rows[0]).dataset.stale,'false');
  const confirmed=time(rows[0]).dateTime;
  current=feed();control.click();await pause();assert.equal(price(rows[0]),'22.3');assert.equal(time(rows[0]).dateTime,confirmed);
  band(rows[1]).click();await pause();
  axes(rows[1],[1,3,2],10);
  assert.deepEqual([...rows[1].querySelectorAll('.rider-odds [data-pair-combination]')].map(node=>node.dataset.pairCombination),['1-3','3-1','1-2','2-1'],'Contested mini odds still quote both alternatives, without inventing a contender pair');
  assert.equal(panel(rows[0]).hidden,false);assert.equal(panel(rows[1]).hidden,false,'Inline sections stay independently open like the histories');
  d.body.click();await pause();assert.equal(panel(rows[0]).hidden,false);assert.equal(panel(rows[1]).hidden,false);
  band(rows[1]).click();await pause();assert.equal(panel(rows[1]).hidden,true);assert.equal(panel(rows[0]).hidden,false);
  band(rows[0]).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause();assert.equal(panel(rows[0]).hidden,true);
  band(rows[0]).dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',bubbles:true}));await pause();assert.equal(panel(rows[0]).hidden,false);
  // A normal card search replaces the row elements. It must retain the
  // checked feed while installing fresh, closed triggers for those rows.
  root.innerHTML=markup;await pause();rows=[...root.children];
  assert.equal(panel(rows[0]).hidden,true);assert.equal(band(rows[0]).getAttribute('aria-expanded'),'false');
  band(rows[0]).click();await pause();assert.equal(price(rows[0]),'22.3');
  assert.deepEqual(errors,[]);
  console.log('ODDS INLINE PASS: first-place lineup columns, ascending second-place rows, unchanged directed prices, contested alternatives, left corner refresh/time, natural name columns, retention, independent sections, keyboard and redraw.');
 }finally{dom.window.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
