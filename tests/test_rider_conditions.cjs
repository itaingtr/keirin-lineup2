const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../site/rider-condition.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../site/rider-condition.css'),'utf8');
const pause=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));

async function run({html,date}){
 const instances=[];
 const redAppearance=html.includes('data-rider-appearance="red"');
 const ratingColor=value=>redAppearance?'rgb(211, 47, 47)':value<0?'rgb(181, 137, 0)':'rgb(8, 125, 54)';
 const original=JSON.parse(/const races=(.*);\nconst body=/.exec(html)[1]);
 const race=original.find(r=>r.players.some(p=>p.meetingResults.length>=2));
 assert.ok(race,'A real saved card with prior days is required');
 const player=race.players.find(p=>p.meetingResults.length>=2);
 const key=(day,id,playerId)=>'condition:v1:'+day+':'+id+':'+playerId;
 const raceId=String(race.race).padStart(2,'0')+race.venueCode+date.replaceAll('-','');
 const currentKey=key(date,raceId,player.playerId);
 const history=player.meetingResults.slice(-2);
 const store={posts:[
  {id:'old-1',race_key:currentKey,body:'1',created_at:date+'T00:00:00Z'},
  {id:'old-3',race_key:currentKey,body:'3',created_at:date+'T01:00:00Z'},
  ...history.map((r,i)=>({id:'history-'+i,race_key:key(r.race_date,r.race_id,player.playerId),body:String(i?4:-1),created_at:r.race_date+'T01:00:00Z'})),
  {id:'wrong-rider',race_key:key(date,raceId,'999999999999'),body:'5',created_at:date+'T02:00:00Z'},
  {id:'invalid',race_key:currentKey,body:'9',created_at:date+'T03:00:00Z'},
  {id:'comment',race_key:race.commentKey,body:'普通のコメント',created_at:date+'T01:00:00Z'}
 ],inserts:[],failed:false,logins:0,holdNextRead:false,releaseRead:null,sequence:0};
 const client={from(table){assert.equal(table,'race_comments');return {
  select(columns){assert.equal(columns,'id, race_key, body, created_at');let lower='',upper='';return {
   like(column,prefix){assert.equal(column,'race_key');assert.equal(prefix,'condition:v1:%');return this;},
   gte(column,value){assert.equal(column,'race_key');lower=value;return this;},lt(column,value){assert.equal(column,'race_key');upper=value;return this;},
   order(){return this;},async range(start,end){
    const rows=store.posts.filter(p=>p.race_key.startsWith('condition:v1:')&&p.race_key>=lower&&p.race_key<upper).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(start,end+1);
    if(store.holdNextRead){store.holdNextRead=false;await new Promise(resolve=>{store.releaseRead=resolve;});}
    return {data:rows,error:null};
   }
  };},
  insert(input){
   assert.equal(input.user_id,'board-writer');assert.match(input.body,/^(?:-2|-1|[0-5])$/);assert.ok(input.race_key.startsWith('condition:v1:'));
   return {select(){
    return {async single(){
     if(store.failed){store.failed=false;return {data:null,error:{message:'offline'}};}
     const row={...input,id:'saved-'+(++store.sequence),created_at:date+'T12:00:'+String(store.sequence).padStart(2,'0')+'Z'};
     store.inserts.push(input);store.posts.push(row);return {data:row,error:null};
    }};
   }};
  }
 };}};
 async function open(markup,canWrite=true){
  const styled=markup.replace(/<link\b[^>]*href="[^"]*\/rider-condition\.css[^"]*"[^>]*>/,()=>'<style>'+css+'</style>');
  const dom=new JSDOM(styled,{url:'https://itaingtr.github.io/keirin-lineup2/',runScripts:'dangerously',beforeParse(w){w.matchMedia=()=>({matches:false});}});
  instances.push(dom);
  const w=dom.window;
  w.keirinBoard={client,ready:true,canWrite,user:canWrite?{id:'board-writer'}:null,requestLogin(){store.logins++;}};
  w.eval(source);await pause();return dom;
 }
 try{
 const dom=await open(html,false),w=dom.window,d=w.document;
 const car=()=>d.querySelector('.condition-car[data-race-id="'+raceId+'"][data-player-id="'+player.playerId+'"]');
 const today=()=>car().closest('.rider').querySelector('.condition-today');
 assert.equal(today().textContent,'3');
 for(const [i,result] of history.entries()){
  const value=car().closest('.rider').querySelector('.condition-history[data-race-id="'+result.race_id+'"]');
  assert.equal(value.textContent,String(i?4:-1));
  assert.equal(w.getComputedStyle(value).color,ratingColor(i?4:-1));
  if(redAppearance){assert.equal(w.getComputedStyle(value).fontSize,'8px');assert.equal(w.getComputedStyle(value).fontWeight,'400');}
  assert.ok(value.closest('.meeting-order-line').querySelector('.meeting-rank'));
 }
 car().click();await pause();assert.equal(store.inserts.length,0);assert.equal(store.logins,1);assert.equal(today().textContent,'3');
 Object.assign(w.keirinBoard,{canWrite:true,user:{id:'board-writer'}});w.dispatchEvent(new w.CustomEvent('keirin-board-state'));await pause();
 car().click();assert.equal(today().textContent,'4');car().click();assert.equal(today().textContent,'5');assert.equal(store.inserts.length,0);
 await pause(720);assert.equal(store.inserts.length,1);assert.equal(store.inserts[0].race_key,currentKey);assert.equal(store.inserts[0].body,'5');assert.equal(today().textContent,'5');assert.equal(today().classList.contains('is-saving'),false);
 // An older public read finishing after a save must not erase the acknowledged value.
 store.holdNextRead=true;w.dispatchEvent(new w.CustomEvent('keirin-board-state'));await pause();assert.equal(typeof store.releaseRead,'function');
 car().click();assert.equal(today().textContent,'-2');assert.equal(w.getComputedStyle(today()).color,ratingColor(-2));await pause(720);assert.equal(store.inserts.at(-1).body,'-2');
 store.releaseRead();await pause();assert.equal(today().textContent,'-2');
 store.failed=true;car().click();assert.equal(today().textContent,'-1');await pause(720);assert.equal(today().textContent,'-2');assert.match(d.querySelector('.condition-message').textContent,/保存できなかった/);
 car().click();assert.equal(today().textContent,'-1');car().click();assert.equal(today().textContent,'');assert.equal(today().classList.contains('is-negative'),false);
 await pause(720);assert.equal(store.inserts.at(-1).body,'0');assert.equal(today().textContent,'');assert.match(d.querySelector('.condition-message').textContent,/非表示/);
 const search=d.getElementById('search');search.value=race.venue;search.dispatchEvent(new w.Event('input'));await pause();assert.equal(today().textContent,'');
 dom.window.close();
 const reopened=await open(html),reopenedCar=reopened.window.document.querySelector('.condition-car[data-race-id="'+raceId+'"][data-player-id="'+player.playerId+'"]');
 const reopenedValue=()=>reopenedCar.closest('.rider').querySelector('.condition-today');
 assert.equal(reopenedValue().textContent,'');
 // The next-day fixture changes the car number while preserving the official rider ID.
 const tomorrow=new Date(date+'T00:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const nextDate=tomorrow.toISOString().slice(0,10);
 const nextRace=JSON.parse(JSON.stringify(race)),nextPlayer=JSON.parse(JSON.stringify(player));
 nextPlayer.no=player.no===1?2:1;
 nextPlayer.meetingResults.push({player_id:player.playerId,race_id:raceId,meeting_day:race.meetingDay,race_number:race.race,race_date:date,result_url:'https://example.invalid/unit-result',order:2,display_type:0,back:false,final_half_record:'11.2',has_accident:false,accident:'',accident_name:''});
 nextRace.players=[nextPlayer];nextRace.groups=[[{type:'riders',riders:[nextPlayer.no]}]];nextRace.meetingDay++;
 const nextHtml=html.replace(/const races=(.*);\nconst body=/,()=> 'const races='+JSON.stringify([nextRace])+';\nconst body=').replace("const conditionDate='"+date+"';","const conditionDate='"+nextDate+"';");
 const next=await open(nextHtml),nd=next.window.document;
 const nextCar=nd.querySelector('.condition-car');assert.equal(nextCar.textContent,String(nextPlayer.no));
 assert.equal(nextCar.closest('.rider').querySelector('.condition-history[data-race-id="'+raceId+'"]').textContent,'');
 for(const [i,result] of history.entries()){
  const value=nextCar.closest('.rider').querySelector('.condition-history[data-race-id="'+result.race_id+'"]');
  assert.equal(value.textContent,String(i?4:-1));assert.equal(next.window.getComputedStyle(value).color,ratingColor(i?4:-1));
 }
 assert.equal(nextCar.closest('.rider').querySelector('.condition-today').textContent,'');
 next.window.close();
 // Zero is a saved blank, so another cycle starts at 1 and follows all eight levels.
 for(const value of [1,2,3,4,5,-2,-1,0,1]){
  reopenedCar.click();assert.equal(reopenedValue().textContent,value?String(value):'');
  if(value)assert.equal(reopened.window.getComputedStyle(reopenedValue()).color,ratingColor(value));
  if(redAppearance){assert.equal(reopened.window.getComputedStyle(reopenedValue()).fontSize,'8px');assert.equal(reopened.window.getComputedStyle(reopenedValue()).fontWeight,'400');}
 }
 await pause(720);assert.equal(store.inserts.at(-1).body,'1');
 if(redAppearance){assert.match(reopened.window.document.querySelector('.condition-note').textContent,/調子の数字は赤/);}
 reopened.window.close();
 assert.equal(store.inserts.length,4);assert.equal(store.posts.find(p=>p.id==='comment').body,'普通のコメント');
 assert.equal(store.posts.find(p=>p.id==='old-3').body,'3');
 console.log('RIDER CONDITIONS PASS: signed cycle, expected colors and typography, zero hiding today and history, batched taps and safe saves.');
 }finally{for(const instance of instances)if(instance.window.document)instance.window.close();}
}
module.exports=run;
if(require.main===module){const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');const date=/const conditionDate='([^']+)'/.exec(html)[1];run({html,date}).catch(error=>{console.error(error);process.exitCode=1;});}
