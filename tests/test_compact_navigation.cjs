const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(path.join(__dirname,'../site/compact-navigation.js'),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
(async()=>{
 const dom=new JSDOM('<body data-card-header="compact-20261115"><main><nav id="venue-nav"><a href="/keirin-lineup2/line20261115.html#race-28-1">立川</a><a href="/keirin-lineup2/results20261115.html">全結果</a></nav><p class="condition-note">車番を押すと調子が<strong>1→5</strong><span class="condition-message"></span></p><div class="table-wrap"></div><section class="compact-page-footer"><nav id="venue-nav-bottom"></nav></section></main></body>',{runScripts:'outside-only',url:'https://itaingtr.github.io/keirin-lineup2/line20261115.html'});
 dom.window.eval(script);const doc=dom.window.document;
 assert.deepEqual(Array.from(doc.querySelectorAll('#venue-nav-bottom a'),n=>[n.textContent,n.href]),Array.from(doc.querySelectorAll('#venue-nav a'),n=>[n.textContent,n.href]));
 const status=doc.querySelector('.condition-message');assert.equal(doc.querySelector('.condition-note').textContent,'');
 status.textContent='保存できなかったにゃ';assert.equal(doc.querySelector('.condition-message'),status);assert.match(doc.querySelector('.condition-note').textContent,/保存できなかった/);
 doc.getElementById('venue-nav').innerHTML='<a href="/keirin-lineup2/line20261115.html#race-34-5">川崎</a><a href="/keirin-lineup2/results20261115.html">全結果</a>';
 await pause();assert.deepEqual(Array.from(doc.querySelectorAll('#venue-nav-bottom a'),n=>n.textContent),['川崎','全結果']);
 const later=doc.createElement('p');later.className='condition-note';later.innerHTML='後から追加された案内<span class="condition-message"></span>';doc.querySelector('main').insertBefore(later,doc.querySelector('.table-wrap'));
 await pause();assert.equal(later.textContent,'');assert.ok(later.querySelector('.condition-message'));
 dom.window.close();console.log('PASS compact footer mirrors venue/date links after redraw; help text is removed while status feedback remains live');
})().catch(e=>{console.error(e);process.exit(1);});
