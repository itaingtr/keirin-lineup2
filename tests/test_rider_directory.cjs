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
for(const size of [0,30,49,50,51,101,199,200,201,400,553]){
  const players=Array.from({length:size},(_,i)=>rider(i+1,{score:100+i/100}));
  const first=M.directory(players,{all:true,page:0}),second=M.directory(players,{all:true,page:1});
  assert.equal(first.pageCount,size>200?2:1);
  if(size>200){assert.equal(first.rows.length,200);assert.equal(second.rows.length,size-200);const all=[...first.rows,...second.rows].map(p=>p.player_id);assert.equal(new Set(all).size,size);}
  else assert.equal(first.rows.length,size);
}
const many=Array.from({length:100},(_,i)=>rider(i+1,{score:80+i/10,prefecture:i%2?'北海道':'沖縄'}));
const home=M.directory([...many,rider(999,{score:null})]);assert.equal(home.rows.length,30);assert.equal(home.rows[0].player_id,'000100');assert.equal(home.pageCount,1);
const region=M.directory(many,{region:'北日本'});assert.equal(region.total,50);assert.equal(region.pageCount,1);assert.ok(region.rows.every(p=>p.prefecture==='北海道'));
assert.equal(M.directory(many,{query:'選手100'}).total,1);
// JST and fiscal-year boundaries are derived from immutable dates, not flags.
const birthday=(birth,today)=>M.birthdayState({birth_date:birth,age:31},today);
assert.deepEqual(birthday('1995-05-10','2026-05-09'),{age:30,done:false});
assert.deepEqual(birthday('1995-05-10','2026-05-10'),{age:31,done:true});
assert.deepEqual(birthday('1995-05-10','2027-03-31'),{age:31,done:true});
assert.deepEqual(birthday('1995-05-10','2027-04-01'),{age:31,done:false});
assert.deepEqual(birthday('1995-05-10','2027-04-02'),{age:31,done:false});
assert.deepEqual(birthday('1995-01-10','2026-01-09'),{age:30,done:false});
assert.deepEqual(birthday('1995-01-10','2026-01-10'),{age:31,done:true});
assert.equal(birthday('1995-04-01','2026-04-01').done,false);
assert.equal(birthday('1995-04-01','2026-04-02').done,true);
assert.deepEqual(birthday('2000-02-29','2027-02-28'),{age:27,done:true});
assert.deepEqual(birthday('2026-02-30','2026-03-01'),{age:31,done:false});
assert.deepEqual(birthday('1900-01-01','2026-11-01'),{age:31,done:false});
assert.deepEqual(birthday(null,'2026-11-01'),{age:31,done:false});
assert.equal(M.jstDay(new Date('2027-03-31T14:59:59Z')),'2027-03-31');
assert.equal(M.jstDay(new Date('2027-03-31T15:00:00Z')),'2027-04-01');
const counts=M.countsOf({last_card:{stats:[0,2,0,6,2,0]}},{techniques:{unit:'percent',values:{nige:0,makuri:67,sashi:33,mark:0}}});
assert.equal(counts.values.s,0);assert.equal(counts.values.makuri,6);assert.equal(counts.values.total_starts,null);
assert.equal(M.countsOf({},{techniques:{unit:'percent',values:{makuri:67}}}).values.makuri,null,'Rounded percentages never become counts');
assert.deepEqual(M.previousSlots({recent_meetings:[{start_date:'2026-11-05',venue:'四日市'},{start_date:'2026-10-09',venue:'弥彦'}]}).map(m=>m.venue),['弥彦','四日市']);
assert.equal(M.gradeName(3)+M.shortVenue({venue:'四日市'}),'G3四');
assert.equal(M.gradeName(2)+M.shortVenue({venue:'いわき平'}),'F1平');
console.log('RIDER DIRECTORY PASS: eight regions, top30, last-click multi-sort, clear/ascending/descending loop, unknowns, role provenance, 200-plus-overflow threshold and no lost riders');
