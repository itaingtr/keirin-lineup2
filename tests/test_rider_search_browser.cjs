const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
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
      await page.locator('#rider-query').fill('脇本　雄太');await page.locator('#rider-search button').tap();
      await page.waitForFunction(()=>document.querySelector('#rider-name').textContent==='脇本雄太'&&document.querySelector('#profile-status').textContent.includes('最新公開'));
      assert.equal(await page.locator('#rider-meetings > .meeting').count(),profile.meetings.length);
      assert.match(await page.locator('#techniques').textContent(),/%/);
      assert.equal(await page.locator('#official-profile').getAttribute('href'),'https://keirin.jp/pc/racerprofile?snum=014396');
      const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,name:document.querySelector('#rider-name').getBoundingClientRect().bottom,history:document.querySelector('#rider-meetings').getBoundingClientRect().top,first:document.querySelector('.meeting').getBoundingClientRect().height}));
      assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
      assert.ok(geometry.history>geometry.name && geometry.history-geometry.name<180);
      assert.ok(geometry.first<90,'Meeting rows should not reserve a full rider-column height');
      if(width===390)await page.screenshot({path:'/tmp/rider-search-mobile.png'});
      const before=await page.locator('#rider-meetings').textContent();fail=true;
      await page.locator('#profile-refresh').tap();await page.waitForFunction(()=>document.querySelector('#profile-status').textContent.includes('失敗'));
      assert.equal(await page.locator('#rider-meetings').textContent(),before,'Source failure must retain the stock');
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('RIDER SEARCH BROWSER PASS: Wakimoto name search, official profile, latest techniques, vertical ten meetings, 320px without horizontal scrolling, safe refresh failure');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
