const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const project=path.resolve(__dirname,'..');
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
const source='https://keirin.kdreams.jp/toyohashi/racedetail/4520261102020012/';
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/kdreams-public-result.json'),'utf8'));
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const placingTable=()=>'<table class="result_table"><tr>'+fixture.headers.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr>'+fixture.rows.map(row=>'<tr>'+row.map(c=>'<td class="'+c.class+'">'+escape(c.text)+'</td>').join('')+'</tr>').join('')+'</table>';
const payouts='<table class="refunds_table"><tr><th rowspan="2">2車連</th><th>複</th><td><dl><dt>2=4</dt><dd>210円(1)</dd></dl></td><th rowspan="2">3連勝</th><th>複</th><td>2=4=1 500円</td></tr><tr><th>単</th><td><dl><dt>2-4</dt><dd>370円(1)</dd><dt>4-2</dt><dd>510円(2)</dd></dl></td><th>単</th><td><dl><dt>2-4-1</dt><dd>1,240円(3)</dd></dl></td></tr></table>';
const page=body=>'<!doctype html><html><head><title>豊橋競輪 12R S級準決勝 | 2026年11月03日【楽天Kドリームス】</title><link rel="canonical" href="'+source+'"></head><body>'+body+'</body></html>';
const races=Array.from({length:5},(_,i)=>({source:'https://keirin.kdreams.jp/tachikawa/racedetail/282026111203'+String(i+7).padStart(4,'0')+'/',venue:'立川',venueCode:'28',race:i+7,players:[{no:1,name:'湊聖二'},{no:2,name:'川越勇星'},{no:3,name:'松永将'}]}));
function payload(race,state='results'){
 return {schema_version:1,source_url:race.source,result_url:race.source+'?pageType=showResult',race_id:String(race.race).padStart(2,'0')+'2820261114',race_date:'2026-11-14',race_number:race.race,observed_at:new Date().toISOString(),state,
  rows:state==='results'?[{rank:'2',no:2,name:'川越勇星',margin:'1/2車輪',time:'11.7',finish:'ク',shb:'S',reason:'前に続いて'},{rank:'1',no:1,name:'湊聖二',margin:'',time:'11.8',finish:'差',shb:'B',reason:'直線伸びて'},{rank:'失',no:3,name:'松永将',margin:'',time:'',finish:'',shb:'',reason:'失格'}]:[],
  payouts:state==='pending'?{exacta:[],trifecta:[]}:{exacta:[{combination:'1-2',yen:3760}],trifecta:[{combination:'1-2-3',yen:63040}]}};
}
const rowHTML=race=>'<tr><td class="race"><a class="race-link" data-race-source="'+race.source+'" href="'+race.source+'">'+race.race+'R</a><span class="video-actions"><a class="video-link" href="https://wm.st.keirin.jp/wm-keirin28/20261114-28-03-'+String(race.race).padStart(2,'0')+'-01-00.mp4">映像</a></span></td><td class="lineup-cell"><div class="lineup"><div class="previous-controls"><button class="previous-toggle" aria-expanded="false">前回</button><div class="previous-results" hidden>前回の成績</div></div><button class="ten-toggle" aria-expanded="false">成績</button><div class="ten-results" hidden>10場所</div></div></td></tr>';
async function boot({all=false,reply=payload,fail=false}={}){
 const dom=new JSDOM('<!doctype html><html><head><style>'+fs.readFileSync(path.join(project,'site/race-results.css'),'utf8')+'</style></head><body data-all-results-date="20261114" data-race-results="true"'+(all?' data-race-results-all="true"':'')+' data-race-results-config="/keirin-lineup2/race-results-config.json"><nav id="venue-nav"><a>立川</a></nav><div class="table-wrap"><table><tbody id="rows">'+races.map(rowHTML).join('')+'</tbody></table></div></body></html>',{url:'https://itaingtr.github.io/keirin-lineup2/line20261114.html',runScripts:'outside-only'});
 let configReads=0,reads=0,active=0,maxActive=0;
 dom.window.fetch=async(url,options)=>{
  if(String(url).includes('race-results-config.json')){configReads++;return {ok:true,json:async()=>({endpoint:'https://ritinxywblgsccjvqoeh.supabase.co/functions/v1/race-results',anon_key:'eyJ.public.anon'})};}
  reads++;active++;maxActive=Math.max(active,maxActive);
  assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer eyJ.public.anon');
  const source=new URL(url).searchParams.get('source'),race=races.find(r=>r.source===source);assert.ok(race);
  await new Promise(resolve=>setTimeout(resolve,3));active--;
  return {ok:!fail,json:async()=>reply(race)};
 };
 dom.window.eval('var races='+JSON.stringify(races)+';'+fs.readFileSync(path.join(project,'site/race-results.js'),'utf8'));
 dom.window.eval(fs.readFileSync(path.join(project,'site/all-results-nav.js'),'utf8'));
 await pause();
 return {dom,document:dom.window.document,reads:()=>reads,configReads:()=>configReads,maxActive:()=>maxActive};
}
(async()=>{
 const {parseResult,raceIdentity}=await import(pathToFileURL(path.join(project,'supabase/functions/race-results/parser.mjs')));
 const parse=html=>parseResult(new JSDOM(page(html)).window.document,source);
 assert.equal(raceIdentity(source).race_id,'124520261103');
 for(const bad of [source.replace('https:','http:'),source.replace('keirin.kdreams.jp','example.com'),source.replace('toyohashi','gifu'),source+'?to=http://localhost',source.replace('20261102','20260230'),source.replace(/0012\/$/,'0099/')])assert.throws(()=>raceIdentity(bad),bad);
 const results=parse(placingTable()+payouts);
 assert.equal(results.rows.length,7);assert.equal(results.rows[0].name,'深谷知広');assert.equal(results.rows[0].time,'11.0');assert.equal(results.rows[1].shb,'S');assert.equal(results.rows[3].shb,'B');
 assert.deepEqual(results.payouts,{exacta:[{combination:'2-4',yen:370},{combination:'4-2',yen:510}],trifecta:[{combination:'2-4-1',yen:1240}]});
 assert.equal(parse('').state,'pending');assert.deepEqual(parse('').rows,[]);
 const only=parse(payouts);assert.equal(only.state,'payouts');assert.equal(only.rows.length,0);assert.equal(only.payouts.exacta.length,2);
 assert.throws(()=>parseResult(new JSDOM(page(placingTable()).replace('2026年11月03日','2026年11月04日')).window.document,source),/title/);
 assert.throws(()=>parse(placingTable().replace('勝敗因','別の列')),/columns/);
 assert.throws(()=>parse(placingTable().replace('>B<','>X<')),/flags/);
 console.log('PASS source identity, title/columns, flags, pending, payout-only, rowspan and multiple winning payouts');
 let stage='results';const app=await boot({reply:r=>payload(r,stage)}),doc=app.document;
 assert.equal(app.reads(),0);assert.equal(app.configReads(),0,'normal page does not read result data until a click');
 assert.equal(doc.querySelectorAll('.race-result-toggle').length,races.length);assert.equal(doc.querySelectorAll('.race-result-panel:not([hidden])').length,0);
 assert.equal(doc.querySelectorAll('.all-results-button').length,1);assert.equal(doc.querySelector('.all-results-button').textContent,'全結果');assert.equal(new URL(doc.querySelector('.all-results-button').href).pathname,'/keirin-lineup2/results20261114.html');
 let button=doc.querySelector('.race-result-toggle');button.click();await pause();
 assert.equal(app.reads(),1);assert.equal(app.configReads(),1);assert.equal(button.getAttribute('aria-expanded'),'true');
 let panel=doc.querySelector('.race-result-panel');assert.equal(panel.querySelectorAll('th').length,8);assert.equal(panel.querySelector('tbody tr td').textContent,'1');
 assert.deepEqual(Array.from(panel.querySelectorAll('th'),node=>node.textContent),['着順','車番','選手名','あがり','勝敗因','決','SHB','着差']);
 assert.equal(panel.querySelector('tr[data-car-number="2"] .race-result-margin').textContent,'1/2W');
 assert.equal(panel.querySelector('tr[data-car-number="2"] .race-result-margin').title,'1/2車輪','source margin remains available');
 assert.ok(panel.querySelector('.race-result-car').classList.contains('c1'));
 const replay=doc.querySelector('.race-result-video');assert.equal(replay.href,doc.querySelector('.video-actions .video-link').href);assert.equal(replay.target,'_self');assert.equal(replay.getAttribute('onclick'),null);
 assert.equal(panel.querySelector('.race-result-name').textContent,'湊聖二');assert.match(panel.textContent,/63,040円/);assert.match(panel.textContent,/直線伸びて/);
 const style=app.dom.window.getComputedStyle(button);assert.equal(style.width,'22px');assert.equal(style.height,'12px');assert.equal(style.fontSize,'8px');
 button.click();stage='payouts';button.click();await pause();assert.equal(app.reads(),2,'reopening reads the latest result');
 panel=doc.querySelector('.race-result-panel');assert.equal(panel.querySelector('table'),null);assert.equal(panel.querySelectorAll('.race-result-payout').length,2);
 button.click();stage='pending';button.click();await pause();assert.equal(doc.querySelector('.race-result-panel').textContent,'未定にゃ！');
 doc.getElementById('venue-nav').innerHTML='<a>立川</a>';await pause();assert.equal(doc.querySelectorAll('.all-results-button').length,1,'search redraw retains one navigation button');
 doc.getElementById('rows').innerHTML=races.slice(0,1).map(rowHTML).join('');await pause();assert.equal(doc.querySelector('.race-result-toggle').getAttribute('aria-expanded'),'true');assert.equal(app.reads(),3,'redraw preserves the checked result without duplicate reads');
 app.dom.window.close();
 for(const [source,expected] of [['３/４車身','3/4B'],['タイヤ差','ﾀｲﾔ'],['微差','微差'],['1車身1/2','1B1/2']]){
  const sample=await boot({reply:r=>{const p=payload(r);p.rows.find(row=>row.no===2).margin=source;return p;}});
  sample.document.querySelector('.race-result-toggle').click();await pause();
  const margin=sample.document.querySelector('tr[data-car-number="2"] .race-result-margin');
  assert.equal(margin.textContent,expected);assert.equal(margin.title,source);sample.dom.window.close();
 }
 const bulk=await boot({all:true,reply:r=>payload(r,'pending')});await pause();
 assert.equal(bulk.reads(),races.length);assert.equal(bulk.configReads(),1);assert.ok(bulk.maxActive()<=3);
 assert.equal(bulk.document.querySelectorAll('.race-result-panel:not([hidden])').length,races.length);assert.ok([...bulk.document.querySelectorAll('.race-result-panel')].every(x=>x.textContent==='未定にゃ！'));
 assert.ok([...bulk.document.querySelectorAll('.previous-toggle,.ten-toggle')].every(x=>x.getAttribute('aria-expanded')==='false'),'all-results does not open previous or ten-meeting histories');bulk.dom.window.close();
 for(const options of [{fail:true},{reply:r=>({...payload(r),race_id:'012820261114'})},{reply:r=>{const p=payload(r);p.rows[0].name='別の選手';return p;}}]){
  const bad=await boot(options);bad.document.querySelector('.race-result-toggle').click();await pause();
  const p=bad.document.querySelector('.race-result-panel');assert.match(p.textContent,/取得できなかったにゃ/);assert.doesNotMatch(p.textContent,/未定にゃ/);assert.equal(p.querySelector('table'),null);bad.dom.window.close();
 }
 console.log('PASS lazy loading, compact one-per-race button, inline ordered results, payout-only/pending/error, search redraw and bounded all-results loading with histories closed');
})().catch(error=>{console.error(error);process.exit(1);});
