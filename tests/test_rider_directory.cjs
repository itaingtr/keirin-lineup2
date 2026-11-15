const assert=require('node:assert/strict');
const M=require('../site/daily-results/search-model.js');
function rider(id,{score=100,period=100,age=30,prefecture='青森',style=null,stats=[0,0,0,0,1,0]}={}){
  return {player_id:String(id).padStart(6,'0'),name:'選手'+id,period,age,prefecture,style,last_card:{score_raw:score,stats}};
}
const people=[rider(1,{score:110,period:100,age:30}),rider(2,{score:108,period:100,age:45}),rider(3,{score:104,period:120,age:25}),rider(4,{score:111,period:120,age:50})];
let sorts=[];
sorts=M.cycleSort(sorts,'age');assert.deepEqual(M.sortPlayers(people,sorts).map(p=>p.age),[25,30,45,50]);
sorts=M.cycleSort(sorts,'age');assert.deepEqual(M.sortPlayers(people,sorts).map(p=>p.age),[50,45,30,25]);
sorts=M.cycleSort(sorts,'period');sorts=M.cycleSort(sorts,'period');
assert.deepEqual(M.sortPlayers(people,sorts).map(p=>p.player_id),['000004','000003','000002','000001'],'Last-selected period takes priority and retains age descending inside each period');
sorts=M.cycleSort(sorts,'period');assert.deepEqual(sorts,[{key:'age',direction:'desc'}]);
sorts=M.cycleSort(sorts,'age');assert.deepEqual(sorts,[]);
let repeated=M.cycleSort([], 'period');repeated=M.cycleSort(repeated,'age');repeated=M.cycleSort(repeated,'period');
assert.equal(repeated.at(-1).key,'period','Changing an already-active control makes it primary again');
assert.equal(M.REGIONS.length,8);assert.equal(new Set(M.REGIONS.flatMap(r=>r.prefectures)).size,47);
assert.equal(M.regionOf(rider(1,{prefecture:'福井県'})),'近畿');assert.equal(M.regionOf(rider(1,{prefecture:'富山'})),'中部');
assert.equal(M.regionOf(rider(1,{prefecture:'静岡県'})),'南関東');assert.equal(M.regionOf(rider(1,{prefecture:'北海道'})),'北日本');
assert.equal(M.regionOf(rider(1,{prefecture:'京都'})),'近畿');assert.equal(M.regionOf(rider(1,{prefecture:'京都府'})),'近畿');
for(const prefecture of M.PREFECTURES)assert.ok(M.regionOf(rider(1,{prefecture})),prefecture+' must belong to exactly one region');
assert.equal(M.regionOf(rider(1,{prefecture:'不明'})),null);
const north=[rider(1,{prefecture:'沖縄'}),rider(2,{prefecture:'北海道'}),rider(3,{prefecture:'宮城'}),rider(4,{prefecture:'不明'})];
assert.deepEqual(M.sortPlayers(north,[{key:'prefecture',direction:'asc'}]).map(p=>p.player_id),['000002','000003','000001','000004']);
assert.deepEqual(M.sortPlayers(north,[{key:'prefecture',direction:'desc'}]).map(p=>p.player_id),['000001','000003','000002','000004']);
for(const direction of ['asc','desc'])assert.equal(M.sortPlayers([rider(1,{age:null}),rider(2,{age:50})],[{key:'age',direction}]).at(-1).age,null);
assert.equal(M.sortPlayers([rider(1,{score:99.9}),rider(2,{score:100.01})])[0].last_card.score_raw,100.01,'Compare numeric unrounded scores');
assert.equal(M.roleOf(rider(1,{style:'追',stats:[0,5,3,0,0,0]})).kind,'chaser','Confirmed official style wins over a statistical guess');
assert.equal(M.roleOf(rider(1,{style:'両'})).kind,'self');assert.equal(M.roleOf(rider(1,{style:'逃'})).inferred,false);
assert.equal(M.roleOf(rider(1,{stats:[0,1,0,0,0,0]})).kind,'self');assert.equal(M.roleOf(rider(1)).kind,'chaser');
assert.equal(M.roleOf(rider(1,{stats:[0,0,0,0,0,0]})).kind,null);assert.equal(M.roleOf(rider(1)).inferred,true);
for(const size of [0,30,49,50,51,101]){
  const players=Array.from({length:size},(_,i)=>rider(i+1,{score:100+i/100}));
  const first=M.directory(players,{all:true,page:0}),second=M.directory(players,{all:true,page:1});
  assert.equal(first.pageCount,size>=50?2:1);
  if(size>=50){assert.equal(first.rows.length,Math.ceil(size/2));const all=[...first.rows,...second.rows].map(p=>p.player_id);assert.equal(new Set(all).size,size);}
  else assert.equal(first.rows.length,size);
}
const many=Array.from({length:100},(_,i)=>rider(i+1,{score:80+i/10,prefecture:i%2?'北海道':'沖縄'}));
const home=M.directory([...many,rider(999,{score:null})]);assert.equal(home.rows.length,30);assert.equal(home.rows[0].player_id,'000100');assert.equal(home.pageCount,1);
const region=M.directory(many,{region:'北日本'});assert.equal(region.total,50);assert.equal(region.pageCount,2);assert.ok(region.rows.every(p=>p.prefecture==='北海道'));
assert.equal(M.directory(many,{query:'選手100'}).total,1);
console.log('RIDER DIRECTORY PASS: eight regions, top30, last-click multi-sort, clear/ascending/descending loop, unknowns, role provenance, exact-50 threshold and no lost riders');
