// A real touch starts a completed official replay with normal autoplay policy.
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
  const link=page.locator('a.meeting-order').first();assert.ok(await link.count(),'A checked completed race is required');
  const original=await link.getAttribute('href'),before=page.url();
  await link.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  const point=await link.evaluate(node=>{const box=node.getBoundingClientRect(),view=visualViewport,scale=view?.scale||1;return {x:(box.left+box.width/2-(view?.offsetLeft||0))*scale,y:(box.top+box.height/2-(view?.offsetTop||0))*scale};});
  await page.touchscreen.tap(point.x,point.y);
  await page.waitForFunction(()=>document.querySelector('dialog.mobile-replay')?.dataset.replayState==='playing',null,{timeout:45000});
  await page.waitForFunction(()=>document.querySelector('dialog.mobile-replay video')?.currentTime>.15,null,{timeout:15000});
  const state=await page.locator('dialog.mobile-replay').evaluate(dialog=>{const v=dialog.querySelector('video'),r=dialog.getBoundingClientRect();return {src:v.currentSrc,paused:v.paused,time:v.currentTime,inline:v.playsInline,muted:v.muted,width:r.width,height:r.height,left:r.left,top:r.top,original:dialog.querySelector('a').href};});
  assert.equal(state.paused,false);assert.equal(state.inline,true);assert.equal(state.original,original);assert.equal(page.url(),before);
  assert.ok(state.src.startsWith('https://wm.st.keirin.jp/wm-keirin'));
  assert.ok(Math.abs(state.width-390)<2&&Math.abs(state.height-844)<2&&Math.abs(state.left)<2&&Math.abs(state.top)<2,'The replay must fit the phone viewport despite page enlargement');
  if(screenshot)await page.screenshot({path:screenshot});
  await page.locator('.mobile-replay-close').tap();assert.equal(await page.locator('dialog.mobile-replay').count(),0);
  assert.equal(page.url(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('MOBILE REPLAY PASS',JSON.stringify({...state,realTouch:true,autoplayPolicy:'document-user-activation-required',writeRequests:0}));
 }catch(error){
  if(page){
   console.log('MOBILE REPLAY DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>{const d=document.querySelector('dialog.mobile-replay'),v=d?.querySelector('video'),r=d?.getBoundingClientRect();return {state:d?.dataset.replayState,src:v?.currentSrc,ready:v?.readyState,error:v?.error?.message,paused:v?.paused,width:r?.width,height:r?.height,left:r?.left,top:r?.top,bodyZoom:getComputedStyle(document.body).zoom,dialogZoom:d&&getComputedStyle(d).zoom};})));
   if(screenshot)await page.screenshot({path:screenshot});
  }
  throw error;
 }finally{if(browser)await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
