// Real touch and CORS checks using the checked export at its production origin.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const directory=path.resolve(process.argv[2]||'public');
const screenshot=process.argv[3];
const prefix='https://itaingtr.github.io/keirin-lineup2/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
(async()=>{
 const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
 let browser;
 if(process.env.CHROME_PATH)browser=await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
 else {try{browser=await chromium.launch({...launch,channel:'chrome'});}catch{browser=await chromium.launch(launch);}}
 try{
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const errors=[],mutations=[],requests=[];
  await context.route('**/*',async route=>{
   const request=route.request(),url=request.url();
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){mutations.push(request.method());await route.abort();return;}
   if(url.startsWith(prefix)){
    const relative=decodeURIComponent(new URL(url).pathname.slice('/keirin-lineup2/'.length))||'index.html';
    const file=path.resolve(directory,relative);
    if(!file.startsWith(directory+path.sep)){await route.fulfill({status:403,body:''});return;}
    try{await route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch{await route.fulfill({status:404,body:''});}
   }else{
    if(new URL(url).pathname==='/functions/v1/race-results' && request.method()==='GET')requests.push(request);
    // The managed local Chrome lacks the executor's extra CA. Node's request
    // client uses that configured CA and still verifies TLS. Normal CI Chrome
    // makes the direct browser request, including its actual CORS preflight.
    if(process.env.NODE_EXTRA_CA_CERTS && new URL(url).hostname==='ritinxywblgsccjvqoeh.supabase.co' && new URL(url).pathname==='/functions/v1/race-results'){
     const response=await route.fetch({timeout:25000});await route.fulfill({response});
    }else await route.continue();
   }
  });
  const page=await context.newPage(),diagnostics=[];page.on('pageerror',error=>errors.push(error.name+': '+error.message));
  page.on('requestfailed',request=>{if(new URL(request.url()).pathname==='/functions/v1/race-results')diagnostics.push({failed:request.failure()?.errorText});});
  page.on('response',async response=>{
   if(new URL(response.url()).pathname!=='/functions/v1/race-results')return;
   let payload;try{payload=await response.json();}catch{}
   diagnostics.push({status:response.status(),error:payload?.error,state:payload?.state,rows:payload?.rows?.length,race_id:payload?.race_id,observed_at:payload?.observed_at});
  });
  async function tap(control){
   await control.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const point=await control.evaluate(node=>{
    const box=node.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2,view=visualViewport;
    const hit=document.elementFromPoint(x,y),scale=view?.scale||1;
    return {x:(x-(view?.offsetLeft||0))*scale,y:(y-(view?.offsetTop||0))*scale,correct:hit===node||node.contains(hit),hitTag:hit?.tagName,hitClass:hit?.className};
   });
   if(screenshot)await page.screenshot({path:screenshot});
   assert.ok(point.correct,'The real touch position must reach the result control: '+JSON.stringify(point));
   await page.touchscreen.tap(point.x,point.y);
  }
  async function compactNavigation(expectedDate,expectedTitle){
   if(await page.locator('body').getAttribute('data-card-header')!=='compact-20261115')return;
   await page.waitForFunction(()=>document.body.dataset.compactNavigationStatus==='ready'&&document.querySelector('#venue-nav-bottom .all-results-button'));
   const info=await page.evaluate(()=>{
    const top=document.querySelector('.compact-navigation'),foot=document.querySelector('.compact-page-footer');
    const links=nav=>[...nav.querySelectorAll('a')].map(a=>[a.textContent,a.href]);
    const rows=[...top.children].map(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right};});
    const date=document.body.dataset.allResultsDate;
    return {date,title:document.querySelector('h1').textContent,races:races.length,riders:races.reduce((n,r)=>n+r.players.length,0),
      first:[...top.querySelector('.compact-date-row').children].map(n=>n.id||n.textContent),
      quick:[...top.querySelector('.compact-quick-row').children].map(n=>n.textContent),rows,
      topQuick:links(top.querySelector('.compact-quick-row')),footQuick:links(foot.querySelector('.compact-quick-row')),
      topVenues:links(document.getElementById('venue-nav')),footVenues:links(document.getElementById('venue-nav-bottom')),
      dateWidth:parseFloat(getComputedStyle(document.getElementById('date-select')).width),headingFont:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
      noIntro:!document.querySelector('.eyebrow,.intro'),help:[...document.querySelectorAll('.condition-note')].map(n=>n.textContent).join(''),
      last:document.querySelector('main').lastElementChild===foot,fullPlayers:new URL(top.querySelector('.results-button').href).pathname};
   });
   if(expectedDate)assert.equal(info.date,expectedDate);
   assert.equal(info.title,expectedTitle||Number(info.date.slice(4,6))+'月'+Number(info.date.slice(6))+'日 全'+info.races+'レース・'+info.riders+'人');
   assert.deepEqual(info.first,['date-select','昨日','翌日','更新']);assert.deepEqual(info.quick,['トップ','日程','全選手成績']);
   assert.deepEqual(info.footQuick,info.topQuick);assert.deepEqual(info.footVenues,info.topVenues);
   assert.ok(info.rows[1].top>=info.rows[0].bottom && info.rows[2].top>=info.rows[1].bottom,'top navigation has three separate rows');
   assert.ok(info.dateWidth<=110 && info.headingFont<24 && info.noIntro && info.last);
   assert.doesNotMatch(info.help,/車番を押すと調子が|数字は皆で共有/);
   assert.equal(info.fullPlayers,'/keirin-lineup2/daily-results/index.html','keep the existing full-player destination');
   console.log('COMPACT NAVIGATION PASS',JSON.stringify(info));
  }
  await page.goto(prefix,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.race-result-toggle');
  await compactNavigation();
  if(fs.existsSync(path.join(directory,'line20261115.html'))){
   await page.goto(prefix+'line20261115.html',{waitUntil:'domcontentloaded'});
   await compactNavigation('20261115','11月15日 全31レース・238人');
   if(screenshot){
    await page.screenshot({path:screenshot.replace(/\.png$/,'-header.png')});
    await page.locator('.compact-page-footer').scrollIntoViewIfNeeded();
    await page.screenshot({path:screenshot.replace(/\.png$/,'-footer.png')});
   }
   const venueNames=await page.locator('#venue-nav a').allTextContents();
   assert.deepEqual(venueNames,['立川','富山','川崎','別府','全結果']);
   assert.ok((await page.locator('.yesterday-button').getAttribute('href')).endsWith('/line20261114.html'));
   if(fs.existsSync(path.join(directory,'line20261116.html'))){
    await tap(page.locator('.tomorrow-button'));await page.waitForURL(/\/line20261116\.html$/);await compactNavigation('20261116');
    await tap(page.locator('.yesterday-button'));await page.waitForURL(/\/line20261115\.html$/);await compactNavigation('20261115');
   }
   await tap(page.locator('.home-button').first());await page.waitForURL(prefix);await page.waitForSelector('.race-result-toggle');await compactNavigation();
  }
  const count=await page.locator('#rows > tr').count();
  const cardDate=await page.locator('body').getAttribute('data-all-results-date');
  assert.equal(await page.locator('.all-results-button').first().textContent(),'全結果');
  assert.equal(await page.locator('.race-result-toggle').count(),count);
  assert.equal(await page.locator('.race-result-panel:not([hidden])').count(),0);
  const currentSources=new Set(await page.evaluate(()=>races.map(r=>r.source)));
  const historicalSources=new Set();
  for(const name of fs.readdirSync(directory).filter(name=>/^line\d{8}\.html$/.test(name))){
   const source=fs.readFileSync(path.join(directory,name),'utf8');
   const match=/const races=(.*);\nconst body=/.exec(source);if(!match)continue;
   for(const race of JSON.parse(match[1]))for(const player of race.players)for(const result of player.meetingResults||[]){
    if(!result.start_source_url)continue;
    const url=new URL(result.start_source_url);url.search='';url.hash='';historicalSources.add(url.href);
   }
  }
  const requestedSources=requests.map(request=>new URL(request.url()).searchParams.get('source'));
  assert.ok(requestedSources.every(source=>historicalSources.has(source)), 'Before a tap, only saved exact prior-race URLs may supply displayed win/loss reasons');
  assert.equal(requestedSources.filter(source=>currentSources.has(source)).length,0,'normal page reads no displayed-card result until a tap');
  await tap(page.locator('.race-result-toggle').first());
  await page.waitForFunction(()=>['pending','payouts','results','error'].includes(document.querySelector('.race-results-cell')?.dataset.resultState),null,{timeout:30000});
  assert.notEqual(await page.locator('.race-results-cell').first().getAttribute('data-result-state'),'error','real on-demand result must be available: '+JSON.stringify(diagnostics));
  assert.equal(await page.locator('.race-result-panel:not([hidden])').count(),1);
  const geometry=await page.evaluate(()=>{
   const button=document.querySelector('.race-result-toggle'),previous=document.querySelector('.previous-toggle');
   const b=button.getBoundingClientRect(),p=previous?.getBoundingClientRect(),style=getComputedStyle(button);
   return {width:style.width,height:style.height,fontSize:style.fontSize,left:b.left,previousLeft:p?.left,previousWidth:p?.width,actualWidth:b.width};
  });
  assert.ok(Math.abs(parseFloat(geometry.width)-22)<0.1);assert.ok(Math.abs(parseFloat(geometry.height)-12)<0.1);assert.equal(geometry.fontSize,'8px');
  if(geometry.previousWidth){assert.ok(Math.abs(geometry.actualWidth-geometry.previousWidth)<1);assert.ok(Math.abs(geometry.left-geometry.previousLeft)<1,'result button aligns with the first rider');}
  await tap(page.locator('.all-results-button').first());
  await page.waitForURL(/\/results\d{8}\.html$/,{timeout:30000});
  await page.waitForFunction(()=>document.body.dataset.raceResultsAll==='true'&&[...document.querySelectorAll('.race-results-cell')].every(cell=>['pending','payouts','results','error'].includes(cell.dataset.resultState)),null,{timeout:90000});
  const current=await page.locator('#rows > tr').count();
  assert.equal(await page.locator('.race-result-panel:not([hidden])').count(),current);
  assert.equal(await page.locator('.race-result-error').count(),0,'every current-day result must load or explicitly remain pending');
  assert.equal(await page.locator('.previous-results:not([hidden]),.ten-results:not([hidden])').count(),0);
  assert.ok((await page.locator('.previous-toggle[aria-expanded="true"],.ten-toggle[aria-expanded="true"]').count())===0);
  assert.ok(page.url().includes('results'+cardDate+'.html'),'all-results must use the displayed card date');
  const pending=await page.locator('.race-results-cell[data-result-state="pending"] .race-result-panel').allTextContents();
  assert.ok(pending.every(text=>text==='未定にゃ！'));
  await compactNavigation();
  // A completed meeting proves the actual result and both payout tables render,
  // independently of whether today's first race has already finished.
  await page.goto(prefix+'line20261113.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.all-results-button');
  assert.equal(await page.locator('.all-results-button').first().textContent(),'全結果');
  assert.ok((await page.locator('.all-results-button').first().getAttribute('href')).endsWith('/results20261113.html'));
  assert.equal(await page.locator('.race-result-toggle').count(),0,'archived card receives navigation without changing its result presentation');
  await tap(page.locator('.all-results-button').first());
  await page.waitForURL(/\/results20261113\.html$/);
  await page.waitForSelector('.race-result-table',{timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.race-results-cell')].every(cell=>['pending','payouts','results','error'].includes(cell.dataset.resultState)),null,{timeout:90000});
  assert.equal(await page.locator('.race-result-error').count(),0);
  await compactNavigation('20261113');
  const known=page.locator('#race-28-7 .race-results-cell');
  assert.match(await known.innerText(),/2車単/);assert.match(await known.innerText(),/3連単/);
  assert.match(await known.innerText(),/2車複/);assert.match(await known.innerText(),/ワイド/);
  assert.doesNotMatch(await known.locator('.race-result-payout-table').innerText(),/,/);
  assert.ok(await known.locator('.race-result-yen[data-bet-type="quinella"][aria-label]').count()>0);
  assert.ok(await known.locator('.race-result-yen[data-bet-type="wide"][aria-label]').count()>=3);
  const resultRows=await known.locator('.race-result-table tbody > tr').count();
  assert.equal(resultRows,await page.locator('#race-28-7 .lineup .car').count());
  assert.equal(await known.locator('.race-result-table tbody > tr').first().locator('.race-result-rank').textContent(),'1');
  assert.equal(await known.locator('.race-result-shb').first().evaluate(node=>getComputedStyle(node).fontWeight),'400');
  assert.deepEqual(await known.locator('.race-result-table th').allTextContents(),['着順','車番','選手名','あがり','勝敗因','決','SHB','着差']);
  const presentation=await known.evaluate(block=>{
   const row=block.closest('#rows > tr'),table=block.querySelector('.race-result-table'),lineup=row.querySelector('.lineup');
   const video=block.querySelector('.race-result-video'),header=row.querySelector('.video-actions .video-link'),button=block.querySelector('.race-result-toggle');
   const body=table.querySelector('.race-result-time'),margin=table.querySelector('.race-result-margin');
   const colors=[...table.querySelectorAll('.race-result-car')].every(badge=>{
    const car=row.querySelector('.lineup .car.c'+badge.textContent);
    return car&&getComputedStyle(car).backgroundColor===getComputedStyle(badge).backgroundColor&&getComputedStyle(car).color===getComputedStyle(badge).color;
   });
   return {tableWidth:table.getBoundingClientRect().width,lineupWidth:lineup.getBoundingClientRect().width,
    timeWidth:body.getBoundingClientRect().width,marginWidth:margin.getBoundingClientRect().width,
    font:parseFloat(getComputedStyle(body).fontSize),marginFont:parseFloat(getComputedStyle(margin).fontSize),colors,
    replayMatches:video.href===header.href,replayTarget:video.target,replayHandler:video.getAttribute('onclick'),
    videoHeight:video.getBoundingClientRect().height,headerHeight:header.getBoundingClientRect().height,gap:video.getBoundingClientRect().left-button.getBoundingClientRect().right};
  });
  assert.ok(Math.abs(presentation.tableWidth-presentation.lineupWidth)<1,'results must fit the lineup width');
  assert.ok(Math.abs(presentation.timeWidth-presentation.marginWidth)<1,'margin and individual time use the same compact width');
  assert.ok(presentation.font>8 && presentation.marginFont===presentation.font-1);
  assert.ok(presentation.colors && presentation.replayMatches);assert.equal(presentation.replayTarget,'_self');assert.equal(presentation.replayHandler,null);
  assert.ok(presentation.videoHeight<presentation.headerHeight && presentation.gap>=5);
  assert.equal(await page.locator('video,audio,iframe').count(),0);
  assert.equal(mutations.length,0,'result display must not mutate any database or authentication state');
  assert.deepEqual(errors,[]);
  await page.locator('#race-28-7').scrollIntoViewIfNeeded();
  if(screenshot)await page.screenshot({path:screenshot});
  console.log(JSON.stringify({pass:true,viewport:'iPhone14Pro 393x852',races:count,currentAllResults:current,geometry,presentation,cardDate,archivedCard:'line20261113.html',archivedResults:'results20261113.html',resultRows,mutations:mutations.length,mediaElements:0,pageErrors:errors.length}));
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
