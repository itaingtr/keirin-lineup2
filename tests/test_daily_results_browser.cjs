const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, devices} = require('playwright');
const root = path.resolve(process.argv[2] || 'public');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/20261114/all-rider-results.json')));
const href = 'https://itaingtr.github.io/keirin-lineup2/daily-results/index.html';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  try {
    const context = await browser.newContext({...devices['iPhone 13'], defaultBrowserType: undefined, acceptDownloads: true});
    await context.addInitScript(() => {
      const OriginalDate = Date;
      window.Date = class extends OriginalDate {
        constructor(...args) {super(...(args.length ? args : ['2026-11-14T02:00:00Z']));}
        static now() {return new OriginalDate('2026-11-14T02:00:00Z').getTime();}
      };
    });
    let failPrevious = false, badPlayer = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://itaingtr.github.io') return route.abort();
      const relative = decodeURIComponent(url.pathname.replace('/keirin-lineup2/', ''));
      if (failPrevious && relative === index.assets.previous.path) return route.fulfill({status: 503, body: 'Unavailable'});
      if (badPlayer && relative === index.races[0].players[0].history_ref.path) return route.fulfill({contentType: 'application/json', body: '{}'});
      const file = path.join(root, relative);
      if (!fs.existsSync(file)) return route.fulfill({status: 404});
      let body = fs.readFileSync(file);
      if (relative === 'calendar/dates.json') {
        const calendar = JSON.parse(body); calendar.current_date = '2026-11-15';
        body = Buffer.from(JSON.stringify(calendar));
      }
      await route.fulfill({status: 200, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.json') ? 'application/json' : 'text/html', body});
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(href);
    await page.waitForFunction(() => document.querySelectorAll('#entries > tr').length === 153);
    assert.equal(await page.locator('#date').inputValue(), '2026-11-14', 'JST today must not use tomorrow top date');
    await page.waitForFunction(() => !document.querySelector('#json').disabled);
    assert.equal(await page.locator('#entries > tr').count(), 153);
    assert.equal(await page.locator('#entries > tr td:nth-child(5) .meeting').count(), 306);
    assert.equal(await page.locator('#entries > tr td:nth-child(6) .meeting').count(), 1528);
    assert.equal(await page.locator('video,iframe,dialog').count(), 0);
    await page.locator('#search').fill(index.races[0].players[0].player_id);
    assert.equal(await page.locator('#entries > tr:visible').count(), 1);
    const downloadJSON = page.waitForEvent('download'); await page.locator('#json').tap();
    const jsonFile = await downloadJSON;
    const full = JSON.parse(fs.readFileSync(await jsonFile.path(), 'utf8'));
    assert.equal(full.entries.length, 153, 'Downloads include all entries under a filter');
    assert.equal(full.entries.flatMap(e => e.prior_ten_meetings).length, 1528);
    for (const [id, expected] of [['riders-csv', 153], ['results-csv', 5947]]) {
      const waiting = page.waitForEvent('download'); await page.locator('#' + id).tap();
      const download = await waiting;
      const bytes = fs.readFileSync(await download.path());
      assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
      // Full CSV parsing and tri-state values are covered by the model test.
      assert.equal(bytes.toString('utf8').split('\r\n').length - 2, expected);
    }
    await page.locator('#search').fill('');
    await page.locator('#venue').selectOption('34');
    assert.equal(await page.locator('#entries > tr:visible').count(), 49);
    await page.locator('#race').selectOption('6');
    assert.equal(await page.locator('#entries > tr:visible').count(), 7);
    await page.locator('#venue').selectOption(''); await page.locator('#race').selectOption('');
    const firstReplay = page.locator('#entries a[href$=".mp4"]').first();
    assert.equal(await firstReplay.getAttribute('target'), '_self');
    assert.equal(await firstReplay.getAttribute('onclick'), null);
    await page.screenshot({path: '/tmp/keirin-daily-results-mobile.png', fullPage: false});
    await page.locator('#date').fill('2026-11-15'); await page.locator('#date').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('未公開'));
    assert.equal(await page.locator('#entries > tr').count(), 0);
    assert.equal(await page.locator('#json').isDisabled(), true);
    await page.locator('#date').fill('2026-11-13'); await page.locator('#date').dispatchEvent('change');
    await page.waitForFunction(() => !document.querySelector('#json').disabled);
    assert.equal(await page.locator('#entries > tr').count(), 186);
    assert.equal(await page.locator('.absent').count(), 1);
    // A fresh page has no successful memory cache, exercising independent
    // failures while all base rows and the other checked players survive.
    failPrevious = true; badPlayer = true;
    await page.goto(href + '?date=20261114');
    await page.waitForFunction(() => !document.querySelector('#json').disabled);
    assert.equal(await page.locator('#entries > tr').count(), 153);
    assert.equal(await page.locator('#entries > tr td:nth-child(6) .meeting').count(), 1518);
    assert.equal(await page.locator('#entries > tr td:nth-child(4) .result').count(), 204);
    failPrevious = false; badPlayer = false;
    await page.locator('#reload').tap();
    await page.waitForFunction(() => !document.querySelector('#json').disabled && !document.querySelector('#status').textContent.includes('保留'));
    assert.equal(await page.locator('#entries > tr td:nth-child(5) .meeting').count(), 306);
    assert.equal(await page.locator('#entries > tr td:nth-child(6) .meeting').count(), 1528);
    assert.deepEqual(errors, []);
    console.log('DAILY BROWSER PASS: mobile touch, JST date, all downloads, filters, absent/unpublished days, isolated checksum failures, retry and plain MP4 anchors');
    await context.close();
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
