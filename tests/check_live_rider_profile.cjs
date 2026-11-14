const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
  const config=JSON.parse(fs.readFileSync('site/race-results-config.json'));
  const endpoint=config.endpoint.replace(/race-results$/,'rider-profile');
  const headers={apikey:config.anon_key,Authorization:'Bearer '+config.anon_key,Origin:'https://itaingtr.github.io'};
  const response=await fetch(endpoint+'?player_id=014396',{headers,signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.name,'脇本雄太');assert.equal(data.player_id,'014396');assert.equal(data.period,94);
  assert.ok(data.meetings.length>0&&data.meetings.length<=10);assert.equal(data.techniques.unit,'percent');
  const invalid=await fetch(endpoint+'?player_id=invalid',{headers});assert.equal(invalid.status,400);
  console.log('LIVE RIDER PROFILE PASS',data.player_id,data.name,data.meetings.length,'meetings',JSON.stringify(data.techniques),'observed',data.observed_at);
})().catch(error=>{console.error(error);process.exitCode=1;});
