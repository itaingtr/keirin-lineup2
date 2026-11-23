// Verified exported cards; all result/odds responses below are display fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright-core');
const browserName=process.env.LAYOUT_BROWSER==='webkit'?'webkit':'chromium';
const directory=path.resolve(process.argv[2]||'public'),prefix='https://itaingtr.github.io/keirin-lineup2/';
const currentHTML=fs.readFileSync(path.join(directory,'index.html'),'utf8');
const archivedHTML=fs.readFileSync(path.join(directory,'line20261122.html'),'utf8');
const refinementsCSS=fs.readFileSync(path.join(directory,'history-refinements.css'),'utf8');
if(!currentHTML.includes('data-page-scale="fixed-canvas-20261123"'))throw new Error('Current page must use the fixed canvas');
if(archivedHTML.includes('data-page-scale="fixed-canvas-20261123"'))throw new Error('The archived November 22 page must retain its previous layout');
assert.match(refinementsCSS,/-webkit-text-size-adjust:\s*100%/);
assert.match(refinementsCSS,/text-size-adjust:\s*100%/);
const parse=html=>JSON.parse(/const races=(.*);\nconst body=/.exec(html)[1]);
const original=parse(currentHTML),sevenVenue=original.find(r=>r.players.length===7).venue;
const waitLayout=page=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
function altered(html,mode){
 if(mode==='seven')return html.replace('<input id="search"','<input value="'+sevenVenue+'" id="search"');
 if(!['contest','singles'].includes(mode))return html;
 const races=parse(html),race=races.find(r=>r.players.length===9),numbers=race.players.map(p=>p.no);
 race.groups=mode==='singles'?numbers.map(n=>[{type:'rider',riders:[n]}]):[
  [{type:'contest',riders:numbers.slice(0,2)},{type:'rider',riders:[numbers[2]]}],
  [{type:'rider',riders:[numbers[3]]},{type:'rider',riders:[numbers[4]]}],
  ...numbers.slice(5).map(n=>[{type:'rider',riders:[n]}])
 ];
 return html.replace(/const races=(.*);\nconst body=/,'const races='+JSON.stringify(races)+';\nconst body=');
}
async function geometry(page,width){
 await waitLayout(page);
 const data=await page.evaluate(()=>({zoom:parseFloat(getComputedStyle(document.body).zoom)||1,reference:parseFloat(document.body.style.getPropertyValue('--lineup-reference-width')),
  scale:parseFloat(document.body.style.getPropertyValue('--page-scale'))||1,scaleMode:document.body.dataset.mobileScaleMode,
  canvas:(()=>{const node=document.getElementById('page-canvas');if(!node)return null;const box=node.getBoundingClientRect(),style=getComputedStyle(node);return {position:style.position,left:box.left,width:box.width,height:box.height,bodyHeight:parseFloat(getComputedStyle(document.body).height),textSizeAdjust:style.getPropertyValue('-webkit-text-size-adjust')||style.getPropertyValue('text-size-adjust')||style.webkitTextSizeAdjust||style.textSizeAdjust};})(),
  scroll:[scrollX,scrollY],client:document.documentElement.clientWidth,
  rows:[...document.querySelectorAll('#rows > tr')].map(row=>{
   const lineup=row.querySelector('.lineup'),pane=lineup.getBoundingClientRect(),cars=[...lineup.querySelectorAll('.car')].map(n=>n.getBoundingClientRect());
   const groups=[...lineup.querySelectorAll(':scope > .line-group')];
   return {count:cars.length,left:Math.min(...cars.map(n=>n.left)),right:Math.max(...cars.map(n=>n.right)),center:pane.left+pane.width/2,
    pane:[pane.left,pane.right],dots:groups.slice(0,-1).flatMap((group,index)=>{
     const last=[...group.querySelectorAll('.car')].at(-1).getBoundingClientRect(),next=groups[index+1].querySelector('.car').getBoundingClientRect(),back=group.querySelector('.stat-b,.stat-b-zero').getBoundingClientRect();
     const x=(last.left+last.width/2+next.left+next.width/2)/2;
     return ['line-separator','line-back-separator'].map((type,i)=>{const dot=group.querySelector(':scope > .'+type),box=dot.getBoundingClientRect(),pseudo=getComputedStyle(dot,'::before');return {type,x:box.left+box.width/2,y:box.top+box.height/2,expectedX:x,expectedY:i?back.top+back.height/2:last.top+last.height/2,position:getComputedStyle(dot).position,ink:[pseudo.width,pseudo.height]};});
    })};
  })}));
 for(const row of data.rows){
  assert.ok(Math.abs((row.left+row.right)/2-row.center)<.7,JSON.stringify(row));
  if(width<=640){assert.ok(row.left>=-.3&&row.right<=width+.3,JSON.stringify({width,row}));assert.ok(Math.abs(row.center+data.scroll[0]-width/2)<.7,JSON.stringify({width,row}));}
  for(const dot of row.dots){assert.equal(dot.position,'absolute');assert.ok(dot.ink.every(value=>Math.abs(parseFloat(value)-3)<.05));assert.ok(Math.abs(dot.x-dot.expectedX)<.5&&Math.abs(dot.y-dot.expectedY)<.5,JSON.stringify({width,dot}));}
 }
 if(width<=640){assert.equal(data.reference,312);assert.equal(data.zoom,1);assert.equal(data.scaleMode,'fixed-canvas');assert.ok(Math.abs(data.scale-width/358)<.00001);assert.ok(data.canvas&&data.canvas.position==='absolute'&&Math.abs(data.canvas.left)<.1&&Math.abs(data.canvas.width-width)<1,JSON.stringify(data.canvas));assert.ok(Math.abs(data.canvas.bodyHeight-data.canvas.height)<1,JSON.stringify(data.canvas));if(data.canvas.textSizeAdjust)assert.match(data.canvas.textSizeAdjust,/100%/);}
 return data;
}
(async()=>{
 const launch=browserName==='webkit'?{headless:true}:{headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};let browser;
 if(browserName==='webkit')browser=await webkit.launch(launch);
 else if(process.env.CHROME_PATH)browser=await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
 else{try{browser=await chromium.launch({...launch,channel:'chrome'});}catch{browser=await chromium.launch({...launch,executablePath:'/usr/bin/chromium'});}}
 try{
  const cases=browserName==='webkit'?[{width:393,mode:'mixed'},{width:414,mode:'mixed'},{width:414,mode:'ios16'},{width:320,mode:'mixed'}]:[...([280,320,360,375,390,393,414,428,640,900].map(width=>({width,mode:'mixed'}))),...([320,393,414].map(width=>({width,mode:'seven'}))),...(['contest','singles'].flatMap(mode=>[320,414].map(width=>({width,mode})))),{width:414,mode:'ios16'}];
  for(const {width,mode} of cases){
   const html=altered(currentHTML,mode),races=parse(html),bySource=new Map(races.map(r=>[r.source,r]));
   const feed={results:races.map(r=>({ok:true,snapshot:{provider:'kdreams',parser_version:2,race_key:new URL(r.source).pathname,bet_type:'exacta',status:'snapshot',observed_at:new Date().toISOString(),odds:r.players.flatMap(a=>r.players.filter(b=>b.no!==a.no).map(b=>({first:a.no,second:b.no,value:a.no*10+b.no+.125})))}}))};
   const contextOptions={viewport:{width,height:width===414?736:852},isMobile:width<900,hasTouch:width<900};
   if(mode==='ios16')contextOptions.userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
   const context=await browser.newContext(contextOptions);const errors=[],writes=[];
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){writes.push(request.method());return route.abort();}
    if(url.pathname.endsWith('/comments-passphrase.js'))return route.fulfill({contentType:'text/javascript',body:'window.keirinBoard={ready:false};'});
    if(url.hostname==='raw.githubusercontent.com')return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(feed)});
    if(url.pathname==='/functions/v1/race-results'){
     const source=url.searchParams.get('source'),r=bySource.get(source),m=/\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(new URL(source).pathname),date=new Date(m[2].slice(0,4)+'-'+m[2].slice(4,6)+'-'+m[2].slice(6)+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+Number(m[3])-1);const day=date.toISOString().slice(0,10);
     return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({schema_version:1,source_url:source,race_id:String(Number(m[4])).padStart(2,'0')+m[1]+day.replaceAll('-',''),race_date:day,race_number:Number(m[4]),observed_at:new Date().toISOString(),state:r?'results':'pending',rows:r?r.players.map((p,i)=>({no:p.no,name:p.name,rank:String(i+1),time:'11.5',reason:'直線で伸び',finish:'逃',shb:'B',margin:'1/2車輪'})):[],payouts:{exacta:[],trifecta:[],quinella:[],wide:[]}})});
    }
    if(request.url().startsWith(prefix)){
     const relative=url.pathname.slice('/keirin-lineup2/'.length)||'index.html',file=path.resolve(directory,relative);
     if(!file.startsWith(directory+path.sep))return route.abort();
     if(relative==='index.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
     try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html; charset=utf-8',body:fs.readFileSync(file)});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(prefix);await page.waitForFunction(()=>document.body.dataset.lineupFitStatus==='ready');
   const initial=await geometry(page,width);
   if(mode==='seven')assert.ok(initial.rows.every(row=>row.count===7));
   if(width<=640)assert.ok(Math.abs(initial.reference*initial.scale-(initial.rows[0].pane[1]-initial.rows[0].pane[0]))<1,JSON.stringify({width,scale:initial.scale,reference:initial.reference,pane:initial.rows[0].pane}));
   // Source summaries, profile details and both histories may change height.
   await page.waitForSelector('.rider-odds');await geometry(page,width);
   for(const selector of ['.period-toggle','.ten-toggle','.previous-toggle']){
    const control=page.locator('#rows > tr').first().locator(selector).first();
    if(await control.count()){await control.evaluate(node=>node.click());await page.waitForTimeout(25);await geometry(page,width);}
   }
   const band=page.locator('#rows > tr').first().locator('.rider-odds').first();
   await band.evaluate(node=>node.click());await page.waitForSelector('.odds-cell:not([hidden]) .exacta-matrix');await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);await geometry(page,width);
   await band.evaluate(node=>node.click());await page.waitForFunction(()=>!document.documentElement.dataset.oddsLayoutChange);await geometry(page,width);
   await page.locator('.race-result-toggle').first().evaluate(node=>node.click());await page.waitForSelector('.race-result-table');
   const controlAlignment=await page.locator('#rows > tr').first().evaluate(row=>({
    result:row.querySelector('.race-result-toggle').getBoundingClientRect().left,
    previous:row.querySelector('.previous-toggle').getBoundingClientRect().left}));
   assert.ok(Math.abs(controlAlignment.result-controlAlignment.previous)<.5,JSON.stringify(controlAlignment));

   const packed=await page.locator('.race-result-table').first().evaluate(table=>{
    const row=table.tBodies[0].rows[0],box=key=>row.querySelector('.race-result-'+key).getBoundingClientRect(),range=key=>{const r=document.createRange();r.selectNodeContents(row.querySelector('.race-result-'+key));return r.getBoundingClientRect();};
    return {width:table.getBoundingClientRect().width,pane:table.closest('.lineup-cell').getBoundingClientRect().width,reason:box('reason').width,scale:parseFloat(document.body.style.getPropertyValue('--page-scale'))||1,font:parseFloat(getComputedStyle(table).fontSize),padding:['time','reason','finish','shb'].map(key=>parseFloat(getComputedStyle(row.querySelector('.race-result-'+key)).paddingRight)),time:box('time').width,margin:box('margin').width,gaps:[box('reason').left-range('time').right,box('finish').left-range('reason').right],fields:['reason','finish','shb','margin'].map(key=>[key,box(key).left,box(key).right])};
   });
   assert.ok(packed.width<=packed.pane+.5&&packed.reason<=5.5*packed.font*packed.scale+.5,JSON.stringify(packed));
   assert.ok(Math.abs(packed.time-packed.margin)<.5,JSON.stringify(packed));
   assert.ok(packed.padding.every(value=>Math.abs(value-packed.padding[0])<.05),JSON.stringify(packed));
   for(let i=1;i<packed.fields.length;i++)assert.ok(Math.abs(packed.fields[i][1]-packed.fields[i-1][2])<.5,JSON.stringify(packed));
   if(mode==='mixed'&&[393,414].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/lineup2-centered-'+width+'.png'});}
   await page.evaluate(()=>{const search=document.querySelector('#search');search.value='';search.dispatchEvent(new Event('input'));window.scrollTo(0,0);});
   await geometry(page,width);assert.equal(await page.evaluate(()=>parseFloat(document.body.style.getPropertyValue('--page-scale'))||1),initial.scale,'Search must keep the fixed canvas scale');
   if(mode==='mixed'&&width===414){
    await page.setViewportSize({width:393,height:852});await page.waitForTimeout(40);await geometry(page,393);
    await page.setViewportSize({width:414,height:736});await page.waitForTimeout(40);await geometry(page,414);
   }
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   console.log('LINEUP FIT PASS',JSON.stringify({browser:browserName,width,mode,scale:initial.scale,counts:[...new Set(initial.rows.map(r=>r.count))],dots:initial.rows.reduce((n,r)=>n+r.dots.length,0),result:packed,writeRequests:0}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
