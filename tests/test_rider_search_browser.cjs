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
    for(const width of [320,390,428,1280]){
      const context=await browser.newContext({viewport:{width,height:width===428?926:850},deviceScaleFactor:width===428?3:1,isMobile:width<500,hasTouch:true});
      let fail=false,delayed=false,zeroBack=false;const errors=[];
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/rider-profile')){
          assert.equal(route.request().method(),'GET');
          if(fail)return route.fulfill({status:502,contentType:'application/json',body:'{}'});
          if(delayed)await new Promise(resolve=>setTimeout(resolve,500));
          const fixture=width===428?{...profile,counts:{...rider.counts,values:{s:5,b:zeroBack?0:10,nige:4,makuri:5,sashi:10,mark:0,total_starts:45}}}:profile;
          return route.fulfill({contentType:'application/json',body:JSON.stringify(fixture)});
        }
        if(url.origin!=='https://itaingtr.github.io')return route.abort();
        const relative=url.pathname.replace('/keirin-lineup2/',''),file=path.join(root,relative);
        if(!fs.existsSync(file))return route.fulfill({status:404});
        return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',body:fs.readFileSync(file)});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      if(width===390)await page.clock.install({time:new Date()});
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
      const listed=await page.locator('#rider-list > tr').evaluateAll(rows=>rows.map(row=>({
        id:row.dataset.playerId,marked:!!row.querySelector('.birthday-done'),
        fields:[...row.querySelectorAll('.count-item')].map(node=>node.dataset.stat),
        recent:[...row.querySelectorAll('.recent-line')].map(line=>({position:line.dataset.position,text:line.textContent})),
        nameLeft:(()=>{const range=document.createRange();range.selectNodeContents(row.querySelector('.directory-name-button'));return range.getBoundingClientRect().left;})(),
        rankRight:(()=>{const range=document.createRange();range.selectNodeContents(row.querySelector('.directory-number'));return range.getBoundingClientRect().right;})(),
        nameAlign:getComputedStyle(row.querySelector('.directory-name-button')).textAlign,nameBackground:getComputedStyle(row.querySelector('.directory-name')).backgroundColor,
        metaLeft:row.querySelector('.person-meta').getBoundingClientRect().left,
        countsLeft:row.querySelector('.directory-counts').getBoundingClientRect().left,
        scoreLeft:row.querySelector('.directory-score').getBoundingClientRect().left,
        recentLeft:row.querySelector('.directory-recent').getBoundingClientRect().left,
        height:row.getBoundingClientRect().height,
        columns:[...row.querySelectorAll('td')].slice(1).map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom})),
        provinceTop:row.querySelector('.directory-prefecture').getBoundingClientRect().top,
        termTop:row.querySelector('.person-term-age').getBoundingClientRect().top,
        stats:[...row.querySelectorAll('.count-item')].map(node=>({key:node.dataset.stat,raw:node.dataset.value,value:node.querySelector('.count-value').textContent,weight:getComputedStyle(node.querySelector('.count-value')).fontWeight,color:getComputedStyle(node.querySelector('.count-value')).color,size:parseFloat(getComputedStyle(node.querySelector('.count-value')).fontSize)})),
      })));
      for(const row of listed){
        const person=catalogue.players.find(p=>p.player_id===row.id);
        assert.equal(row.marked,M.birthdayState(person).done);assert.deepEqual(row.fields,M.COUNT_FIELDS.map(([key])=>key));
        assert.ok(row.countsLeft<row.scoreLeft&&row.scoreLeft<row.recentLeft,'Counts, score and previous results stay in the requested order');
        assert.deepEqual(row.recent.map(line=>line.position),['previous_previous','previous']);
        assert.equal(row.recent.length,2);
        assert.deepEqual(row.recent.map(line=>line.text),M.previousSlots(person).map(meeting=>meeting?M.gradeName(meeting.grade_code)+M.shortVenue(meeting)+meeting.days.map(day=>day.order||day.accident||'—').join(''):'—'));
        assert.equal(row.nameAlign,'left');assert.ok(row.nameLeft-row.rankRight>=0&&row.nameLeft-row.rankRight<=8,'No large gap between rank and name: '+JSON.stringify(row));
        assert.equal(row.nameBackground==='rgb(255, 240, 245)',M.roleOf(person).kind==='self','Only self-powered names get the pale pink background');
        assert.ok(row.provinceTop<row.termTop,'County above the combined period/age line');
        assert.ok(Math.min(...row.columns.map(c=>c.bottom))>Math.max(...row.columns.map(c=>c.top)),'Identity, counts, score and histories share one horizontal row');
        assert.ok(row.height<=40,'Readable compact row height: '+row.height);
        for(const stat of row.stats){const high=stat.raw!==''&&stat.key!=='total_starts'&&Number(stat.raw)>=(stat.key==='b'?10:5);assert.equal(stat.color==='rgb(214, 51, 132)',high,stat.key+'='+stat.value);}
        assert.ok(row.stats[0].size<=row.stats[1].size-1,'S is one font step smaller');
        assert.ok(Number(row.stats[1].weight)>=700,'B remains bold');if(row.stats[1].raw==='0')assert.equal(row.stats[1].value,'');
        if(width===428)assert.ok(row.stats[2].size>=13,'Count digits are enlarged by two font steps on iPhone14 Plus');
      }
      assert.equal(await page.locator('.directory-role').count(),0,'Remove per-rider role labels');
      assert.doesNotMatch(await page.locator('main').textContent(),/自力型|追込型/);
      assert.equal(await page.locator('#pages-top').isVisible(),false);
      if(width===390)await page.screenshot({path:'/tmp/rider-directory-mobile.png'});
      if(width===428)await page.screenshot({path:'/tmp/rider-directory-iphone14plus.png'});
      await page.locator('#show-all').tap();
      const firstPage=await rowIds();assert.equal(firstPage.length,200);
      assert.equal(await page.locator('#pages-top button').count(),2);
      await page.locator('#pages-top button').nth(1).tap();
      const secondPage=await rowIds();assert.equal(new Set([...firstPage,...secondPage]).size,catalogue.players.length);
      assert.equal(secondPage.length,catalogue.players.length-200);
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
        if(Number(ordered[i-1].period)===Number(ordered[i].period))assert.ok(M.ageOf(ordered[i-1])>=M.ageOf(ordered[i]));
      }
      await period.tap();assert.equal(await period.getAttribute('data-direction'),'off');
      assert.equal(await page.locator('#sort-order').textContent(),'並び：年齢↓ → 得点↓');
      const self=page.locator('#sort-buttons button[data-role="self"]');await self.tap();
      assert.ok((await rowIds()).every(id=>M.roleOf(catalogue.players.find(p=>p.player_id===id)).kind==='self'));
      await self.tap();assert.equal(await self.getAttribute('aria-pressed'),'false');
      await page.locator('#show-top').tap();assert.equal(await page.locator('#rider-list > tr').count(),30);
      await page.locator('#rider-query').fill('脇本　雄太');await page.locator('#rider-search button').tap();
      await page.waitForFunction(()=>document.querySelector('#rider-name').textContent==='脇本雄太'&&/最新公開|このセッションで確認済み/.test(document.querySelector('#profile-status').textContent));
      assert.equal(await page.locator('#rider-meetings > .meeting').count(),profile.meetings.length);
      assert.doesNotMatch(await page.locator('#techniques').textContent(),/%/);
      assert.deepEqual(await page.locator('#techniques .count-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.stat)),M.COUNT_FIELDS.map(([key])=>key));
      const detail=await page.evaluate(()=>{
        const nodes=['rider-name','rider-meta','techniques'].map(id=>document.getElementById(id).getBoundingClientRect());
        return {columns:nodes.map(n=>({left:n.left,right:n.right,top:n.top,bottom:n.bottom})),
          stats:[...document.querySelectorAll('#techniques .count-item')].map(node=>({key:node.dataset.stat,raw:node.dataset.value,value:node.querySelector('.count-value').textContent,weight:getComputedStyle(node.querySelector('.count-value')).fontWeight,color:getComputedStyle(node.querySelector('.count-value')).color,size:parseFloat(getComputedStyle(node.querySelector('.count-value')).fontSize)}))};
      });
      assert.ok(detail.columns[0].right<=detail.columns[1].left&&detail.columns[1].right<=detail.columns[2].left,'Detail shares the name → county/period/age → counts order');
      assert.ok(Math.min(...detail.columns.map(c=>c.bottom))>Math.max(...detail.columns.map(c=>c.top)),'Detail counts stay beside the name');
      assert.ok(detail.stats[0].size<=detail.stats[1].size-1);
      for(const stat of detail.stats){const high=stat.raw!==''&&stat.key!=='total_starts'&&Number(stat.raw)>=(stat.key==='b'?10:5);assert.equal(stat.color==='rgb(214, 51, 132)',high,stat.key+'='+stat.value);}
      assert.ok(Number(detail.stats[1].weight)>=700);
      if(width===428){assert.deepEqual(detail.stats.filter(stat=>stat.color==='rgb(214, 51, 132)').map(stat=>stat.key),['s','b','makuri','sashi'],'Exact5/10 boundaries, four below the threshold and total starts ordinary');assert.ok(detail.stats[2].size>=16);}
      const headings=await page.locator('.meeting-label strong').allTextContents();assert.ok(headings.every(text=>/^(?:F[12]|G[123]|GP)/.test(text)),'Every detail heading puts grade before venue');
      assert.equal(await page.locator('#official-profile').getAttribute('href'),'https://keirin.jp/pc/racerprofile?snum=014396');
      const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,name:document.querySelector('#rider-name').getBoundingClientRect().bottom,history:document.querySelector('#rider-meetings').getBoundingClientRect().top,first:document.querySelector('.meeting').getBoundingClientRect().height}));
      assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
      assert.ok(geometry.history>geometry.name && geometry.history-geometry.name<180);
      assert.ok(geometry.first<90,'Meeting rows should not reserve a full rider-column height');
      const countBefore=await page.locator('.run').count();
      const expectedRuns=profile.meetings.reduce((count,meeting)=>count+meeting.days.length,0);
      assert.equal(countBefore,expectedRuns,'Larger digits retain every ride');
      if(width===390)await page.screenshot({path:'/tmp/rider-search-mobile.png'});
      if(width===428){
        const screen=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,article:document.querySelector('#rider').getBoundingClientRect().bottom,history:document.querySelector('#rider-meetings').getBoundingClientRect().bottom,placing:parseFloat(getComputedStyle(document.querySelector('.placing')).fontSize)}));
        assert.ok(screen.article<=850,'Ten meetings and actions fit iPhone14 Plus with browser space: '+JSON.stringify(screen));
        assert.ok(screen.scroll<=screen.height+1,'The whole individual view fits one portrait screen: '+JSON.stringify(screen));
        assert.ok(screen.placing>=16);console.log('IPHONE14PLUS_LAYOUT',JSON.stringify(screen));
        await page.screenshot({path:'/tmp/rider-search-iphone14plus.png'});
        zeroBack=true;await page.locator('#profile-refresh').tap();
        await page.waitForFunction(()=>document.querySelector('#techniques [data-stat=b]').dataset.value==='0');
        assert.equal(await page.locator('#techniques [data-stat=b] .count-value').textContent(),'');
        assert.equal(await page.locator('#techniques [data-stat=b] .count-label').evaluate(n=>getComputedStyle(n).visibility),'hidden');
      }
      const before=await page.locator('#rider-meetings').textContent();fail=true;
      await page.locator('#profile-refresh').tap();await page.waitForFunction(()=>document.querySelector('#profile-status').textContent.includes('失敗'));
      assert.equal(await page.locator('#rider-meetings').textContent(),before,'Source failure must retain the stock');
      if(width===390){
        await page.locator('#directory-back').tap();await page.locator('#show-top').tap();
        await page.clock.setSystemTime(new Date('2027-03-31T14:59:00Z'));
        await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
        assert.equal(await page.locator('#rider-list .birthday-done').count(),30,'All checked birthdays have passed by fiscal year end');
        await page.clock.fastForward(60000);
        assert.equal(await page.evaluate(()=>window.RiderSearch.jstDay()),'2027-04-01');
        assert.equal(await page.locator('#rider-list .birthday-done').count(),0,'The open page resets every mark at April1 JST');
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('RIDER SEARCH BROWSER PASS: top30, eight regions, last-click multi-sort and loop, complete two-page lists, role filters, Wakimoto search, enlarged counts, pink5/10 thresholds, blank bold B, self-name backgrounds, iPhone14Plus single-screen history, 320px without horizontal scrolling, safe refresh failure');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
