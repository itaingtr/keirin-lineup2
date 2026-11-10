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
  assert.ok(fs.existsSync(path.join(publicDir,'index2.html')), 'The real index2 artifact is required');
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
    try { browser = await chromium.launch({...launch,channel:'chrome'}); }
    catch { browser = await chromium.launch(launch); }
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
    await page.goto(origin+prefix+'index2.html',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(() => document.body.dataset.previousMeetingsStatus === 'ready',null,{timeout:30000});
    await page.waitForFunction(() => window.keirinBoard?.ready === true,null,{timeout:30000});
    const first = page.locator('.previous-toggle').first();
    assert.ok(await page.locator('.previous-toggle').count(), 'Every real rider needs the preview control');
    await first.click();
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
      };
    });
    assert.ok(geometry.opened && geometry.slotCounts.length > 0, 'One click must open the whole race');
    assert.ok(geometry.widths.every(width => width === '22px'), 'The original rider width must remain22px');
    assert.ok(geometry.slotCounts.every(pair => pair.length === 2 && pair[0] >= 4 && pair[0] === pair[1]),
      'Both previous meetings need matching slots, including blank fourth rows');
    assert.ok(geometry.times.every(size => size === '8px'), 'Individual times must remain8px');
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
    await first.click();
    assert.ok(await page.locator('#rows > tr').first().locator('.previous-results').evaluateAll(
      panels => panels.every(panel => panel.hidden)), 'The next click must close the whole race');
    assert.deepEqual(mutations,[], 'The smoke check must issue no write requests');
    assert.deepEqual(errors,[], 'The real preview must execute without browser errors');
    console.log('PREVIOUS BROWSER PASS:390x844, race-wide toggle, aligned four-slot groups,22px columns,8px times and real read-only condition GET.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.name+': '+error.message); process.exitCode=1; });
