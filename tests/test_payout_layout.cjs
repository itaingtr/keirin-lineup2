// Actual exported result screen with deterministic public-result fixtures; no writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const directory=path.resolve(process.argv[2]||'public'),prefix='https://itaingtr.github.io/keirin-lineup2/';
const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
const races=JSON.parse(/const races=(.*);\nconst body=/.exec(html)[1]);
const day=/data-all-results-date="(\d+)"/.exec(html)[1];
const payouts={exacta:[{combination:'9-2',yen:1650}],trifecta:[{combination:'9-2-3',yen:16000}],quinella:[{combination:'2=9',yen:800}],wide:[{combination:'2=3',yen:600},{combination:'2=9',yen:1200},{combination:'3=9',yen:560}]};
(async()=>{
 const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
 let browser;
 if(process.env.CHROME_PATH)browser=await chromium.launch({...launch,executablePath:process.env.CHROME_PATH});
 else{try{browser=await chromium.launch({...launch,channel:'chrome'});}catch{browser=await chromium.launch({...launch,executablePath:'/usr/bin/chromium'});}}
 try{
  for(const width of [393,414]){
   const context=await browser.newContext({viewport:{width,height:width===393?852:736},isMobile:true,hasTouch:true});
   const errors=[],writes=[];
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){writes.push(request.method());return route.abort();}
    if(url.pathname.endsWith('/comments-passphrase.js'))return route.fulfill({contentType:'text/javascript',body:'window.keirinBoard={ready:false};'});
    if(url.pathname==='/functions/v1/race-results'){
     const source=url.searchParams.get('source'),race=races.find(r=>r.source===source);
     if(!race)return route.fulfill({status:404,body:''});
     const match=/\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(new URL(source).pathname),date=new Date(match[2].slice(0,4)+'-'+match[2].slice(4,6)+'-'+match[2].slice(6)+'T00:00:00Z');
     date.setUTCDate(date.getUTCDate()+Number(match[3])-1);const actual=date.toISOString().slice(0,10);
     return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({schema_version:1,source_url:source,race_id:String(race.race).padStart(2,'0')+match[1]+actual.replaceAll('-',''),race_date:actual,race_number:race.race,observed_at:new Date().toISOString(),state:'results',rows:race.players.map((p,i)=>({no:p.no,name:p.name,rank:String(i+1),time:'11.5',reason:'検証用',margin:'',finish:'',shb:''})),payouts})});
    }
    if(request.url().startsWith(prefix)){
     const file=path.resolve(directory,url.pathname.slice('/keirin-lineup2/'.length)||'index.html');
     if(!file.startsWith(directory+path.sep))return route.abort();
     try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html; charset=utf-8',body:fs.readFileSync(file)});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(prefix+'results'+day+'.html');
   await page.waitForSelector('.race-result-payout-table');
   const table=page.locator('.race-result-payout-table').first();
   const geometry=await table.evaluate(table=>{
    const textBox=node=>{const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();return {left:r.left,right:r.right};};
    return {text:table.textContent,table:getComputedStyle(table).display,rows:[...table.rows].map(row=>({display:getComputedStyle(row).display,cells:[...row.cells].map(cell=>({text:cell.textContent,...textBox(cell),align:getComputedStyle(cell).textAlign,border:getComputedStyle(cell).borderWidth}))})),overflow:getComputedStyle(table.parentElement).overflowX};
   });
   assert.equal(geometry.table,'table');assert.equal(geometry.rows.length,2);
   assert.deepEqual(geometry.rows.map(row=>row.cells.map(cell=>cell.text)),[['2車単','9-2','1650円','2車複','2-9','800円','','','',''],['3連単','9-2-3','16000円','ワイド','2-3','600円','2-9','1200円','3-9','560円']]);
   for(const row of geometry.rows){assert.equal(row.display,'table-row');for(const cell of row.cells)assert.equal(cell.border,'0px');for(const index of [2,5,7,9]){const cell=row.cells[index];assert.equal(cell.align,'right');if(cell.text)assert.ok(cell.left-row.cells[index-1].right>=10,JSON.stringify(row));}}
   assert.ok(Math.abs(geometry.rows[0].cells[2].right-geometry.rows[1].cells[2].right)<.5);
   assert.ok(Math.abs(geometry.rows[0].cells[5].right-geometry.rows[1].cells[5].right)<.5);
   assert.doesNotMatch(geometry.text,/,/);assert.equal(geometry.overflow,'visible');
   await table.evaluate(node=>node.scrollIntoView({block:'center',inline:'start',behavior:'instant'}));
   await page.screenshot({path:'/tmp/lineup2-payouts-'+width+'.png'});
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   console.log('PAYOUT LAYOUT PASS',JSON.stringify({width,rows:geometry.rows.map(row=>row.cells.map(cell=>cell.text)),currencyAligned:true,writeRequests:0}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
