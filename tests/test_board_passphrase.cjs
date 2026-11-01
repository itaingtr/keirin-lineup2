const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');const {createHash,webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../site/comments-passphrase.js'),'utf8');
const email=JSON.parse(/const BOARD_EMAIL = (.*);/.exec(source)[1]);
const domain=JSON.parse(/const PASSPHRASE_DOMAIN = (.*);/.exec(source)[1]);
const phrase='test-board-phrase';
const expectedPassword='Neko-'+createHash('sha256').update(domain+'\0'+phrase).digest('hex')+'9!';
const key='/gifu/racedetail/4320261031030006/';
const row='<tr><td class="race"><a class="race-link" href="https://my.keirin.kdreams.jp'+key+'" data-comment-key="'+key+'">6R</a></td></tr>';
const pause=()=>new Promise(resolve=>setTimeout(resolve,15));

async function board(restored=false){
 const state={user:restored?{id:'board-writer'}:null,allowed:restored,inserts:[],signIns:[],options:null,posts:[{body:'保存済みコメント',race_key:key,created_at:'2026-10-30T03:00:00Z'}]};
 const client={auth:{
  async getUser(){return {data:{user:state.user}};},
  async signInWithPassword(input){state.signIns.push(input);if(input.email!==email||input.password!==expectedPassword)return {error:{status:400}};state.user={id:'board-writer'};state.allowed=true;return {error:null};},
  async signOut(){state.user=null;state.allowed=false;},onAuthStateChange(){}
 },async rpc(name){assert.equal(name,'is_race_comment_writer');return {data:state.allowed,error:null};},
 from(table){assert.equal(table,'race_comments');return {
  select(){return {not(column,operation,prefix){assert.equal(column,'race_key');assert.equal(operation,'like');assert.equal(prefix,'condition:v1:%');return this;},async order(){return {data:state.posts,error:null};}};},
  async insert(input){state.inserts.push(input);state.posts.push({...input,created_at:'2026-10-31T00:00:00Z'});return {error:null};}
 };}};
 const dom=new JSDOM('<main><table><tbody id="rows">'+row+'</tbody></table><div id="comments-auth-slot"></div></main>',{url:'https://itaingtr.github.io/keirin-lineup2/',runScripts:'dangerously'});
 const w=dom.window;w.TextEncoder=TextEncoder;Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
 w.__mockCreateClient=(url,key,options)=>{assert.equal(url,'https://ritinxywblgsccjvqoeh.supabase.co');assert.ok(key.startsWith('sb_publishable_'));state.options=options;return client;};
 const runnable=source.replace(/const \{ createClient \} = await import\('[^']+'\);/, 'const createClient = window.__mockCreateClient;');
 assert.notEqual(runnable,source);await w.eval(runnable);return {dom,w,state};
}

async function run(){
 assert.match(source,/@supabase\/supabase-js@2\.118\.0/);assert.doesNotMatch(source,/signInWithOtp|投稿権限の登録があと/);
 const {w,dom,state}=await board();const d=w.document,input=d.querySelector('.race-comments-code'),button=d.querySelector('.race-comments-auth-button');
 assert.equal(state.options.auth.persistSession,true);assert.equal(state.options.auth.autoRefreshToken,true);
 assert.equal(state.options.auth.storageKey,'sb-ritinxywblgsccjvqoeh-auth-token');
 assert.equal(input.type,'password');assert.equal(input.hidden,false);assert.equal(d.querySelector('.race-comment-form').hidden,true);
 assert.equal(w.keirinBoard.ready,true);assert.equal(w.keirinBoard.canWrite,false);
 assert.match(d.querySelector('.race-comment-feed').textContent,/保存済みコメント/);
 input.value='wrong-phrase';button.click();await pause();assert.equal(d.querySelector('.race-comment-form').hidden,true);assert.match(d.querySelector('.race-comments-auth-status').textContent,/合言葉を確認/);assert.equal(state.inserts.length,0);
 input.value=phrase;input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause();
 assert.equal(state.signIns.at(-1).password,expectedPassword);assert.equal(d.querySelector('.race-comment-form').hidden,false);assert.equal(input.value,'');assert.equal(input.hidden,true);
 assert.equal(w.keirinBoard.canWrite,true);assert.equal(w.keirinBoard.user.id,'board-writer');
 const text='<img src=x onerror=alert(1)>投稿テスト';d.querySelector('textarea').value=text;d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();
 assert.equal(state.inserts.length,1);assert.equal(state.inserts[0].race_key,key);assert.equal(state.inserts[0].user_id,'board-writer');assert.equal(state.inserts[0].body,text);assert.equal(d.querySelector('img'),null);
 d.querySelector('#rows').innerHTML=row;await pause();assert.equal(d.querySelector('.race-comment-form').hidden,false);assert.match(d.querySelector('.race-comment-feed').textContent,/保存済みコメント/);
 d.querySelector('.race-comments-signout').click();await pause();assert.equal(d.querySelector('.race-comment-form').hidden,true);assert.equal(input.hidden,false);dom.window.close();
 const resumed=await board(true);assert.equal(resumed.state.signIns.length,0);assert.equal(resumed.w.document.querySelector('.race-comment-form').hidden,false);assert.equal(resumed.w.document.querySelector('.race-comments-code').hidden,true);resumed.dom.window.close();
 console.log('BOARD PASSPHRASE UI PASS: login, rejected code, saved session, posting and race rerender.');
}
module.exports=run;
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
