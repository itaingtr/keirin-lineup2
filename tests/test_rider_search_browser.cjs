const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const M=require('../site/daily-results/search-model.js');
const root=path.resolve(process.argv[2]||'public');
(async()=>{
  const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
  const browser=await chromium.launch({...launch,channel:process.env.CHROME_PATH?undefined:'chrome',executablePath:process.env.CHROME_PATH});
  try{
    const catalogue=JSON.parse(fs.readFileSync(path.join(root,'daily-results/riders.json')));
    const rider=catalogue.players.find(p=>p.player_id==='014396');assert.ok(rider.profile_ref,'Real checked Wakimoto profile fixture is required');
    const profile=JSON.parse(fs.readFileSync(path.join(root,rider.profile_ref.path)));
    for(const width of [320,390,1280]){
      const context=await browser.newContext({viewport:{width,height:850},isMobile:width<500,hasTouch:true});
      let fail=false,delayed=false;const errors=[];
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/rider-profile')){
          assert.equal(route.request().method(),'GET');
          if(fail)return route.fulfill({status:502,contentType:'application/json',body:'{}'});
          if(delayed)await new Promise(resolve=>setTimeout(resolve,500));
          return route.fulfill({contentType:'application/json',body:JSON.stringify(profile)});
        }
        if(url.origin!=='https://itaingtr.github.io')return route.abort();
        const relative=url.pathname.replace('/keirin-lineup2/',''),file=path.join(root,relative);
        if(!fs.existsSync(file))return route.fulfill({status:404});
        return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',body:fs.readFileSync(file)});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto('https://itaingtr.github.io/keirin-lineup2/daily-results/index.html');
      await page.waitForFunction(()=>document.querySelectorAll('#rider-list > tr').length===30);
      assert.equal(await page.locator('#region-buttons button').count(),8);
      assert.equal(await page.locator('#sort-buttons button').count(),6);
      const bands=await page.evaluate(()=>({
        regions:[...document.querySelectorAll('#region-buttons button')].map(b=>b.getBoundingClientRect().top),
        sorts:[...document.querySelectorAll('#sort-buttons button')].map(b=>b.getBoundingClientRect().top),
        search:document.querySelector('#rider-search').getBoundingClientRect().top,
        scroll:document.documentElement.scrollWidth,width:innerWidth,
      }));
      assert.ok(Math.max(...bands.regions)-Math.min(...bands.regions)<1);
      assert.ok(Math.max(...bands.sorts)-Math.min(...bands.sorts)<1);
      assert.ok(bands.regions[0]<bands.sorts[0]&&bands.sorts[0]<bands.search);
      assert.ok(bands.scroll<=bands.width+1,JSON.stringify(bands));
      const rowIds=()=>page.locator('#rider-list > tr').evaluateAll(rows=>rows.map(row=>row.dataset.playerId));
      const top=M.sortPlayers(catalogue.players.filter(p=>M.scoreOf(p)!==null)).slice(0,30).map(p=>p.player_id);
      assert.deepEqual(await rowIds(),top);
      assert.equal(await page.locator('#pages-top').isVisible(),false);
      if(width===390)await page.screenshot({path:'/tmp/rider-directory-mobile.png'});
      await page.locator('#show-all').tap();
      const firstPage=await rowIds();assert.equal(firstPage.length,Math.ceil(catalogue.players.length/2));
      assert.equal(await page.locator('#pages-top button').count(),2);
      await page.locator('#pages-top button').nth(1).tap();
      const secondPage=await rowIds();assert.equal(new Set([...firstPage,...secondPage]).size,catalogue.players.length);
      const kanto=page.locator('#region-buttons button[data-region="関東"]');await kanto.tap();
      assert.equal(await kanto.getAttribute('aria-pressed'),'true');
      assert.ok((await rowIds()).every(id=>M.regionOf(catalogue.players.find(p=>p.player_id===id))==='関東'));
      const age=page.locator('#sort-buttons button[data-sort="age"]'),period=page.locator('#sort-buttons button[data-sort="period"]');
      await age.tap();assert.equal(await age.getAttribute('data-direction'),'asc');
      await age.tap();assert.equal(await age.getAttribute('data-direction'),'desc');
      await period.tap();await period.tap();
      assert.equal(await period.getAttribute('data-direction'),'desc');
      assert.equal(await page.locator('#sort-order').textContent(),'並び：期別↓ → 年齢↓ → 得点↓');
      const ordered=(await rowIds()).map(id=>catalogue.players.find(p=>p.player_id===id));
      for(let i=1;i<ordered.length;i++){
        assert.ok(Number(ordered[i-1].period)>=Number(ordered[i].period));
        if(Number(ordered[i-1].period)===Number(ordered[i].period))assert.ok(ordered[i-1].age>=ordered[i].age);
      }
      await period.tap();assert.equal(await period.getAttribute('data-direction'),'off');
      assert.equal(await page.locator('#sort-order').textContent(),'並び：年齢↓ → 得点↓');
      const self=page.locator('#sort-buttons button[data-role="self"]');await self.tap();
      assert.ok((await page.locator('.directory-role').allTextContents()).every(label=>label.includes('自力型')));
      await self.tap();assert.equal(await self.getAttribute('aria-pressed'),'false');
      await page.locator('#show-top').tap();assert.equal(await page.locator('#rider-list > tr').count(),30);
      await page.locator('#rider-query').fill('脇本　雄太');await page.locator('#rider-search button').tap();
      await page.waitForFunction(()=>document.querySelector('#rider-name').textContent==='脇本雄太'&&/最新公開|このセッションで確認済み/.test(document.querySelector('#profile-status').textContent));
      assert.equal(await page.locator('#rider-meetings > .meeting').count(),profile.meetings.length);
      assert.match(await page.locator('#techniques').textContent(),/%/);
      assert.equal(await page.locator('#official-profile').getAttribute('href'),'https://keirin.jp/pc/racerprofile?snum=014396');
      const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,name:document.querySelector('#rider-name').getBoundingClientRect().bottom,history:document.querySelector('#rider-meetings').getBoundingClientRect().top,first:document.querySelector('.meeting').getBoundingClientRect().height}));
      assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
      assert.ok(geometry.history>geometry.name && geometry.history-geometry.name<180);
      assert.ok(geometry.first<90,'Meeting rows should not reserve a full rider-column height');
      const compactHeight=await page.locator('#rider-meetings').evaluate(node=>node.getBoundingClientRect().height);
      const countBefore=await page.locator('.run').count();
      const baseline=await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'fixtures/rider-history-height-before.css'),'utf8')});
      const oldHeight=await page.locator('#rider-meetings').evaluate(node=>node.getBoundingClientRect().height);
      assert.ok(compactHeight<=oldHeight/2+1,'History must be at most half the previous height: '+compactHeight+' / '+oldHeight);
      assert.equal(await page.locator('.run').count(),countBefore,'Compact rows must retain all rides');
      await baseline.evaluate(node=>node.remove());
      if(width===390)await page.screenshot({path:'/tmp/rider-search-mobile.png'});
      if(width===390)await page.screenshot({path:'/tmp/rider-history-compact-mobile.png'});
      const before=await page.locator('#rider-meetings').textContent();fail=true;
      await page.locator('#profile-refresh').tap();await page.waitForFunction(()=>document.querySelector('#profile-status').textContent.includes('失敗'));
      assert.equal(await page.locator('#rider-meetings').textContent(),before,'Source failure must retain the stock');
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('RIDER SEARCH BROWSER PASS: top30, eight regions, last-click multi-sort and loop, complete two-page lists, role filters, Wakimoto search, half-height histories, 320px without horizontal scrolling, safe refresh failure');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
