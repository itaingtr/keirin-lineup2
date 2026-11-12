// Real mobile smoke test for the isolated index2 experiment. No writes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;
try { ({chromium}=require('playwright-core')); }
catch { ({chromium}=require('playwright')); }
const publicDir=path.resolve(process.argv[2]||'public');
const screenshot=process.argv[3]||process.env.TEN_SCREENSHOT;
const targetPage=process.argv[4]||'index2.html';
const prefix='/keirin-lineup2/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};

async function main(){
  const html=fs.readFileSync(path.join(publicDir,targetPage),'utf8');
  assert.ok(html.includes('data-ten-meetings="true"'),'The checked experiment must be exported');
  const day=/<base href="\/keirin-lineup2\/data\/(\d{8})\//.exec(html)?.[1];
  assert.ok(day,'Experiment needs a date-bound data base');
  const data=JSON.parse(fs.readFileSync(path.join(publicDir,'data',day,'ten-meetings.json'),'utf8'));
  if(data.history_storage==='rider-master')for(const r of data.races)for(const p of r.players)p.meetings=JSON.parse(fs.readFileSync(path.join(publicDir,p.history_ref.path),'utf8')).meetings;
  if(targetPage==='index.html')assert.equal(fs.readFileSync(path.join(publicDir,'line'+day+'.html'),'utf8'),html,'Root and dated page must be identical');
  const known=new Map();
  for(const race of data.races)for(const player of race.players)for(const meeting of player.meetings)for(const result of meeting.days){
    if(result.video_url)known.set(result.race_id,{meeting,result});
  }
  const server=http.createServer((request,response)=>{
    if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
    let pathname;
    try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch{response.writeHead(400).end();return;}
    if(!pathname.startsWith(prefix)){response.writeHead(404).end();return;}
    const file=path.resolve(publicDir,pathname.slice(prefix.length)||'index.html');
    if(file!==publicDir&&!file.startsWith(publicDir+path.sep)){response.writeHead(403).end();return;}
    try{
      const bytes=fs.readFileSync(file);
      response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
      response.end(request.method==='HEAD'?undefined:bytes);
    }catch{response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
    if(process.env.CHROME_PATH)browser=await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
    else{try{browser=await chromium.launch({...launch,channel:'chrome'});}catch{browser=await chromium.launch(launch);}}
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const mutations=[],errors=[];
    await context.route('**/*',async route=>{
      if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){mutations.push(route.request().method());await route.abort('blockedbyclient');}
      else await route.continue();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));
    await page.goto('http://127.0.0.1:'+server.address().port+prefix+targetPage,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.body.dataset.tenMeetingsStatus==='ready'&&document.body.dataset.previousMeetingsStatus==='ready',null,{timeout:30000});
    await page.evaluate(async()=>{await document.fonts.ready;});
    async function tap(control){
      await control.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const point=await control.evaluate(node=>{
        const box=node.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
        const hit=document.elementFromPoint(x,y),view=window.visualViewport,scale=view?.scale||1;
        return {x:(x-(view?.offsetLeft||0))*scale,y:(y-(view?.offsetTop||0))*scale,correct:hit===node||node.contains(hit)};
      });
      assert.ok(point.correct,'A real touch must hit the intended control');
      await page.touchscreen.tap(point.x,point.y);
    }
    const initial=await page.evaluate(()=>({
      riders:document.querySelectorAll('.lineup .rider').length,
      controls:[...document.querySelectorAll('.lineup .rider')].map(rider=>({
        previous:rider.querySelector('.previous-toggle')?.textContent,
        ten:rider.querySelector('.ten-toggle')?.textContent,
        order:rider.querySelector('.ten-controls')?.previousElementSibling?.classList.contains('previous-controls'),
        hidden:rider.querySelector('.ten-results')?.hidden,
      })),
    }));
    assert.equal(initial.riders,data.races.reduce((sum,race)=>sum+race.players.length,0));
    assert.ok(initial.controls.every(item=>item.previous==='前回'&&item.ten==='成績'&&item.order&&item.hidden),
      'Every rider initially needs collapsed 前回 then 成績 controls');
    const firstRow=page.locator('#rows > tr').first(),first=firstRow.locator('.ten-toggle').first();
    await tap(first);
    await page.waitForFunction(()=>document.querySelector('.ten-toggle')?.getAttribute('aria-expanded')==='true');
    const geometry=await firstRow.evaluate(row=>({
      open:[...row.querySelectorAll('.ten-results')].every(panel=>!panel.hidden),
      previousClosed:[...row.querySelectorAll('.previous-results')].every(panel=>panel.hidden),
      widths:[...row.querySelectorAll('.ten-controls')].map(node=>parseFloat(getComputedStyle(node).width)),
      panelHeights:[...row.querySelectorAll('.ten-results')].map(node=>parseFloat(getComputedStyle(node).height)),
      groups:[...row.querySelectorAll('.ten-results')].map(panel=>[...panel.querySelectorAll('.ten-meeting')].map(group=>({
        top:group.getBoundingClientRect().top,height:parseFloat(getComputedStyle(group).height),
      }))),
    }));
    assert.ok(geometry.open&&geometry.previousClosed,'One 成績 touch must open only its whole race ten-meeting panels');
    assert.ok(geometry.widths.every(width=>Math.abs(width-22)<0.1),'Original22px rider columns must remain');
    assert.ok(geometry.panelHeights.every(height=>Math.abs(height-180)<0.2),'Ten two-line meetings should occupy180px');
    assert.ok(geometry.groups.every(groups=>groups.length===10&&groups.every(group=>Math.abs(group.height-18)<0.1)));
    for(let slot=0;slot<10;slot++){
      const tops=geometry.groups.map(groups=>groups[slot].top);
      assert.ok(Math.max(...tops)-Math.min(...tops)<1.6,'Meeting rows must stay aligned across all race members');
    }
    const styles=await page.evaluate(()=>({
      highlights:[...document.querySelectorAll('.ten-rank-highlight,.previous-important-rank,.previous-semifinal-rank')].map(node=>({color:getComputedStyle(node).color,semi:node.classList.contains('ten-rank-semifinal')||node.classList.contains('previous-semifinal-rank')})),
      g3:[...document.querySelectorAll('.ten-grade-g3')].map(node=>getComputedStyle(node).backgroundColor),
      high:[...document.querySelectorAll('.ten-grade-high')].map(node=>getComputedStyle(node).backgroundColor),
      back:[...document.querySelectorAll('.lineup .stat-b,.lineup .stat-b-zero')].map(node=>getComputedStyle(node).fontWeight),
      links:[...document.querySelectorAll('a.ten-rank')].map(node=>({id:node.dataset.raceId,url:node.href})),
      otherOpen:[...document.querySelectorAll('#rows > tr')].slice(1).some(row=>[...row.querySelectorAll('.ten-results')].some(panel=>!panel.hidden)),
    }));
    assert.ok(styles.highlights.every(item=>item.color===(item.semi?'rgb(232, 90, 154)':'rgb(211, 47, 47)')),'Only semifinals use pink; special and final ranks must be red');
    assert.ok(styles.g3.every(color=>color==='rgb(255, 235, 238)'));
    assert.ok(styles.high.every(color=>color==='rgb(243, 229, 245)'));
    assert.ok(styles.back.length>0&&styles.back.every(weight=>weight==='700'),'Aggregate B counts must be bold');
    assert.equal(styles.otherOpen,false,'Other races remain independently closed');
    for(const item of styles.links){
      const expected=known.get(item.id);assert.ok(expected,'A linked placing needs checked source evidence');
      const url=new URL(item.url);
      assert.ok(['keirin.kdreams.jp','my.keirin.kdreams.jp'].includes(url.hostname));
      assert.equal(url.pathname,'/stadium/digest/');
      assert.equal(url.searchParams.get('kaisaiDate'),expected.result.race_date.replaceAll('-',''));
      assert.equal(url.searchParams.get('kyogijoCd'),expected.meeting.venue_code);
      assert.equal(Number(url.searchParams.get('raceNo')),expected.result.race_number);
      assert.equal(Number(url.searchParams.get('gradeCd')),expected.meeting.grade_code);
    }
    if(screenshot)await page.screenshot({path:screenshot,fullPage:false});
    const member=firstRow.locator('.ten-toggle').nth(Math.min(1,geometry.groups.length-1));
    await tap(member);
    assert.ok(await firstRow.locator('.ten-results').evaluateAll(panels=>panels.every(panel=>panel.hidden)),
      'Any race member can close the entire ten-meeting list');
    await tap(firstRow.locator('.previous-toggle').first());
    assert.ok(await firstRow.locator('.previous-results').evaluateAll(panels=>panels.every(panel=>!panel.hidden)),'The existing 前回 control still works');
    assert.ok(await firstRow.locator('.ten-results').evaluateAll(panels=>panels.every(panel=>panel.hidden)),'The two toggles stay independent');
    assert.deepEqual(mutations,[],'The experiment test must issue no writes');
    assert.deepEqual(errors,[],'The actual experiment must execute without browser errors');
    console.log('TEN BROWSER PASS',JSON.stringify({viewport:'390x844',riders:initial.riders,slots:10,slotHeight:18,
      page:targetPage,highlighted:styles.highlights.length,linked:styles.links.length,realTouch:true,writeRequests:0}));
  }finally{
    if(browser)await browser.close();server.closeAllConnections?.();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
