const assert=require('node:assert/strict');
const M=require('../site/daily-results/search-model.js');
(async()=>{
  const {parseProfile}=await import('../supabase/functions/rider-profile/parser.mjs');
  const {allowedProfileUrl}=await import('../supabase/functions/rider-profile/source.mjs');
  const view={tables:[[['氏名','登録番号','期別','府県','年齢'],['脇本　雄太','014396','94期','福井県','37歳']],
    [['0%','67%','33%','0%'],['逃げ','捲り','差し','マーク']]],updates:[],meetings:[
      {heading:['10/31','防G3'],days:[{label:null,back:null}]},
      {heading:['10/22','熊G3'],days:[{label:'1',back:null},{label:'落車棄権',back:true},{label:'未',back:null}]},
      {heading:['12/31','岸G1'],days:[1,2,3,4,5].map(order=>({label:String(order),back:null}))},
    ]};
  // The real DOM extractor normalizes wide spaces before parsing.
  view.tables[0][1][0]='脇本雄太';
  const profile=parseProfile(view,'014396','2026-11-14T02:00:00Z',{name:'脇本 雄太',period:94});
  assert.equal(profile.meetings.length,2);assert.equal(profile.meetings[0].start_date,'2025-12-31');
  assert.equal(profile.meetings[0].days.length,5);assert.equal(profile.meetings[1].days[1].accident,'落');
  assert.equal(profile.meetings[1].days[1].back,true);assert.equal(profile.meetings[1].days[0].start,null);
  assert.ok(profile.meetings.every(m=>m.days.every(d=>d.race_date===null&&d.race_id===null&&d.video_url===null)));
  assert.equal(profile.techniques.values.makuri,67);assert.equal(profile.techniques.unit,'percent');
  assert.equal(M.resultRows(profile,profile.meetings)[0].source_url,profile.source_url);
  assert.throws(()=>parseProfile(view,'014397','2026-11-14T02:00:00Z'));
  assert.throws(()=>parseProfile(view,'014396','2026-11-14T02:00:00Z',{name:'別人'}));
  for(const url of ['https://example.com/pc/racerprofile?snum=014396','https://keirin.jp/pc/json?encp=opaque','https://keirin.jp/pc/racerprofile?snum=014397','https://keirin.jp/pc/racerprofile?snum=014396&other=1'])assert.throws(()=>allowedProfileUrl(url,'014396'));
  const players=[{name:'脇本雄太',player_id:'014396',period:94},{name:'脇本勇希',player_id:'015362',period:115}];
  assert.equal(M.findPlayers(players,'脇本　雄太').length,1);assert.equal(M.findPlayers(players,'014396')[0].name,'脇本雄太');
  assert.equal(M.findPlayers(players,'脇本').length,2);
  assert.ok(M.samePerson(players[0],{...players[0],name:'脇本 雄太'}));
  assert.ok(!M.samePerson(players[0],players[1]));
  const preserved={...profile.meetings[1],venue:'熊本',venue_label:undefined,venue_code:'87',days:profile.meetings[1].days.map((d,i)=>({...d,race_date:'2026-10-'+(22+i)}))};
  assert.equal(M.mergeMeetings({meetings:[preserved]},profile)[0].venue,'熊本');
  assert.equal(M.mergeMeetings({meetings:[preserved]},null)[0],preserved);
  const newer={...preserved,start_date:'2026-11-12'};
  assert.equal(M.mergeMeetings({meetings:[preserved,newer]},profile)[0].start_date,'2026-11-12','A delayed official profile must not remove a newer checked meeting');
  const wrong={...profile,meetings:[{...profile.meetings[1],days:[{order:8,accident:''}]}]};
  assert.equal(M.mergeMeetings({meetings:[preserved]},wrong)[0].venue_code,null,'Never bind a different result to a cached video');
  console.log('RIDER PROFILE PASS: full-name search, identity checks, source bounds, percentages, incidents, extra rides and unknown dates/SHB');
})().catch(error=>{console.error(error);process.exitCode=1;});
