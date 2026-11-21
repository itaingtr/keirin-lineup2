// Synthetic payout-table variants exercise source parsing, never displayed race data.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const source='https://keirin.kdreams.jp/toyohashi/racedetail/4520261102020012/';
const page=body=>'<!doctype html><title>豊橋競輪 12R | 2026年11月03日</title>'+body;
const list=items=>'<dl>'+items.map(([combination,yen])=>'<dt>'+combination+'</dt><dd>'+yen+'円</dd>').join('')+'</dl>';
const standalone=(label,items)=>'<table><tr><th colspan="2">'+label+'</th><td>'+list(items)+'</td></tr></table>';
(async()=>{
  const {parseResult}=await import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/race-results/parser.mjs')));
  const parse=body=>parseResult(new JSDOM(page(body)).window.document,source,'2026-11-14T00:00:00Z');
  const grouped='<table class="refunds_table">'+
    '<tr><th rowspan="2">2車連</th><th>複</th><td>'+list([['2=4','210']])+'</td>'+
    '<th rowspan="2">3連勝</th><th>複</th><td>'+list([['1=2=4','500']])+'</td></tr>'+
    '<tr><th>単</th><td>'+list([['2-4','370'],['4-2','510']])+'</td><th>単</th><td>'+list([['2-4-1','1,240'],['4-2-1','2,080']])+'</td></tr>'+
    '<tr><th colspan="2">ワイド</th><td>'+list([['2=4','110'],['1=2','170'],['1=4','250'],['3=4','810']])+'</td></tr></table>';
  const data=parse(grouped);
  assert.equal(data.schema_version,1);assert.equal(data.state,'payouts');assert.equal(data.rows.length,0);
  assert.deepEqual(data.payouts,{
    exacta:[{combination:'2-4',yen:370},{combination:'4-2',yen:510}],
    trifecta:[{combination:'2-4-1',yen:1240},{combination:'4-2-1',yen:2080}],
    quinella:[{combination:'2=4',yen:210}],
    wide:[{combination:'2=4',yen:110},{combination:'1=2',yen:170},{combination:'1=4',yen:250},{combination:'3=4',yen:810}],
  });
  for(const label of ['2車複','2車連複','２車複']){
    const only=parse(standalone(label,[['４＝２','1,230'],['1=5','2,500']]));
    assert.equal(only.state,'payouts');assert.deepEqual(only.payouts.quinella,[{combination:'4=2',yen:1230},{combination:'1=5',yen:2500}]);
    assert.deepEqual(only.payouts.exacta,[]);assert.deepEqual(only.payouts.wide,[]);
  }
  for(const label of ['ワイド','拡大2連複','拡大２連複']){
    const only=parse(standalone(label,[['5=1','1,230']]));
    assert.equal(only.state,'payouts');assert.deepEqual(only.payouts.wide,[{combination:'5=1',yen:1230}]);
    assert.deepEqual(only.payouts.quinella,[]);
  }
  // Flat source text uses the same verified label, delimiter and exact yen.
  assert.deepEqual(parse('<table><tr><th>ワイド</th><td>１＝２ １，２３０円　１＝３ ２，４００円</td></tr></table>').payouts.wide,
    [{combination:'1=2',yen:1230},{combination:'1=3',yen:2400}]);
  assert.deepEqual(parse('<table><tr><th>2車単</th><td>1→2 1,230円</td></tr></table>').payouts.exacta,[{combination:'1-2',yen:1230}]);
  const special=parse(standalone('2車複',[['特払い','70']])+standalone('ワイド',[['全返還','100']]));
  assert.deepEqual(special.payouts.quinella,[{combination:'特払い',yen:70}]);
  assert.deepEqual(special.payouts.wide,[{combination:'全返還',yen:100}]);
  for(const label of ['2車複','ワイド']){
    assert.throws(()=>parse(standalone(label,[['2=2','100']])),/winning combination/);
    assert.throws(()=>parse(standalone(label,[['1=2','0']])),/Invalid payout/);
    assert.throws(()=>parse(standalone(label,[['1=2','1,000,000,001']])),/Invalid payout/);
  }
  assert.deepEqual(parse(standalone('2車単',[['2=4','210']])).payouts.exacta,[],'unordered prices must not become exacta');
  assert.deepEqual(parse(standalone('ワイド',[['1=2=3','500']])).payouts.wide,[],'three-car prices must not become wide');
  const ignored=parse(standalone('3連複',[['1=2=4','500']]));
  assert.equal(ignored.state,'pending');assert.ok(Object.values(ignored.payouts).every(rows=>rows.length===0));
  assert.equal(parse('').state,'pending');
  console.log('PASS four source payout types, grouped/standalone/colspan labels, multiple winners, exact yen, pending and invalid combinations');
})().catch(error=>{console.error(error);process.exit(1);});
