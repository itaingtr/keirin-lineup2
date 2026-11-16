// One-time directory metadata collection; reuse immutable birthdays and sources.
// No raw pages/cookies, database writes, schedule or old-card changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
  const {parseHTML}=require('linkedom');
  const {parseProfile,profileView}=await import('../supabase/functions/rider-profile/parser.mjs');
  const {readProfileHtml}=await import('../supabase/functions/rider-profile/source.mjs');
  const {readCardHtml,countRows,matchCounts}=await import('../supabase/functions/rider-profile/counts.mjs');
  const players=JSON.parse(fs.readFileSync('public/daily-results/riders.json','utf8')).players;
  const root='site/rider-facts',pointer=path.join(root,'current.json');let previous={players:{}};
  if(fs.existsSync(pointer)){
    const ref=JSON.parse(fs.readFileSync(pointer,'utf8')),bytes=fs.readFileSync('site/'+ref.path);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw new Error('Facts checksum differs');
    previous=JSON.parse(bytes);
  }
  const facts={},pending=new Map();let failures=0,completed=0;
  const card=source=>{if(!pending.has(source))pending.set(source,(async()=>countRows(parseHTML(await readCardHtml(source)).document,source,new Date().toISOString()))());return pending.get(source);};
  // Public literal card checked independently against the October22 result list.
  const checkedSources={'014396':{name:'脇本雄太',period:94,url:'https://keirin.kdreams.jp/kumamoto/racedetail/8720261022010012/'}};
  async function collect(person){
    const old=previous.players[person.player_id];
    const same=old&&old.name===person.name&&Number(old.period)===Number(person.period);
    const fact=same?{...old}:{player_id:person.player_id,name:person.name,period:person.period};
    try{
      if(!fact.birth_date){
        const record=parseProfile(profileView(parseHTML(await readProfileHtml(person.player_id)).document),person.player_id,new Date().toISOString(),person);
        for(const key of ['birth_date','age','prefecture','style','summary','current_score','observed_at','source_url'])fact[key]=record[key];
        fact.recent_meetings=record.meetings.slice(-2).map(meeting=>({venue:meeting.venue,grade_code:meeting.grade_code,start_date:meeting.start_date,
          days:meeting.days.map(day=>({order:day.order,accident:day.accident,accident_name:day.accident_name}))}));
      }
    }catch(error){failures++;console.log('FACT_PARTIAL',person.player_id,error.message);}
    try{
      const saved=person.last_card;
      if(saved?.source_url&&fact.counts?.source_url!==saved.source_url){fact.counts=matchCounts(await card(saved.source_url),person,saved.car_number);fact.counts.card_date=saved.date;}
      else if(!saved&&!fact.counts){
        const checked=checkedSources[person.player_id];
        if(checked&&checked.name===person.name&&checked.period===Number(person.period))fact.counts=matchCounts(await card(checked.url),person);
      }
      if(fact.counts&&!fact.counts.card_date)fact.counts=matchCounts(await card(fact.counts.source_url),person);
    }catch(error){failures++;console.log('FACT_PARTIAL',person.player_id,error.message);}
    facts[person.player_id]=fact;completed++;if(completed%50===0)console.log('FACT_PROGRESS',completed,players.length);
  }
  let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<players.length)await collect(players[next++]);}));
  const data={schema_version:1,kind:'rider_facts',observed_at:new Date().toISOString(),players:facts},encoded=JSON.stringify(data)+'\n',sha=crypto.createHash('sha256').update(encoded).digest('hex');
  const relative='rider-facts/'+sha+'.json';fs.mkdirSync(root,{recursive:true});
  if(!fs.existsSync('site/'+relative))fs.writeFileSync('site/'+relative,encoded,{flag:'wx'});
  else if(fs.readFileSync('site/'+relative,'utf8')!==encoded)throw new Error('Immutable facts differ');
  fs.writeFileSync(pointer,JSON.stringify({schema_version:1,path:relative,sha256:sha})+'\n');
  console.log('FACTS_CHECKED',JSON.stringify({riders:players.length,births:Object.values(facts).filter(f=>f.birth_date).length,counts:Object.values(facts).filter(f=>f.counts).length,failures}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
