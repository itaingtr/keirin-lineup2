// Real browser smoke check. Uses the published anonymous client; never logs
// API keys, request URLs, condition bodies or authentication state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({chromium} = require('playwright-core')); }
catch { ({chromium} = require('playwright')); }

const publicDir = path.resolve(process.argv[2] || 'public');
const screenshot = process.argv[3] || process.env.PREVIOUS_SCREENSHOT;
const targetPage = process.argv[4] || 'index.html';
const prefix = '/keirin-lineup2/';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.png':'image/png','.svg':'image/svg+xml'};

function featureRead(request) {
  if (request.method() !== 'GET') return false;
  const url = new URL(request.url());
  return url.hostname.endsWith('.supabase.co') && url.pathname === '/rest/v1/race_comments'
    && (url.searchParams.get('race_key') || '').startsWith('in.(');
}

async function main() {
  assert.ok(['index.html','index2.html'].includes(targetPage), 'Only a checked public page can be tested');
  assert.ok(fs.existsSync(path.join(publicDir,targetPage)), 'The real public artifact is required');
  let datedPage;
  if (targetPage === 'index.html') {
    const source = fs.readFileSync(path.join(publicDir,targetPage),'utf8');
    const day = /<base href="\/keirin-lineup2\/data\/(\d{8})\//.exec(source)?.[1];
    assert.ok(day,'The top page needs a checked date base');
    datedPage = 'line'+day+'.html';
    assert.equal(fs.readFileSync(path.join(publicDir,datedPage),'utf8'),source,'Root and current date must be byte-identical');
    assert.ok(source.includes('data-previous-meetings-src="previous-daily.json"'),'Normal cards need the date-bound daily history');
  }
  const server = http.createServer((request,response) => {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const file = path.resolve(publicDir,pathname.slice(prefix.length) || 'index.html');
    if (file !== publicDir && !file.startsWith(publicDir+path.sep)) { response.writeHead(403).end(); return; }
    try {
      const bytes = fs.readFileSync(file);
      response.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const launch = {headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
    if (process.env.CHROME_PATH) browser = await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
    else {
      try { browser = await chromium.launch({...launch,channel:'chrome'}); }
      catch { browser = await chromium.launch(launch); }
    }
    const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,
      isMobile:true,hasTouch:true});
    const mutations = [], errors = [], reads = [];
    await context.route('**/*',async route => {
      const request = route.request();
      // OPTIONS is a harmless CORS preflight required for authenticated GETs.
      // A fresh browser has no login session and must issue no mutations.
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) {
        mutations.push(request.method());
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror',error => errors.push(error.name));
    page.on('response',response => {
      if (featureRead(response.request())) reads.push(response);
    });
    const origin = 'http://127.0.0.1:'+server.address().port;
    await page.goto(origin+prefix+targetPage,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(() => document.body.dataset.previousMeetingsStatus === 'ready',null,{timeout:30000});
    await page.waitForFunction(() => window.keirinBoard?.ready === true,null,{timeout:30000});
    await page.evaluate(async () => { await document.fonts.ready; });
    async function tapControl(control) {
      await control.evaluate(node => node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const point = await control.evaluate(node => {
        const box = node.getBoundingClientRect();
        const x = box.left + box.width/2, y = box.top + box.height/2;
        const hit = document.elementFromPoint(x,y);
        const view=window.visualViewport;
        const scale=view?.scale || 1;
        return {x:(x-(view?.offsetLeft || 0))*scale,y:(y-(view?.offsetTop || 0))*scale,
          layoutX:x,layoutY:y,scale,correct:hit === node || node.contains(hit),
          hitTag:hit?.tagName,hitClass:hit?.className};
      });
      console.log('PREVIOUS MOBILE HIT',JSON.stringify(point));
      if (screenshot) await page.screenshot({path:screenshot,fullPage:false});
      assert.ok(point.correct,'The actual touchscreen point must reach the preview button');
      await page.touchscreen.tap(point.x,point.y);
    }
    const first = page.locator('.previous-toggle').first();
    assert.ok(await page.locator('.previous-toggle').count(), 'Every real rider needs the preview control');
    await tapControl(first);
    await page.waitForFunction(() => document.querySelector('.previous-toggle')?.getAttribute('aria-expanded') === 'true');
    const geometry = await page.locator('#rows > tr').first().evaluate(row => {
      const panels = [...row.querySelectorAll('.previous-results')];
      const groups = panels.map(panel => [...panel.querySelectorAll('.previous-meeting')]);
      return {
        opened:panels.every(panel => !panel.hidden),
        widths:[...row.querySelectorAll('.previous-controls')].map(control => getComputedStyle(control).width),
        slotCounts:groups.map(pair => pair.map(group => group.querySelectorAll('.previous-result').length)),
        tops:groups.map(pair => pair.map(group => group.getBoundingClientRect().top)),
        times:[...row.querySelectorAll('.previous-time')].map(node => getComputedStyle(node).fontSize),
        resultHeights:[...row.querySelectorAll('.previous-result')].map(node => parseFloat(getComputedStyle(node).height)),
      };
    });
    if (screenshot) await page.screenshot({path:screenshot,fullPage:false});
    console.log('PREVIOUS BROWSER GEOMETRY',JSON.stringify(geometry));
    assert.ok(geometry.opened && geometry.slotCounts.length > 0, 'One click must open the whole race');
    // Fractional mobile layout zoom quantizes CSS widths to layout units.
    assert.ok(geometry.widths.every(width => Math.abs(parseFloat(width)-22)<0.1), 'The original rider width must remain22px');
    assert.ok(geometry.slotCounts.every(pair => pair.length === 2 && pair[0] >= 4 && pair[0] === pair[1]),
      'Both previous meetings need matching slots, including blank fourth rows');
    assert.ok(geometry.times.every(size => size === '8px'), 'Individual times must remain8px');
    assert.ok(geometry.resultHeights.every(size=>size<=16.1&&size>=15.9), 'The old29px historical rows must be compacted to16px');
    const styled = await page.evaluate(() => {
      const headings=[...document.querySelectorAll('.previous-heading')];
      return {headings:headings.map(node=>({text:node.textContent,grade3:node.classList.contains('previous-grade-g3'),high:node.classList.contains('previous-grade-high'),color:getComputedStyle(node).backgroundColor})),
        ranks:[...document.querySelectorAll('.previous-important-rank')].map(node=>getComputedStyle(node).color),
        semifinals:[...document.querySelectorAll('.previous-semifinal-rank')].map(node=>getComputedStyle(node).color),
        s:[...document.querySelectorAll('#rows > tr')].map(row=>[...row.querySelectorAll('.recent-s')].map(node=>({value:Number(node.textContent)||0,text:node.textContent.trim(),weight:getComputedStyle(node).fontWeight,color:getComputedStyle(node).color}))) };
    });
    assert.ok(styled.headings.every(item=>Array.from(item.text).length<=3), 'Venue headings must use at most3characters');
    assert.ok(styled.headings.length > 0, 'Previous-meeting venue headings must be present');
    for(const heading of styled.headings){
      if(heading.grade3)assert.equal(heading.color,'rgb(255, 235, 238)');
      if(heading.high)assert.equal(heading.color,'rgb(243, 229, 245)');
    }
    assert.ok(styled.ranks.every(color=>color==='rgb(211, 47, 47)'), 'Special/final ranks must be red');
    const semifinalColor=await page.evaluate(()=>document.body.dataset.historyLayout==='compact-20261113'?'rgb(212, 160, 0)':document.body.dataset.tenMeetings==='true'?'rgb(232, 90, 154)':'rgb(239, 108, 0)');
    assert.ok(styled.semifinals.every(color=>color===semifinalColor), 'Semifinal rank colour must match the adopted page style');
    const compactGeometry=await page.evaluate(()=>document.body.dataset.historyLayout==='compact-20261113'?{
      s:[...document.querySelectorAll('.lineup .rider')].map(r=>({before:r.querySelector('.recent-s')?.previousElementSibling?.classList.contains('score'),after:r.querySelector('.recent-s')?.nextElementSibling?.classList.contains('car')})),
      ranks:[...document.querySelectorAll('.previous-rank,.meeting-rank')].map(n=>getComputedStyle(n).fontSize),
    }:null);
    if(compactGeometry){assert.ok(compactGeometry.s.every(n=>n.before&&n.after),'S counts must sit between score and car');assert.ok(compactGeometry.ranks.every(size=>size==='8px'),'Accident and numeric placings must share8px text');}
    console.log('PREVIOUS BROWSER COLORS',JSON.stringify({specialFinal:styled.ranks.length,semifinals:styled.semifinals.length}));
    for(const members of styled.s){
      const maximum=Math.max(0,...members.map(item=>item.value));
      for(const item of members){
        assert.equal(item.color,'rgb(8, 125, 54)');
        assert.equal(item.weight,item.value>0&&item.value===maximum?'700':'400');
        if(item.value===0)assert.equal(item.text,'');
      }
    }
    for (const index of [0,1]) {
      const positions = geometry.tops.map(pair => pair[index]);
      assert.ok(Math.max(...positions)-Math.min(...positions) <= 1.5,
        'Previous-meeting rows must line up across all riders');
    }
    if (!reads.some(response => response.status() >= 200 && response.status() < 300)) {
      await page.waitForResponse(response => featureRead(response.request())
        && response.status() >= 200 && response.status() < 300,{timeout:30000});
    }
    const successful = reads.filter(response => response.status() >= 200 && response.status() < 300);
    assert.ok(successful.length, 'No successful read-only previous-condition request was observed');
    assert.ok(Array.isArray(await successful[0].json()), 'The real condition endpoint must return data rows');
    if (screenshot) await page.screenshot({path:screenshot,fullPage:false});
    await tapControl(first);
    assert.ok(await page.locator('#rows > tr').first().locator('.previous-results').evaluateAll(
      panels => panels.every(panel => panel.hidden)), 'The next click must close the whole race');
    if (datedPage) {
      await page.goto(origin+prefix+datedPage,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(() => document.body.dataset.previousMeetingsStatus === 'ready',null,{timeout:30000});
      assert.equal(await page.locator('.previous-toggle').count(),await page.locator('.lineup .rider').count(),'The date page must activate the same feature for every rider');
    }
    assert.deepEqual(mutations,[], 'The smoke check must issue no write requests');
    assert.deepEqual(errors,[], 'The real preview must execute without browser errors');
    console.log('PREVIOUS BROWSER PASS:'+targetPage+',390x844, race-wide toggle, aligned four-slot groups,22px columns,8px times, verified rank colours and real read-only condition GET.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.name+': '+error.message); process.exitCode=1; });
