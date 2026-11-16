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
  for(const width of [320,390,428]){
   const context=await browser.newContext({viewport:{width,height:926},isMobile:true,hasTouch:true});
   const errors=[],writes=[],counts=new Map();let active=0,maximum=0,oddsLoads=0,servedOdds=oddsFixture,oddsFailure=false;
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){writes.push(request.method());await route.abort();return;}
    // Authentication has its own live browser check. Keep this geometry/data
    // fixture independent of the remote SDK and signed-in user state.
    if(url.pathname.endsWith('/comments-passphrase.js')){await route.fulfill({contentType:'text/javascript',body:'window.keirinBoard={ready:false};'});return;}
    if(url.hostname==='raw.githubusercontent.com'&&url.pathname.includes('/fallback/kdreams/exacta/')){
     oddsLoads++;await route.fulfill({status:oddsFailure?503:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(servedOdds)});return;
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
     digit:context.measureText('0').width,between:parseFloat(style.columnGap),within:parseFloat(getComputedStyle(lineup.querySelector('.line-group')).columnGap),
     rider:parseFloat(getComputedStyle(lineup.querySelector('.rider')).width),viewport:document.documentElement.clientWidth};
   });
   assert.ok(fit.right<=width+.2&&fit.right>=width-2.5,JSON.stringify(fit));
   assert.ok(Math.abs(fit.rider-32)<.1,JSON.stringify(fit));assert.equal(fit.within,0,JSON.stringify(fit));
   assert.ok(Math.abs(fit.between-(19-fit.digit))<.1,JSON.stringify(fit));
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
   // The full exacta tables must grow upward without moving any race/rider,
   // adding document height, forcing scroll, or exposing the removed labels.
   const firstRow=page.locator('#rows > tr').first(),band=firstRow.locator('.rider-odds').first();
   async function cardPosition(){return page.evaluate(()=>({
    cards:[...document.querySelectorAll('#rows > tr')].map(row=>{const r=row.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
    cars:[...document.querySelectorAll('#rows > tr .lineup .car')].map(car=>{const r=car.getBoundingClientRect();return [r.x,r.y];}),
    scroll:[scrollX,scrollY,visualViewport.pageLeft,visualViewport.pageTop],
    document:[document.scrollingElement.scrollWidth,document.scrollingElement.scrollHeight]
   }));}
   const beforeOdds=await cardPosition();
   assert.equal(await firstRow.locator('.odds-toggle').isVisible(),false);
   await band.tap();
   await page.waitForSelector('.odds-cell:not([hidden]) .exacta-time');
   const panel=firstRow.locator('.odds-cell'),refresh=panel.locator('.odds-refresh');
   assert.deepEqual(await cardPosition(),beforeOdds,'Opening exacta must preserve every card, car and scroll position');
   const overlay=await firstRow.evaluate(row=>{
    const panel=row.querySelector('.odds-cell'),band=row.querySelector('.rider-odds'),time=panel.querySelector('.exacta-time'),button=panel.querySelector('.odds-refresh'),name=button.closest('.exacta-name-row').querySelector('.exacta-rider-name');
    const p=panel.getBoundingClientRect(),b=band.getBoundingClientRect(),t=time.getBoundingClientRect(),u=button.getBoundingClientRect(),n=name.getBoundingClientRect();
    return {top:p.top,bottom:p.bottom,anchor:b.top,height:p.height,nameRight:n.right,buttonLeft:u.left,buttonBottom:u.bottom,timeTop:t.top,time:time.textContent,
     car:button.closest('.exacta-column-rider').querySelector('.exacta-number').textContent,observed:time.dateTime,
     tableCount:panel.querySelectorAll('.exacta-matrix').length,headerHeight:name.getBoundingClientRect().height,toolsHeight:button.parentElement.getBoundingClientRect().height,
     captions:[...panel.querySelectorAll('caption,.odds-heading')].map(n=>getComputedStyle(n).display),
     status:panel.querySelector('.odds-status').getBoundingClientRect().height};
   });
   assert.equal(overlay.tableCount,2);assert.equal(overlay.car,'1');
   assert.ok(overlay.top>=-1&&overlay.bottom<overlay.anchor&&overlay.height>100,JSON.stringify(overlay));
   assert.ok(overlay.buttonLeft>=overlay.nameRight&&overlay.buttonLeft-overlay.nameRight<3,JSON.stringify(overlay));
   assert.ok(overlay.timeTop>=overlay.buttonBottom&&overlay.toolsHeight<=overlay.headerHeight,JSON.stringify(overlay));
   assert.ok(overlay.captions.every(value=>value==='none'));assert.ok(overlay.status<=2);
   const expectedClock=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
   assert.equal(overlay.time,expectedClock(overlay.observed));assert.match(overlay.time,/^\d{2}:\d{2}$/);
   const originalQuotes=await panel.locator('td[data-combination]').allTextContents();
   const originalTime=await panel.locator('.exacta-time').getAttribute('datetime');
   oddsFailure=true;await refresh.tap();
   await page.waitForSelector('.exacta-time[data-stale="true"]');
   assert.deepEqual(await panel.locator('td[data-combination]').allTextContents(),originalQuotes);
   assert.equal(await panel.locator('.exacta-time').getAttribute('datetime'),originalTime);
   assert.deepEqual(await cardPosition(),beforeOdds,'A failed refresh must retain geometry and checked values');
   oddsFailure=false;servedOdds=JSON.parse(JSON.stringify(oddsFixture));
   const updated=servedOdds.results.find(item=>item.snapshot.race_key===new URL(oddsAndDots[0].source).pathname).snapshot;
   updated.observed_at=new Date(Date.parse(originalTime)+1000).toISOString();
   for(const price of updated.odds)if(price.value!==null)price.value+=1;
   await refresh.tap();
   await page.waitForFunction(value=>document.querySelector('.odds-cell:not([hidden]) .exacta-time')?.dateTime===value,updated.observed_at);
   assert.equal(await panel.locator('.odds-refresh').count(),1,'A refreshed matrix must retain one live refresh control');
   assert.notDeepEqual(await panel.locator('td[data-combination]').allTextContents(),originalQuotes);
   assert.deepEqual(await cardPosition(),beforeOdds,'Replacing both matrices must not move the lineup');
   const confirmedQuotes=await panel.locator('td[data-combination]').allTextContents();
   servedOdds=oddsFixture;await panel.locator('.odds-refresh').tap();
   await page.waitForFunction(()=>!document.querySelector('.odds-cell:not([hidden])').hasAttribute('aria-busy'));
   assert.deepEqual(await panel.locator('td[data-combination]').allTextContents(),confirmedQuotes,'Older quotes cannot replace the confirmed matrix');
   assert.equal(await panel.locator('.exacta-time').getAttribute('datetime'),updated.observed_at);
   if(width===390)await page.screenshot({path:'/tmp/odds-overlay-mobile.png'});
   await band.tap();assert.equal(await panel.isVisible(),false);
   await band.focus();await page.keyboard.press('Enter');await page.waitForSelector('.odds-cell:not([hidden]) .exacta-time');
   await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);
   assert.deepEqual(await cardPosition(),beforeOdds,'Closing or keyboard access must not scroll the card');
   await band.tap();await firstRow.locator('.venue').tap();assert.equal(await panel.isVisible(),false);
   await page.waitForFunction(()=>document.querySelector('.meeting-reason[data-reason-state="ready"]'));
   await page.locator('.race-result-toggle').first().evaluate(n=>n.click());
   await page.waitForSelector('.race-result-panel:not([hidden]) .race-result-table');
   await page.locator('.race-result-toggle').first().evaluate(n=>n.click());
   await page.locator('.ten-toggle').first().evaluate(n=>n.click());
   await page.waitForSelector('.ten-results:not([hidden]) .ten-venue');
   await page.locator('.previous-toggle').first().evaluate(n=>n.click());
   await page.waitForTimeout(50);
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
   await drag(35,width-35);
   await cdp.detach();await page.evaluate(()=>window.scrollTo(0,0));
   if(width===390)await page.screenshot({path:'/tmp/history-refinements-mobile.png'});
   console.log('HISTORY REFINEMENTS PASS',JSON.stringify({width,reasons:reasons.length,concurrency:maximum,requests:counts.size,oddsLoads,compactPairs:oddsAndDots.reduce((n,row)=>n+row.pairs.length,0),dots:oddsAndDots.reduce((n,row)=>n+row.dots.filter(Boolean).length,0),overlay,leftAligned:true,meetingHeight:15,fit,reasonGeometry,writeRequests:0}));
   await context.close();
  }
 }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
