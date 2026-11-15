// Read public count/profile display fields only. Never log HTML, cookies,
// navigation handlers, opaque parameters or user/authentication data.
const {parseHTML}=require('linkedom');
(async()=>{
  const {readProfileHtml}=await import('../supabase/functions/rider-profile/source.mjs');
  const {profileView}=await import('../supabase/functions/rider-profile/parser.mjs');
  const html=await readProfileHtml('014396'),{document}=parseHTML(html);
  const view=profileView(document);
  console.log('OFFICIAL_TABLES',JSON.stringify(view.tables.filter(rows=>rows.some(row=>row.some(value=>['生年月日','総出走回数','逃げ','マーク'].includes(value))))));
  const numeric=[...html.matchAll(/\b([A-Za-z_]*(?:nige|kimari|sashi|makuri|raceCount|backCount|startCount)[A-Za-z_]*)["']?\s*[:=]\s*(\d+(?:\.\d+)?)/gi)].map(match=>[match[1],match[2]]);
  console.log('OFFICIAL_LITERAL_COUNTS',JSON.stringify(numeric));
  for(const url of ['https://www.yen-joy.net/racer/data/014396/0','https://keirin.kdreams.jp/kochi/racedetail/7420260717010012/']){
    const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'text/html'}});
    console.log('SOURCE_STATUS',url,response.status);if(!response.ok)continue;
    const {document}=parseHTML(await response.text());
    const tables=[...document.querySelectorAll('table')].map(table=>[...table.querySelectorAll('tr')].filter(row=>row.closest('table')===table).map(row=>[...row.children].filter(n=>['TD','TH'].includes(n.tagName)).map(cell=>cell.textContent.replace(/\s+/g,''))));
    console.log('PUBLIC_COUNT_TABLES',url,JSON.stringify(tables.filter(rows=>rows.some(row=>row.some(text=>/^(?:逃|捲|差|マ|逃げ|捲り|差し|マーク|総出走回数|出走数|B|S)$/.test(text))))).slice(0,16000));
    console.log('PUBLIC_SCRIPT_PATHS',url,JSON.stringify([...document.querySelectorAll('script[src]')].map(n=>new URL(n.getAttribute('src'),url)).filter(u=>u.origin===new URL(url).origin).map(u=>u.pathname)));
    const linked=[...document.querySelectorAll('a[href]')].map(n=>new URL(n.getAttribute('href'),url)).filter(u=>u.origin===new URL(url).origin&&/(?:athlete|racer)/.test(u.pathname)).map(u=>u.origin+u.pathname);
    console.log('PUBLIC_RIDER_LINKS',url,JSON.stringify([...new Set(linked)]).slice(0,3000));
    const datasets=[];
    for(const node of document.querySelectorAll('*'))for(const attr of node.attributes)if(/^data-/.test(attr.name)&&/(?:kimari|count|nige|sashi|makuri|chart|graph)/i.test(attr.name)){
      if(/^[\d.,\s\[\]{}:%-]+$/.test(attr.value))datasets.push([attr.name,attr.value]);
    }
    console.log('PUBLIC_NUMERIC_DATASETS',url,JSON.stringify(datasets).slice(0,8000));
  }
})().catch(error=>{console.error('PUBLIC_COUNT_PROBE_FAILED',error.message);process.exitCode=1;});
