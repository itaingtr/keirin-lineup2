const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
  const config=JSON.parse(fs.readFileSync('site/race-results-config.json'));
  const endpoint=config.endpoint.replace(/race-results$/,'rider-profile');
  const headers={apikey:config.anon_key,Authorization:'Bearer '+config.anon_key,Origin:'https://itaingtr.github.io'};
  const source='https://keirin.kdreams.jp/kumamoto/racedetail/8720261022010012/';
  const query=new URLSearchParams({player_id:'014396',card_url:source,car_number:'9'});
  const response=await fetch(endpoint+'?'+query,{headers,signal:AbortSignal.timeout(45000)});
  assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.name,'脇本雄太');assert.equal(data.player_id,'014396');assert.equal(data.period,94);
  assert.ok(data.meetings.length>0&&data.meetings.length<=10);assert.equal(data.birth_date,'1989-03-21');
  assert.equal(data.counts.unit,'count');assert.equal(data.counts.source_url,source);assert.equal(data.counts.card_date,'2026-10-22');
  assert.deepEqual(Object.keys(data.counts.values),['s','b','nige','makuri','sashi','mark','total_starts']);
  assert.ok(Object.values(data.counts.values).every(value=>Number.isInteger(value)&&value>=0));
  const invalid=await fetch(endpoint+'?player_id=invalid',{headers});assert.equal(invalid.status,400);
  const invalidCard=await fetch(endpoint+'?player_id=014396&card_url=https://example.com/',{headers});assert.equal(invalidCard.status,400);
  console.log('LIVE RIDER PROFILE PASS',data.player_id,data.name,data.birth_date,data.meetings.length,'meetings',JSON.stringify(data.counts),'observed',data.observed_at);
})().catch(error=>{console.error(error);process.exitCode=1;});
