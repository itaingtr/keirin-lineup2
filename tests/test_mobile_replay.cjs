// One mobile tap opens the original replay in native full screen; the browser seeks.
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
  await page.waitForFunction(()=>{
    const video=document.querySelector('video.mobile-replay-video');
    return video && document.fullscreenElement===video && !video.paused && video.currentTime>.15;
  },null,{timeout:45000});
  const sourceResponse=await fetch(original,{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1'}});
  assert.equal(sourceResponse.status,200);const sourceHtml=await sourceResponse.text();
  const officialSource=/<source\b[^>]*\bsrc=["']([^"']+\.mp4)["']/i.exec(sourceHtml)?.[1];
  assert.ok(officialSource,'The original Rakuten player must identify its actual MP4');

  const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');
  async function nativeTimeline(){
    const {root}=await cdp.send('DOM.getDocument',{depth:1,pierce:true});
    const selected=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'video.mobile-replay-video'});
    const {node}=await cdp.send('DOM.describeNode',{nodeId:selected.nodeId,depth:-1,pierce:true});
    const nodes=[];function walk(n){nodes.push(n);for(const child of [...(n.children||[]),...(n.shadowRoots||[])])walk(child);}walk(node);
    const candidates=[];
    for(const input of nodes.filter(n=>n.nodeName==='INPUT'&&(n.attributes||[]).includes('range'))){
      try{
        const {model}=await cdp.send('DOM.getBoxModel',{backendNodeId:input.backendNodeId});
        const q=model.content,left=Math.min(q[0],q[2],q[4],q[6]),right=Math.max(q[0],q[2],q[4],q[6]),top=Math.min(q[1],q[3],q[5],q[7]),bottom=Math.max(q[1],q[3],q[5],q[7]);
        if(right-left>100&&bottom>top)candidates.push({left,right,top,bottom,attributes:input.attributes});
      }catch{}
    }
    candidates.sort((a,b)=>(b.right-b.left)-(a.right-a.left));
    if(!candidates.length)console.log('NATIVE MEDIA INPUTS',JSON.stringify(nodes.filter(n=>n.nodeName==='INPUT').map(n=>n.attributes)));
    assert.ok(candidates.length,'The browser native full-screen seek bar must be available');
    return candidates[0];
  }
  const timeline=await nativeTimeline();
  const seekPoint={x:timeline.left+8+(timeline.right-timeline.left-16)*.6,y:(timeline.top+timeline.bottom)/2};
  await page.touchscreen.tap(seekPoint.x,seekPoint.y);
  // If native controls had faded, the first tap reveals them.
  const moved=await page.waitForFunction(()=>{const v=document.querySelector('video.mobile-replay-video');return v&&!v.seeking&&v.currentTime>v.duration*.4&&!v.paused;},null,{timeout:2000}).then(()=>true,()=>false);
  if(!moved){await page.touchscreen.tap(seekPoint.x,seekPoint.y);await page.waitForFunction(()=>{const v=document.querySelector('video.mobile-replay-video');return !v.seeking&&v.currentTime>v.duration*.4&&!v.paused;});}
  const state=await page.locator('video.mobile-replay-video').evaluate(video=>{
    const r=video.getBoundingClientRect();return {src:video.currentSrc,paused:video.paused,time:video.currentTime,inline:video.playsInline,muted:video.muted,nativeControls:video.controls,fullscreen:document.fullscreenElement===video,
      customSeekBars:document.querySelectorAll('.mobile-replay-seek').length,width:r.width,height:r.height,left:r.left,top:r.top};
  });
  assert.equal(state.src,officialSource,'The native player must use the original Rakuten video');
  assert.equal(state.paused,false);assert.equal(state.nativeControls,true);assert.equal(state.inline,false);assert.equal(state.fullscreen,true);assert.equal(state.customSeekBars,0);
  assert.equal(page.url(),before);
  assert.ok(Math.abs(state.width-390)<2&&Math.abs(state.height-844)<2,'The native video must cover the phone viewport');
  if(screenshot)await page.screenshot({path:screenshot});
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.querySelector('dialog.mobile-replay'));
  async function tapVisible(locator){
    await locator.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
    const p=await locator.evaluate(node=>{const b=node.getBoundingClientRect(),v=visualViewport,s=v?.scale||1;return {x:(b.left+b.width/2-(v?.offsetLeft||0))*s,y:(b.top+b.height/2-(v?.offsetTop||0))*s};});
    await page.touchscreen.tap(p.x,p.y);
  }
  await tapVisible(page.locator('.replay-mode-button'));
  assert.equal(await page.locator('.replay-mode-button').textContent(),'動画：小窓');
  await tapVisible(link);
  await page.waitForFunction(()=>{const v=document.querySelector('video.mobile-replay-video');return v&&!v.paused&&v.currentTime>.15;},null,{timeout:45000});
  const popup=await page.locator('.mobile-replay-small').evaluate(dialog=>{
    const r=dialog.getBoundingClientRect(),v=dialog.querySelector('video'),below=document.elementFromPoint(innerWidth/2,innerHeight*.8);
    return {top:r.top,left:r.left,width:r.width,height:r.height,modal:dialog.matches(':modal'),belowAvailable:!!below&&!dialog.contains(below),src:v.currentSrc,inline:v.playsInline,controls:v.controls,fullscreen:!!document.fullscreenElement};
  });
  assert.equal(popup.src,officialSource);assert.equal(popup.inline,true);assert.equal(popup.controls,true);
  assert.equal(popup.fullscreen,false);assert.equal(popup.modal,false);assert.equal(popup.belowAvailable,true);
  assert.ok(Math.abs(popup.top)<2&&Math.abs(popup.left)<2&&Math.abs(popup.width-390)<2&&Math.abs(popup.height-422)<2,'The non-modal popup must occupy only the upper half');
  const smallTimeline=await nativeTimeline();
  const smallSeek={x:smallTimeline.left+8+(smallTimeline.right-smallTimeline.left-16)*.6,y:(smallTimeline.top+smallTimeline.bottom)/2};
  await page.touchscreen.tap(smallSeek.x,smallSeek.y);
  const smallMoved=await page.waitForFunction(()=>{const v=document.querySelector('video.mobile-replay-video');return v&&!v.seeking&&v.currentTime>v.duration*.4&&!v.paused;},null,{timeout:2000}).then(()=>true,()=>false);
  if(!smallMoved){await page.touchscreen.tap(smallSeek.x,smallSeek.y);await page.waitForFunction(()=>{const v=document.querySelector('video.mobile-replay-video');return v&&!v.seeking&&v.currentTime>v.duration*.4&&!v.paused;});}
  if(screenshot)await page.screenshot({path:screenshot.replace(/\.png$/,'-small.png')});
  await page.locator('.mobile-replay-close').tap();
  await page.waitForFunction(()=>!document.querySelector('dialog.mobile-replay'));
  await tapVisible(page.locator('.replay-mode-button'));
  assert.equal(page.url(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('MOBILE REPLAY PASS',JSON.stringify({...state,sameAsRakutenPlayer:true,firstTapFullscreen:true,nativeSeekWhilePlaying:true,upperHalfPopup:popup,popupNativeTouchSeek:true,returnToCard:true,realTouch:true,autoplayPolicy:'document-user-activation-required',writeRequests:0}));
 }catch(error){
  if(page){
   console.log('MOBILE REPLAY DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>{const d=document.querySelector('dialog.mobile-replay'),v=d?.querySelector('video'),r=d?.getBoundingClientRect();return {state:d?.dataset.replayState,src:v?.currentSrc,ready:v?.readyState,error:v?.error?.message,paused:v?.paused,width:r?.width,height:r?.height,left:r?.left,top:r?.top,bodyZoom:getComputedStyle(document.body).zoom,dialogZoom:d&&getComputedStyle(d).zoom};})));
   if(screenshot)await page.screenshot({path:screenshot});
  }
  throw error;
 }finally{if(browser)await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
