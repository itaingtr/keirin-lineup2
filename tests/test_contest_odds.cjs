const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'site/odds-current.js'),'utf8');
const comparison=fs.readFileSync(path.join(root,'site/odds-comparison.js'),'utf8');
const source='https://keirin.kdreams.jp/aomori/racedetail/1220200101010012/';
const key=new URL(source).pathname;
const wait=()=>new Promise(resolve=>setTimeout(resolve,45));
const values=new Map([['1-7',17.25],['7-1',71.375],['1-3',13.625],['3-1',31.875],['7-3',73.5],['3-7',37.75]]);
const odds=[];for(let a=1;a<=7;a++)for(let b=1;b<=7;b++)if(a!==b)odds.push({first:a,second:b,value:values.get(a+'-'+b)??a*10+b+.125});
const snapshot={provider:'kdreams',parser_version:2,race_key:key,bet_type:'exacta',status:'snapshot',observed_at:'2020-01-01T01:00:00Z',odds};
const feed={results:[{ok:true,snapshot}]};

function rider(n){return '<div class="rider"><span class="score">100</span><span class="car">'+n+'</span><span class="name">選手'+n+'</span></div>';}
function lineup(contested){return '<div class="lineup"><div class="line-group">'+rider(1)+(contested?'<div class="contest-pair">'+rider(7)+rider(3)+'</div>':rider(7)+rider(3))+'</div><div class="line-group">'+rider(2)+rider(6)+'</div><div class="line-group">'+rider(5)+rider(4)+'</div></div>';}

async function open({enabled=true,contested=true}={}){
 const race={source,players:Array.from({length:7},(_,i)=>({no:i+1,name:'選手'+(i+1)}))};
 const row='<tr><td class="race"><a class="race-link" href="'+source+'">12R</a></td><td class="lineup-cell">'+lineup(contested)+'</td></tr>';
 const errors=[];let loads=0;
 const dom=new JSDOM('<!doctype html><body'+(enabled?' data-contest-odds="true"':'')+'><div class="eyebrow">KEIRIN · 2020.01.01</div><table><tbody id="rows" data-initial-odds data-odds-primary="number">'+row+'</tbody></table><script>const races='+JSON.stringify([race])+';</script></body>',{
  url:'https://itaingtr.github.io/keirin-lineup2/',runScripts:'dangerously',beforeParse(w){
   w.fetch=async input=>{
    const url=String(input);if(url.includes('odds-config.json'))return {ok:true,json:async()=>({endpoint:'https://example.test/exacta.json'})};
    loads++;return {ok:true,json:async()=>feed};
   };
   w.addEventListener('error',e=>errors.push(e.error||e.message));
  }
 });
 dom.window.eval(reader);dom.window.eval(comparison);await wait();
 return {dom,row:dom.window.document.querySelector('#rows > tr'),errors,loads:()=>loads};
}

function checkPair(pair,first,second){
 assert.ok(pair);assert.equal(pair.dataset.linePair,first+'-'+second);
 assert.deepEqual([...pair.children].map(x=>x.dataset.pairCombination),[first+'-'+second,second+'-'+first]);
 for(const [i,combination] of [first+'-'+second,second+'-'+first].entries()){
  const quote=odds.find(x=>x.first+'-'+x.second===combination);
  assert.equal(pair.children[i].textContent,quote.value.toFixed(1));
  assert.ok(pair.children[i].title.includes(quote.value.toFixed(1)+'倍'));
 }
}

async function contestedCurrent(){
 const {dom,row,errors}=await open();
 try{
  const small=[...row.querySelectorAll('.rider-odds .exacta-line-pair')];
  assert.deepEqual(small.map(x=>x.dataset.linePair),['1-7','1-3','2-6','5-4']);
  assert.deepEqual(small.map(x=>x.closest('.rider').querySelector('.car').textContent),['1','7','2','5']);
  checkPair(small[0],1,7);checkPair(small[1],1,3);
  assert.equal(row.querySelector('.rider-odds [data-pair-combination="7-3"],.rider-odds [data-pair-combination="3-7"]'),null);
  assert.ok(row.querySelector('.lineup').classList.contains('lineup-odds-visible'));
  assert.equal(row.querySelector('.rider-odds').dataset.observedAt,snapshot.observed_at);
  row.querySelector('.odds-toggle').click();await wait();
  const tables=row.querySelectorAll('.exacta-matrix');assert.equal(tables.length,2);
  const table=row.querySelector('.exacta-matrix[data-odds-order="lineup"]');assert.ok(table);
  const headers=new Map([...table.tHead.rows[0].cells].slice(1,-1).map(th=>[Number(th.querySelector('.exacta-number').textContent),th]));
  checkPair(headers.get(1).querySelector('.exacta-line-pair'),1,7);
  checkPair(headers.get(7).querySelector('.exacta-line-pair'),1,3);
  assert.equal(table.querySelector('[data-pair-combination="7-3"],[data-pair-combination="3-7"]'),null);
  // The complete matrix still contains both distinct prices. Only the compact
  // relationship bands change; prices and their direction are not rewritten.
  assert.equal(table.querySelector('td[data-combination="7-3"]').textContent,'73.5');
  assert.equal(table.querySelector('td[data-combination="3-7"]').textContent,'37.8');
  assert.equal(table.dataset.observedAt,snapshot.observed_at);
  row.querySelector('.odds-refresh').click();await wait();
  const refreshed=row.querySelectorAll('.rider-odds .exacta-line-pair');
  checkPair(refreshed[0],1,7);checkPair(refreshed[1],1,3);
  assert.equal(row.querySelector('.rider-odds [data-pair-combination="7-3"]'),null);
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
}

async function unchangedRules(){
 for(const config of [{enabled:false,contested:true},{enabled:true,contested:false}]){
  const {dom,row,errors}=await open(config);
  try{
   const pairs=[...row.querySelectorAll('.rider-odds .exacta-line-pair')];
   assert.deepEqual(pairs.map(x=>x.dataset.linePair),config.contested?['2-6','5-4']:['1-7','7-3','2-6','5-4']);
   if(!config.contested){checkPair(pairs[0],1,7);checkPair(pairs[1],7,3);}
   assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
 }
}

(async()=>{await contestedCurrent();await unchangedRules();
 assert.equal(snapshot.odds.find(x=>x.first===1&&x.second===3).value,13.625);
 assert.equal(snapshot.observed_at,'2020-01-01T01:00:00Z');
 console.log('CONTEST ODDS PASS: 1(73) positions show 17/71 then 13/31; normal pairs, prices, times and archived behavior preserved.');
})().catch(error=>{console.error(error);process.exitCode=1;});
