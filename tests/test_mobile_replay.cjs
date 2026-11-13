// Real mobile taps start, seek and pause the exact official replay without an overlay.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;try{({chromium}=require('playwright-core'));}catch{({chromium}=require('playwright'));}
const directory=path.resolve(process.argv[2]||'public'),screenshot=process.argv[3];
const prefix='/keirin-lineup2/';
async function main(){
 const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
 assert.ok(html.includes('data-history-layout="compact-20261113"'));
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
  if(process.env.CHROME_PATH)browser=await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
  else browser=await chromium.launch({...launch,channel:'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const writes=[],errors=[];
  await context.route('**/*',async route=>{
   if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes.push(route.request().method());return route.abort();}
   return route.continue();
  });
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:'+server.address().port;
  await page.goto(origin+prefix+'index.html',{waitUntil:'domcontentloaded'});
  let link=page.locator('a.meeting-order').first();
  if(!await link.count()){
   await page.waitForFunction(()=>document.body.dataset.previousMeetingsStatus==='ready');
   link=page.locator('a.previous-order').first();assert.ok(await link.count(),'A checked completed race is required');
   const control=link.locator('xpath=ancestor::tr[1]').locator('.previous-toggle').first();
   await control.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
   const p=await control.evaluate(node=>{const b=node.getBoundingClientRect(),v=visualViewport,s=v?.scale||1;return {x:(b.left+b.width/2-(v?.offsetLeft||0))*s,y:(b.top+b.height/2-(v?.offsetTop||0))*s};});
   await page.touchscreen.tap(p.x,p.y);
  }
  assert.ok(await link.count(),'A checked completed race is required');
  const original=await link.getAttribute('href'),before=page.url();
  await link.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  const point=await link.evaluate(node=>{const box=node.getBoundingClientRect(),view=visualViewport,scale=view?.scale||1;return {x:(box.left+box.width/2-(view?.offsetLeft||0))*scale,y:(box.top+box.height/2-(view?.offsetTop||0))*scale};});
  await page.touchscreen.tap(point.x,point.y);
  await page.waitForFunction(()=>document.querySelector('dialog.mobile-replay')?.dataset.replayState==='playing',null,{timeout:45000});
  await page.waitForFunction(()=>document.querySelector('dialog.mobile-replay video')?.currentTime>.15,null,{timeout:15000});
  const sourceResponse=await fetch(original,{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1'}});
  assert.equal(sourceResponse.status,200);const sourceHtml=await sourceResponse.text();
  const officialSource=/<source\b[^>]*\bsrc=["']([^"']+\.mp4)["']/i.exec(sourceHtml)?.[1];
  assert.ok(officialSource,'The original Rakuten player must identify its actual MP4');
  async function seekAt(fraction){
   const box=await page.locator('.mobile-replay-seek').boundingBox();assert.ok(box);
   await page.touchscreen.tap(box.x+box.width*fraction,box.y+box.height/2);
   await page.waitForFunction(()=>{const v=document.querySelector('dialog.mobile-replay video');return v&&!v.seeking&&v.readyState>=2;});
  }
  await seekAt(.6);
  await page.waitForFunction(()=>{const v=document.querySelector('dialog.mobile-replay video');return !v.paused&&v.currentTime>v.duration*.4;});
  const state=await page.locator('dialog.mobile-replay').evaluate(dialog=>{const v=dialog.querySelector('video'),r=dialog.getBoundingClientRect(),bar=dialog.querySelector('.mobile-replay-controls').getBoundingClientRect(),picture=v.getBoundingClientRect();return {src:v.currentSrc,paused:v.paused,time:v.currentTime,inline:v.playsInline,muted:v.muted,nativeControls:v.controls,barBelowPicture:bar.top>=picture.bottom,width:r.width,height:r.height,left:r.left,top:r.top,original:dialog.querySelector('a').href};});
  assert.equal(state.paused,false);assert.equal(state.inline,true);assert.equal(state.original,original);assert.equal(page.url(),before);
  assert.ok(state.src.startsWith('https://wm.st.keirin.jp/wm-keirin'));
  assert.equal(state.src,officialSource,'Playback must use the exact video opened by the original Rakuten player');
  assert.equal(state.nativeControls,false,'Inline native controls must not draw a central play overlay');
  assert.equal(state.barBelowPicture,true,'Seek/play controls must remain below the picture');
  assert.ok(Math.abs(state.width-390)<2&&Math.abs(state.height-844)<2&&Math.abs(state.left)<2&&Math.abs(state.top)<2,'The replay must fit the phone viewport despite page enlargement');
  if(screenshot)await page.screenshot({path:screenshot});
  await page.locator('.mobile-replay-toggle').tap();
  await page.waitForFunction(()=>document.querySelector('dialog.mobile-replay video').paused);
  await seekAt(.25);
  assert.ok(await page.locator('dialog.mobile-replay video').evaluate(v=>v.paused&&v.currentTime<v.duration*.4),'Seeking while paused must not resume unexpectedly');
  if(screenshot)await page.screenshot({path:screenshot.replace(/\.png$/,'-paused.png')});
  const pausedTime=await page.locator('dialog.mobile-replay video').evaluate(v=>v.currentTime);
  await page.locator('.mobile-replay-toggle').tap();
  await page.waitForFunction(time=>{const v=document.querySelector('dialog.mobile-replay video');return !v.paused&&v.currentTime>time+.15;},pausedTime);
  await page.locator('.mobile-replay-close').tap();assert.equal(await page.locator('dialog.mobile-replay').count(),0);
  assert.equal(page.url(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('MOBILE REPLAY PASS',JSON.stringify({...state,sameAsRakutenPlayer:true,seekWhilePlaying:true,seekWhilePaused:true,realTouch:true,autoplayPolicy:'document-user-activation-required',writeRequests:0}));
 }catch(error){
  if(page){
   console.log('MOBILE REPLAY DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>{const d=document.querySelector('dialog.mobile-replay'),v=d?.querySelector('video'),r=d?.getBoundingClientRect();return {state:d?.dataset.replayState,src:v?.currentSrc,ready:v?.readyState,error:v?.error?.message,paused:v?.paused,width:r?.width,height:r?.height,left:r?.left,top:r?.top,bodyZoom:getComputedStyle(document.body).zoom,dialogZoom:d&&getComputedStyle(d).zoom};})));
   if(screenshot)await page.screenshot({path:screenshot});
  }
  throw error;
 }finally{if(browser)await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
