// Actual exported cards, geometry and strict prior-rider matching; no external writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const directory=path.resolve(process.argv[2]||'public');
let target='index.html';
const parseCard=name=>JSON.parse(/const races=(.*);\nconst body=/.exec(fs.readFileSync(path.join(directory,name),'utf8'))[1]);
let races=parseCard(target);
// A first-day top legitimately has no prior rides. Keep the checked real
// cross-day regression available without blocking those new cards.
if(!races.some(r=>r.players.some(p=>p.meetingResults?.length))){target='line20261116.html';races=parseCard(target);}
const previous=new Map();let mismatch;
for(const race of races)for(const player of race.players)for(const item of player.meetingResults||[]){
 if(!item.start_source_url)continue;
 const url=new URL(item.start_source_url);url.search='';
 if(!previous.has(url.href))previous.set(url.href,{item,rows:new Map()});
 const group=previous.get(url.href);
 group.rows.set(item.car_number,{no:item.car_number,name:player.name,rank:item.has_accident?item.accident:String(item.order),
  time:item.final_half_record||'',reason:'打鐘で先行して粘る',margin:'',finish:'',shb:''});
 if(!mismatch&&group.rows.size===2)mismatch={source:url.href,no:item.car_number};
}
assert.ok(previous.size>0&&mismatch,'A checked card with real prior races is required');
previous.get(mismatch.source).rows.get(mismatch.no).name='照合しない別選手';
const oddsFixture=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{results:races.map(race=>({ok:true,snapshot:{
 provider:'kdreams',parser_version:2,race_key:new URL(race.source).pathname,bet_type:'exacta',status:'snapshot',observed_at:new Date().toISOString(),
 odds:race.players.flatMap(a=>race.players.filter(b=>b.no!==a.no).map(b=>({first:a.no,second:b.no,value:a.no*10+b.no+.125})))
}}))};
const prefix='https://itaingtr.github.io/keirin-lineup2/';
(async()=>{
 let browser;
 try{
  const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
  if(process.env.CHROME_PATH)browser=await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
  else{try{browser=await chromium.launch({...launch,channel:'chrome'});}catch{browser=await chromium.launch({...launch,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});}}
  for(const width of [320,390,393,414,428]){
   const context=await browser.newContext({viewport:{width,height:width===393?852:width===414?736:926},isMobile:true,hasTouch:true});
   const errors=[],writes=[],counts=new Map();let active=0,maximum=0,oddsLoads=0,servedOdds=oddsFixture,oddsFailure=false,oddsDelay=0;
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){writes.push(request.method());await route.abort();return;}
    // Authentication has its own live browser check. Keep this geometry/data
    // fixture independent of the remote SDK and signed-in user state.
    if(url.pathname.endsWith('/comments-passphrase.js')){await route.fulfill({contentType:'text/javascript',body:'window.keirinBoard={ready:false};'});return;}
    if(url.hostname==='raw.githubusercontent.com'&&url.pathname.includes('/fallback/kdreams/exacta/')){
     oddsLoads++;if(oddsDelay)await new Promise(resolve=>setTimeout(resolve,oddsDelay));
     await route.fulfill({status:oddsFailure?503:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(servedOdds)});return;
    }
    if(url.pathname==='/functions/v1/race-results'){
     const source=url.searchParams.get('source');counts.set(source,(counts.get(source)||0)+1);active++;maximum=Math.max(maximum,active);
     const group=previous.get(source),current=races.find(r=>r.source===source);
     assert.ok(group||current,'Only checked card or literal historical result URLs may be read');
     await new Promise(resolve=>setTimeout(resolve,5));
     const match=current&&/\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(new URL(source).pathname);
     const date=match&&new Date(match[2].slice(0,4)+'-'+match[2].slice(4,6)+'-'+match[2].slice(6)+'T00:00:00Z');
     if(date)date.setUTCDate(date.getUTCDate()+Number(match[3])-1);
     const day=date?.toISOString().slice(0,10);
     const payload={schema_version:1,source_url:source,race_id:group?group.item.race_id:String(current.race).padStart(2,'0')+match[1]+day.replaceAll('-',''),
      race_date:group?group.item.race_date:day,race_number:group?group.item.race_number:current.race,
      observed_at:new Date().toISOString(),state:'results',rows:group?[...group.rows.values()]:current.players.map((p,i)=>({no:p.no,name:p.name,rank:String(i+1),time:'11.5',reason:'直線伸びて',margin:'',finish:'',shb:''})),payouts:{exacta:[],trifecta:[]}};
     await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(payload)});active--;return;
    }
    if(request.url().startsWith(prefix)){
     const file=path.resolve(directory,decodeURIComponent(url.pathname.slice('/keirin-lineup2/'.length))||'index.html');
     if(!file.startsWith(directory+path.sep)){await route.fulfill({status:403,body:''});return;}
     try{await route.fulfill({status:200,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html; charset=utf-8',body:fs.readFileSync(file)});}catch{await route.fulfill({status:404,body:''});}
     return;
    }
    await route.abort();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(prefix+target);
   await page.waitForFunction(()=>document.body.dataset.previousMeetingsStatus==='ready'&&document.body.dataset.tenMeetingsStatus==='ready');
   await page.waitForFunction(()=>document.body.dataset.mobileLineupFit==='ready');
   const fit=await page.evaluate(()=>{
    const lineup=document.querySelector('.lineup'),style=getComputedStyle(lineup),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
    return {right:document.querySelector('.live-link').getBoundingClientRect().right,zoom:parseFloat(getComputedStyle(document.body).zoom),
     digit:context.measureText('0').width,baseGap:lineup.classList.contains('lineup-nine')?12:19,between:parseFloat(style.columnGap),within:parseFloat(getComputedStyle(lineup.querySelector('.line-group')).columnGap),
     rider:parseFloat(getComputedStyle(lineup.querySelector('.rider')).width),viewport:document.documentElement.clientWidth};
   });
   const compact=await page.evaluate(()=>document.body.dataset.mobileLayout==='compact-20261122');
   assert.ok(fit.right<=width+.2&&(compact||fit.right>=width-2.5),JSON.stringify(fit));
   async function checkControls(){
    if(!compact)return;
    const result=await page.evaluate(()=>{
     for(const row of document.querySelectorAll('#rows > tr')){
      if(row.querySelector('.race-comment-cell'))continue;
      const cell=document.createElement('td');cell.className='race-comment-cell';
      cell.innerHTML='<div class="race-comment-feed"><article class="race-comment-post"><span class="race-comment-body">検証用コメントにゃ</span></article></div><form class="race-comment-form"><textarea class="race-comment-input" aria-label="検証用コメント" placeholder="このレースの予想や気づき"></textarea><button class="race-comment-save" type="button">投稿</button><span class="race-comment-status"></span></form>';
      row.append(cell);
     }
     const row=document.querySelector('#rows > tr'),box=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
     return {input:box(row.querySelector('.race-comment-input')),save:box(row.querySelector('.race-comment-save')),feed:box(row.querySelector('.race-comment-feed')),
      form:box(row.querySelector('.race-comment-form')),search:box(document.querySelector('#search')),
      gap:box(row.querySelector('.video-actions')).left-box(row.querySelector('.race-time')).right,
      media:[...document.querySelectorAll('#rows > tr .live-link')].map(n=>box(n).right),zoom:parseFloat(getComputedStyle(document.body).zoom),
      font:getComputedStyle(row.querySelector('.race-comment-input')).fontSize};
    });
    assert.ok(result.input.width>150&&result.input.right<width-10,JSON.stringify(result));
    assert.ok(result.save.right<width&&result.feed.right<width&&result.search.right<width+.5,JSON.stringify(result));
    assert.ok(result.feed.top>=result.form.bottom&&Math.abs(result.feed.left-result.form.left)<.2,JSON.stringify(result));
    assert.ok(result.gap>=0&&result.gap<=10*result.zoom,JSON.stringify(result));
    assert.ok(result.media.every(right=>right<=width+.3),JSON.stringify(result));assert.equal(result.font,'17px');
    return result;
   }
   const mobileControls=await checkControls();
   assert.ok(Math.abs(fit.rider-32)<.1,JSON.stringify(fit));assert.equal(fit.within,0,JSON.stringify(fit));
   assert.ok(Math.abs(fit.between-(fit.baseGap-fit.digit))<.1,JSON.stringify(fit));
   await page.waitForSelector('.rider-odds .exacta-line-pair');
   const oddsAndDots=await page.evaluate(()=>[...document.querySelectorAll('#rows > tr')].map(row=>{
    const groups=[...row.querySelectorAll('.lineup > .line-group')],link=row.querySelector('.race-link');
    return {source:link.dataset.raceSource||link.href,bands:row.querySelectorAll('.rider-odds').length,cars:row.querySelectorAll('.lineup .car').length,
     dots:groups.map((group,index)=>{
      const dot=group.querySelector(':scope > .line-separator');if(!dot)return null;
      const d=dot.getBoundingClientRect(),g=group.getBoundingClientRect(),next=groups[index+1]?.getBoundingClientRect(),car=group.querySelector('.car').getBoundingClientRect();
      return {text:dot.textContent,x:d.left+d.width/2,y:d.top+d.height/2,expectedX:next?(g.right+next.left)/2:null,expectedY:car.top+car.height/2};
     }),
     pairs:[...row.querySelectorAll('.rider-odds .exacta-line-pair')].map(node=>{
      const p=node.getBoundingClientRect(),owner=node.closest('.rider').getBoundingClientRect();
      return {centre:p.left+p.width/2,edge:owner.right,values:[...node.children].map(value=>({key:value.dataset.pairCombination,text:value.textContent}))};
     })};
   }));
   for(const row of oddsAndDots){
    const snapshot=oddsFixture.results.find(value=>value.ok&&value.snapshot?.race_key===new URL(row.source).pathname)?.snapshot;
    assert.ok(snapshot&&snapshot.odds?.some(value=>value.value!==null),'The fixture must contain checked quotes for every displayed race');
    assert.equal(row.bands,row.cars);assert.equal(row.dots.filter(Boolean).length,row.dots.length-1);assert.equal(row.dots.at(-1),null);
    for(const dot of row.dots.filter(Boolean)){assert.equal(dot.text,'•');assert.ok(Math.abs(dot.x-dot.expectedX)<.4,JSON.stringify(dot));assert.ok(Math.abs(dot.y-dot.expectedY)<.4,JSON.stringify(dot));}
    for(const pair of row.pairs){
     assert.ok(Math.abs(pair.centre-pair.edge)<.4,'Compact paired odds must stay on their widened rider boundary');
     for(const value of pair.values){const price=snapshot.odds.find(price=>price.first+'-'+price.second===value.key)?.value;assert.equal(value.text,price==null?'':price>=100?String(Math.floor(price)):price.toFixed(1));}
    }
   }
   assert.equal(oddsLoads,1,'All compact odds share one initial feed even without the old eyebrow heading');
   // A normal in-flow section grows above the race. Its added height is
   // compensated only on an odds action, keeping the visible rider positions.
   const firstRow=page.locator('#rows > tr').first(),band=firstRow.locator('.rider-odds').first();
   async function cardPosition(){return page.evaluate(()=>({
    cards:[...document.querySelectorAll('#rows > tr')].map(row=>{const r=row.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
    headers:[...document.querySelectorAll('#rows > tr > .venue')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y];}),
    cars:[...document.querySelectorAll('#rows > tr .lineup .car')].map(car=>{const r=car.getBoundingClientRect();return [r.x,r.y];}),
    scroll:[scrollX,scrollY,visualViewport.pageLeft,visualViewport.pageTop],
    document:[document.scrollingElement.scrollWidth,document.scrollingElement.scrollHeight]
   }));}
   const beforeOdds=await cardPosition();
   assert.equal(await firstRow.locator('.odds-toggle').isVisible(),false);
   await band.tap();
   await page.waitForSelector('.odds-cell:not([hidden]) .exacta-time');
   await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   const panel=firstRow.locator('.odds-cell'),refresh=panel.locator('.odds-refresh');
   const openedOdds=await cardPosition();
   await checkControls();
   function sameCoordinates(actual,expected,label){
    assert.equal(actual.length,expected.length);
    actual.forEach((point,index)=>point.forEach((value,axis)=>assert.ok(Math.abs(value-expected[index][axis])<1.1,label+': '+JSON.stringify({actual:point,expected:expected[index]}))));
   }
   sameCoordinates(openedOdds.cars,beforeOdds.cars,'Opening upward preserves visible car positions');
   sameCoordinates(openedOdds.headers,beforeOdds.headers,'Race headings remain at their visible positions');
   assert.equal(openedOdds.document[0],beforeOdds.document[0]);
   assert.ok(openedOdds.document[1]-beforeOdds.document[1]>100,'The table must reserve its full height in the document');
   assert.ok(openedOdds.scroll[1]>beforeOdds.scroll[1],'Compensate the inserted height by scrolling the document');
   const expansion=await firstRow.evaluate(row=>{
    const panel=row.querySelector('.odds-cell'),band=row.querySelector('.rider-odds'),time=panel.querySelector('.exacta-time'),button=panel.querySelector('.odds-refresh'),table=panel.querySelector('.exacta-matrix'),corner=table.tHead.rows[0].cells[0],tools=button.parentElement;
    const nameBoxes=()=>[...table.querySelectorAll('.exacta-column-rider .exacta-rider-name')].map(name=>{
     const n=name.getBoundingClientRect(),car=name.parentElement.querySelector('.exacta-number').getBoundingClientRect();
     return {x:n.x,y:n.y,width:n.width,height:n.height,centre:n.left+n.width/2,carCentre:car.left+car.width/2,direct:name.parentElement.classList.contains('exacta-column-rider')};
    });
    const names=nameBoxes(),height=table.getBoundingClientRect().height;
    tools.remove();const naturalNames=nameBoxes(),naturalHeight=table.getBoundingClientRect().height;corner.append(tools);
    const p=panel.getBoundingClientRect(),b=band.getBoundingClientRect(),t=time.getBoundingClientRect(),u=button.getBoundingClientRect(),style=getComputedStyle(panel),heading=row.querySelector('.venue').getBoundingClientRect(),card=row.getBoundingClientRect();
    return {top:p.top,bottom:p.bottom,anchor:b.top,height:p.height,firstNameLeft:names[0].x,buttonRight:u.right,buttonBottom:u.bottom,timeTop:t.top,timeRight:t.right,time:time.textContent,
     corner:button.closest('th')===corner,observed:time.dateTime,names,naturalNames,tableHeight:height,naturalHeight,
     tableCount:panel.querySelectorAll('.exacta-matrix').length,toolsBottom:tools.getBoundingClientRect().bottom,rowAxisTop:table.tBodies[0].rows[0].getBoundingClientRect().top,
     position:style.position,shadow:style.boxShadow,overflow:style.overflowY,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,headingTop:heading.top,cardTop:card.top,
     captions:[...panel.querySelectorAll('caption,.odds-heading')].map(n=>getComputedStyle(n).display),
     status:panel.querySelector('.odds-status').getBoundingClientRect().height};
   });
   assert.equal(expansion.tableCount,1);assert.equal(expansion.corner,true);
   assert.ok(expansion.top>expansion.cardTop&&expansion.bottom<expansion.headingTop&&expansion.headingTop<expansion.anchor,JSON.stringify(expansion));
   assert.equal(expansion.position,'static');assert.equal(expansion.shadow,'none');assert.equal(expansion.overflow,'visible');
   assert.ok(expansion.scrollHeight<=expansion.clientHeight+1,'All table rows must be in normal flow, without an inner scrolling panel');
   assert.ok(expansion.buttonRight<expansion.firstNameLeft&&expansion.timeRight<expansion.firstNameLeft,'Refresh and time belong to the left corner above the second-place axis');
   assert.ok(expansion.timeTop>=expansion.buttonBottom&&expansion.toolsBottom<=expansion.rowAxisTop,JSON.stringify(expansion));
   assert.deepEqual(expansion.names,expansion.naturalNames,'Refresh/time must not change any rider name position');
   assert.equal(expansion.tableHeight,expansion.naturalHeight,'The corner tools must not increase header height');
   assert.ok(expansion.names.every(name=>name.direct&&Math.abs(name.centre-name.carCentre)<.3),'Every name remains centered beneath its car');
   delete expansion.naturalNames;delete expansion.names;
   assert.ok(expansion.captions.every(value=>value==='none'));assert.ok(expansion.status<=2);
   const expectedClock=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
   assert.equal(expansion.time,expectedClock(expansion.observed));assert.match(expansion.time,/^\d{2}:\d{2}$/);
   const axes=await firstRow.evaluate(row=>{
    const table=row.querySelector('.exacta-matrix'),first=[...table.tHead.rows[0].cells].slice(1,-1).map(cell=>Number(cell.querySelector('.exacta-number').textContent)),rows=[...table.tBodies[0].rows];
    return {first,second:rows.map(row=>Number(row.cells[0].querySelector('.exacta-number').textContent)),expected:[...row.querySelectorAll('.lineup .car')].map(car=>Number(car.textContent)),
     cells:rows.flatMap(row=>[...row.cells].slice(1,-1).map((cell,index)=>({first:first[index],second:Number(row.cells[0].querySelector('.exacta-number').textContent),key:cell.dataset.combination||null,text:cell.textContent})))};
   });
   assert.deepEqual(axes.first,axes.expected,'First place follows the displayed lineup');
   assert.deepEqual(axes.second,[...axes.expected].sort((a,b)=>a-b),'Second place follows car-number order');
   const snapshot=oddsFixture.results.find(item=>item.snapshot?.race_key===new URL(oddsAndDots[0].source).pathname).snapshot;
   for(const cell of axes.cells){
    if(cell.first===cell.second){assert.equal(cell.key,null);assert.equal(cell.text,'·');continue;}
    assert.equal(cell.key,cell.first+'-'+cell.second);
    const price=snapshot.odds.find(quote=>quote.first===cell.first&&quote.second===cell.second)?.value;
    assert.equal(cell.text,price==null?'—':price>=100?String(Math.floor(price)):price.toFixed(1),'The directed quote must stay at its correct axis intersection');
   }
   expansion.first=axes.first;expansion.second=axes.second;
   // The two requested handset sizes cover the controls through each layout
   // state. Cache latency, refresh failures and gesture regressions remain
   // exercised by the complete 320/390/428px runs below.
   if(compact&&(width===393||width===414)){
    await page.evaluate(y=>window.scrollTo({left:0,top:y,behavior:'instant'}),openedOdds.scroll[1]);
    await band.tap();await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
    assert.equal(await panel.isVisible(),false);await checkControls();
    await page.locator('.ten-toggle').first().evaluate(n=>n.click());
    await page.waitForSelector('.ten-results:not([hidden]) .ten-venue');
    await page.locator('.previous-toggle').first().evaluate(n=>n.click());
    await page.waitForTimeout(80);await checkControls();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'/tmp/lineup2-mobile-history-'+width+'.png'});
    await page.locator('.ten-toggle').first().evaluate(n=>n.click());
    await page.locator('.previous-toggle').first().evaluate(n=>n.click());
    await page.evaluate(()=>{const search=document.querySelector('#search');search.value=races[0].venue;search.dispatchEvent(new Event('input'));});
    await page.waitForTimeout(80);await checkControls();
    await page.evaluate(()=>{const search=document.querySelector('#search');search.value='';search.dispatchEvent(new Event('input'));window.scrollTo(0,0);});
    await page.waitForTimeout(80);await checkControls();
    await page.screenshot({path:'/tmp/lineup2-mobile-'+width+'.png'});
    assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
    console.log('HANDSET CONTROLS PASS',JSON.stringify({width,height:width===393?852:736,mobileControls,fit,expansion,writeRequests:0}));
    await context.close();continue;
   }
   // Read the complete expanded table using ordinary document scrolling.
   await page.evaluate(()=>window.scrollTo({left:scrollX,top:0,behavior:'instant'}));
   await page.waitForTimeout(50);
   const beforeRefresh=await cardPosition();
   const originalQuotes=await panel.locator('td[data-combination]').allTextContents();
   const originalTime=await panel.locator('.exacta-time').getAttribute('datetime');
   oddsFailure=true;await refresh.tap();
   await page.waitForSelector('.exacta-time[data-stale="true"]');
   await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   assert.deepEqual(await panel.locator('td[data-combination]').allTextContents(),originalQuotes);
   assert.equal(await panel.locator('.exacta-time').getAttribute('datetime'),originalTime);
   assert.deepEqual(await cardPosition(),beforeRefresh,'A failed refresh must retain geometry and the manually chosen reading position');
   oddsFailure=false;servedOdds=JSON.parse(JSON.stringify(oddsFixture));
   const updated=servedOdds.results.find(item=>item.snapshot.race_key===new URL(oddsAndDots[0].source).pathname).snapshot;
   updated.observed_at=new Date(Date.parse(originalTime)+1000).toISOString();
   for(const price of updated.odds)if(price.value!==null)price.value+=1;
   await refresh.tap();
   await page.waitForFunction(value=>document.querySelector('.odds-cell:not([hidden]) .exacta-time')?.dateTime===value,updated.observed_at);
   await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   assert.equal(await panel.locator('.odds-refresh').count(),1,'A refreshed matrix must retain one live refresh control');
   assert.notDeepEqual(await panel.locator('td[data-combination]').allTextContents(),originalQuotes);
   assert.deepEqual(await cardPosition(),beforeRefresh,'Replacing the matrix must not move the lineup or undo document scrolling');
   const confirmedQuotes=await panel.locator('td[data-combination]').allTextContents();
   servedOdds=oddsFixture;await panel.locator('.odds-refresh').tap();
   await page.waitForFunction(()=>!document.querySelector('.odds-cell:not([hidden])').hasAttribute('aria-busy'));
   await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   assert.deepEqual(await panel.locator('td[data-combination]').allTextContents(),confirmedQuotes,'Older quotes cannot replace the confirmed matrix');
   assert.equal(await panel.locator('.exacta-time').getAttribute('datetime'),updated.observed_at);
   if(width===390)await page.screenshot({path:'/tmp/odds-overlay-mobile.png'});
   await page.evaluate(y=>window.scrollTo({left:scrollX,top:y,behavior:'instant'}),openedOdds.scroll[1]);
   await page.waitForTimeout(50);
   await band.tap();await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);assert.equal(await panel.isVisible(),false);
   assert.deepEqual(await cardPosition(),beforeOdds,'Closing reverses the expansion and keeps the visible lineup in place');
   await band.focus();await page.keyboard.press('Enter');await page.waitForSelector('.odds-cell:not([hidden]) .exacta-time');
   await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   await page.keyboard.press(' ');await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);assert.equal(await panel.isVisible(),false);
   assert.deepEqual(await cardPosition(),beforeOdds,'Keyboard toggles also preserve the visible lineup');
   await band.tap();await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   await firstRow.locator('.lineup .score').first().tap();assert.equal(await panel.isVisible(),true,'An inline section stays open when using the rest of the card');
   await band.tap();await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   // A first read can finish after the reader has deliberately scrolled.
   // Keep that new position while the loading line becomes a full table.
   oddsDelay=350;
   await page.evaluate(()=>{window.oddsOriginalNow=Date.now;Date.now=()=>window.oddsOriginalNow()+61000;});
   const secondRow=page.locator('#rows > tr').nth(1),secondBand=secondRow.locator('.rider-odds').first();
   const delayedFeed=page.waitForResponse(r=>new URL(r.url()).hostname==='raw.githubusercontent.com'&&new URL(r.url()).pathname.includes('/fallback/kdreams/exacta/'));
   await secondBand.tap();
   await page.evaluate(()=>window.scrollBy({left:0,top:35,behavior:'instant'}));await page.waitForTimeout(50);
   const manuallyChosen=await secondRow.locator('.lineup').evaluate(n=>({top:n.getBoundingClientRect().top,x:visualViewport.pageLeft}));
   await delayedFeed;await secondRow.locator('.exacta-time').waitFor();
   await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   const afterDelayed=await secondRow.locator('.lineup').evaluate(n=>({top:n.getBoundingClientRect().top,x:visualViewport.pageLeft}));
   assert.ok(Math.abs(afterDelayed.top-manuallyChosen.top)<1&&Math.abs(afterDelayed.x-manuallyChosen.x)<1,'Late odds must honor the manual scroll made during the request: '+JSON.stringify({manuallyChosen,afterDelayed}));
   await secondBand.tap();await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   await page.evaluate(()=>{Date.now=window.oddsOriginalNow;delete window.oddsOriginalNow;window.scrollTo({left:0,top:0,behavior:'instant'});});oddsDelay=0;
   await page.waitForTimeout(50);
   await page.waitForFunction(()=>document.querySelector('.meeting-reason[data-reason-state="ready"]'));
   await page.locator('.race-result-toggle').first().evaluate(n=>n.click());
   await page.waitForSelector('.race-result-panel:not([hidden]) .race-result-table');
   await page.locator('.race-result-toggle').first().evaluate(n=>n.click());
   await page.locator('.ten-toggle').first().evaluate(n=>n.click());
   await page.waitForSelector('.ten-results:not([hidden]) .ten-venue');
   await page.locator('.previous-toggle').first().evaluate(n=>n.click());
   await page.waitForTimeout(50);
   await checkControls();
   const geometry=await page.locator('#rows > tr').first().evaluate(row=>{
    const riders=[...row.querySelectorAll('.rider')];
    return riders.map(r=>{
     const ten=r.querySelector('.ten-venue'),rank=r.querySelector('.ten-ranks .ten-rank'),previous=r.querySelector('.previous-rank');
     return {x:ten?.getBoundingClientRect().left,rankX:rank?.parentElement.firstElementChild===rank?rank.getBoundingClientRect().left:undefined,previousX:previous?.getBoundingClientRect().left,
      font:ten&&getComputedStyle(ten).fontSize,heights:[...r.querySelectorAll('.ten-meeting')].map(n=>parseFloat(getComputedStyle(n).height)),
      flags:[...r.querySelectorAll('.meeting-back,.previous-flag')].map(n=>{
       const first=n.classList.contains('history-flag-first'),rank=n.parentElement.querySelector('.meeting-rank,.previous-rank'),range=document.createRange();range.selectNode(n.firstChild);
       return {size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight,first,space:n.previousSibling?.textContent===' ',gap:first&&rank?range.getBoundingClientRect().left-rank.getBoundingClientRect().right:null};
      }),
      current:[...r.querySelectorAll('.meeting-result')].map(n=>({height:parseFloat(getComputedStyle(n).height),reason:n.querySelector('.meeting-reason')?.textContent}))};
    });
   });
   for(const item of geometry){
    assert.ok(item.heights.every(h=>Math.abs(h-15)<.1));if(item.font)assert.equal(item.font,'6.5px');
    if(item.x!==undefined&&item.previousX!==undefined)assert.ok(Math.abs(item.x-item.previousX)<.3,JSON.stringify(item));
    if(item.rankX!==undefined&&item.previousX!==undefined)assert.ok(Math.abs(item.rankX-item.previousX)<.3,JSON.stringify(item));
    for(const flag of item.flags){assert.equal(flag.size,'6px');assert.equal(flag.weight,'400');if(flag.first){assert.ok(flag.space);assert.ok(flag.gap>1,'The half-width space must also be visible inside a flex row');}}
    for(const result of item.current)assert.ok(result.height<=23.1);
   }
   const reasons=await page.locator('.meeting-reason[data-reason-state="ready"]').allTextContents();
   assert.ok(reasons.length>0&&reasons.every(value=>value==='打鐘で先行'));
   const reasonGeometry=await page.locator('.meeting-reason[data-reason-state="ready"]').first().evaluate(node=>{
    const range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect(),box=node.getBoundingClientRect();
    return {font:getComputedStyle(node).fontSize,wrap:getComputedStyle(node).whiteSpace,right:text.right-box.right,height:text.height,boxHeight:box.height};
   });
   assert.equal(reasonGeometry.font,'6px');assert.equal(reasonGeometry.wrap,'nowrap');assert.ok(reasonGeometry.right<.3,JSON.stringify(reasonGeometry));
   assert.ok(await page.locator('.meeting-reason[data-reason-state="unavailable"]').count()>0,'A mismatched historical rider stays blank');
   const supplement=await page.evaluate(()=>{
    const panel=document.querySelector('.ten-results:not([hidden])');
    const block=document.createElement('div');block.className='ten-meeting';block.title='前橋 2026-08-27';block.dataset.testSupplement='true';
    block.innerHTML='<div class="ten-heading"><span class="ten-venue">8前橋</span></div><div class="ten-ranks">'+['2026-08-28','2026-08-29','2026-08-30'].map((day,i)=>'<span class="ten-rank" data-race-date="'+day+'" title="'+day+'">'+(i+1)+'</span>').join('')+'</div>';
    panel.append(block);return true;
   });
   assert.ok(supplement);await page.waitForSelector('.ten-empty');
   assert.deepEqual(await page.locator('.ten-meeting[data-test-supplement]').evaluate(n=>[...n.querySelector('.ten-ranks').children].map(c=>c.textContent)),['','1','2','3']);
   await page.locator('[data-test-supplement]').evaluate(n=>n.remove());
   assert.ok(maximum<=3);assert.ok([...counts.values()].every(n=>n===1),'Shared prior races are fetched once per page');
   if(width===320){
    // Advancing the clock must expire the short shared cache so a result
    // button can pick up newly announced placings and payouts.
    await page.evaluate(()=>{window.savedNow=Date.now;Date.now=()=>window.savedNow()+6000;});
    await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/functions/v1/race-results'&&new URL(r.url()).searchParams.get('source')===races[0].source),page.locator('.race-result-toggle').first().evaluate(n=>n.click())]);
    assert.equal(counts.get(races[0].source),2);await page.locator('.race-result-toggle').first().evaluate(n=>n.click());
    await page.evaluate(()=>{Date.now=window.savedNow;delete window.savedNow;});
   }
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   const cdp=await context.newCDPSession(page);
   async function drag(from,to){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y:250}]});
    for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from+(to-from)*i/8,y:250}]});await page.waitForTimeout(25);}
    await page.waitForTimeout(120);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
   }
   await drag(width-35,35);
   const panned=await page.evaluate(()=>visualViewport?.pageLeft??window.scrollX);
   await page.locator('.ten-toggle').first().evaluate(node=>node.click());await page.waitForTimeout(30);
   const afterPan=await page.evaluate(()=>visualViewport?.pageLeft??window.scrollX);
   const panMetrics=await page.evaluate(()=>({inner:innerWidth,client:document.documentElement.clientWidth,scrollWidth:document.scrollingElement.scrollWidth,vv:{width:visualViewport.width,pageLeft:visualViewport.pageLeft,offsetLeft:visualViewport.offsetLeft,scale:visualViewport.scale},table:document.querySelector('.table-wrap table').getBoundingClientRect().width,bodyOverflow:getComputedStyle(document.body).overflowX,rootOverflow:getComputedStyle(document.documentElement).overflowX}));
   assert.ok(panned>0&&Math.abs(afterPan-panned)<1,'A history redraw must preserve horizontal panning: '+JSON.stringify({panned,afterPan,panMetrics}));
   await band.evaluate(node=>node.click());await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   const duringPannedOdds=await page.evaluate(()=>visualViewport.pageLeft);
   assert.ok(Math.abs(duringPannedOdds-afterPan)<1,'An upward expansion must preserve a manually panned horizontal position');
   await band.evaluate(node=>node.click());await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);
   assert.ok(Math.abs(await page.evaluate(()=>visualViewport.pageLeft)-afterPan)<1,'Closing upward must preserve horizontal panning');
   await drag(35,width-35);
   await cdp.detach();await page.evaluate(()=>window.scrollTo(0,0));
   if(width===390)await page.screenshot({path:'/tmp/history-refinements-mobile.png'});
   console.log('HISTORY REFINEMENTS PASS',JSON.stringify({width,mobileControls,reasons:reasons.length,concurrency:maximum,requests:counts.size,oddsLoads,compactPairs:oddsAndDots.reduce((n,row)=>n+row.pairs.length,0),dots:oddsAndDots.reduce((n,row)=>n+row.dots.filter(Boolean).length,0),expansion,leftAligned:true,meetingHeight:15,fit,reasonGeometry,writeRequests:0}));
   await context.close();
  }
 }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
