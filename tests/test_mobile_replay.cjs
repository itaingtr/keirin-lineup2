// Follow real MP4 anchors into the browser media document; no site player.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;try{({chromium}=require('playwright-core'));}catch{({chromium}=require('playwright'));}
const directory=path.resolve(process.argv[2]||'public'),screenshot=process.argv[3];
const prefix='/keirin-lineup2/';
async function main(){
 const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
 assert.ok(html.includes('data-replay-links="mp4"'));
 assert.doesNotMatch(html,/mobile-replay|replay-mode-button|requestFullscreen|webkitEnterFullscreen|function openVideo/);
 const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  if(!p.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(directory,p.slice(prefix.length)||'index.html');
  if(!file.startsWith(directory+path.sep)){res.writeHead(403).end();return;}
  try{res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/json; charset=utf-8'});res.end(fs.readFileSync(file));}
  catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page;
 try{
  const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=document-user-activation-required']};
  browser=await chromium.launch({...launch,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const writes=[],errors=[],cycles=[];
  await context.route('**/*',async route=>{
   if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes.push(route.request().method());return route.abort();}
   return route.continue();
  });
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:'+server.address().port,before=origin+prefix+'index.html';
  await page.goto(before,{waitUntil:'domcontentloaded'});
  async function tap(locator){
   await locator.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
   const p=await locator.evaluate(node=>{const b=node.getBoundingClientRect(),v=visualViewport,s=v?.scale||1;return {x:(b.left+b.width/2-(v?.offsetLeft||0))*s,y:(b.top+b.height/2-(v?.offsetTop||0))*s};});
   await page.touchscreen.tap(p.x,p.y);
  }
  async function completedLink(kind){
   if(kind==='current'&&await page.locator('a.meeting-order').count())return page.locator('a.meeting-order').first();
   const ten=kind==='ten';
   await page.waitForFunction(ten?()=>document.body.dataset.tenMeetingsStatus==='ready':()=>document.body.dataset.previousMeetingsStatus==='ready');
   await tap(page.locator(ten?'.ten-toggle':'.previous-toggle').first());
   const link=page.locator(ten?'a.ten-rank':'a.previous-order').first();
   await link.waitFor({state:'visible'});return link;
  }
  for(const kind of ['current','previous','ten']){
   await page.waitForSelector('#rows .video-link');
   assert.equal(await page.locator('video,iframe,dialog,.replay-mode-button').count(),0);
   assert.equal(await page.evaluate(()=>typeof window.openVideo),'undefined');
   const link=await completedLink(kind),destination=await link.getAttribute('href');
   assert.equal(await link.getAttribute('target'),'_self');assert.equal(await link.getAttribute('onclick'),null);
   const parts=/^https:\/\/wm\.st\.keirin\.jp\/wm-keirin(\d{2})\/(\d{8})-\1-(\d{2})-(\d{2})-01-00\.mp4$/.exec(destination);
   assert.ok(parts,'Every video anchor must already be the literal official MP4');
   const digest='https://my.keirin.kdreams.jp/stadium/digest/?'+new URLSearchParams({kyogijoCd:parts[1],kaisaiDate:parts[2],gradeCd:String(+parts[3]),raceNo:String(+parts[4])});
   const response=await fetch(digest);assert.equal(response.status,200);
   const official=/<source\b[^>]*\bsrc=["']([^"']+\.mp4)["']/i.exec(await response.text())?.[1];
   assert.equal(destination,official,'The anchor must match the original Rakuten video source');
   await tap(link);
   await page.waitForURL(destination,{timeout:45000,waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.15;},null,{timeout:45000});
   assert.equal(context.pages().length,1,'Replay must not create another tab or popup');
   const state=await page.locator('video').evaluate(v=>({src:v.currentSrc,paused:v.paused,time:v.currentTime,controls:v.controls,autoplay:v.autoplay,sitePlayers:document.querySelectorAll('.mobile-replay').length}));
   assert.equal(state.src,official);assert.equal(state.controls,true);assert.equal(state.paused,false);assert.equal(state.sitePlayers,0);
   if(kind==='current'){
    const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');
    const {root}=await cdp.send('DOM.getDocument',{depth:1,pierce:true});
    const selected=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'video'});
    const {node}=await cdp.send('DOM.describeNode',{nodeId:selected.nodeId,depth:-1,pierce:true});
    const nodes=[];function walk(n){nodes.push(n);for(const c of [...(n.children||[]),...(n.shadowRoots||[])])walk(c);}walk(node);
    const ranges=[];
    for(const input of nodes.filter(n=>n.nodeName==='INPUT'&&(n.attributes||[]).includes('range'))){
     try{const {model}=await cdp.send('DOM.getBoxModel',{backendNodeId:input.backendNodeId}),q=model.content;
      const left=Math.min(q[0],q[2],q[4],q[6]),right=Math.max(q[0],q[2],q[4],q[6]),top=Math.min(q[1],q[3],q[5],q[7]),bottom=Math.max(q[1],q[3],q[5],q[7]);
      if(right-left>100&&bottom>top)ranges.push({left,right,top,bottom});
     }catch{}
    }
    ranges.sort((a,b)=>(b.right-b.left)-(a.right-a.left));assert.ok(ranges.length,'Native media-document timeline must be available');
    const r=ranges[0],point={x:r.left+8+(r.right-r.left-16)*.6,y:(r.top+r.bottom)/2};
    await page.touchscreen.tap(point.x,point.y);
    const moved=await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&v.currentTime>v.duration*.4&&!v.paused;},null,{timeout:2000}).then(()=>true,()=>false);
    if(!moved){await page.touchscreen.tap(point.x,point.y);await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&v.currentTime>v.duration*.4&&!v.paused;});}
    if(screenshot)await page.screenshot({path:screenshot});await cdp.detach();
   }
   cycles.push({kind,...state});
   await page.goBack({waitUntil:'domcontentloaded'});await page.waitForURL(before);
   await page.waitForSelector('#rows .video-link');
   assert.equal(await page.locator('video,iframe,dialog,.replay-mode-button').count(),0,'Returning must leave no site-owned player');
   assert.equal(context.pages().length,1);
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('DIRECT MP4 REPLAY PASS',JSON.stringify({cycles,realTouch:true,nativeAutoplay:true,nativeTouchSeek:true,extraTabs:0,sitePlayersAfterReturn:0,autoplayPolicy:'document-user-activation-required',writeRequests:0}));
 }catch(error){
  if(page){console.log('DIRECT REPLAY DIAGNOSTIC',JSON.stringify({url:page.url(),state:await page.locator('video').evaluateAll(vs=>vs.map(v=>({src:v.currentSrc,ready:v.readyState,paused:v.paused,error:v.error?.message})))}));if(screenshot)await page.screenshot({path:screenshot});}
  throw error;
 }finally{if(browser)await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
