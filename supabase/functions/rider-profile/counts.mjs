// Exact public card counts. Percentages are never used to calculate counts.
import {compact} from './parser.mjs';
export function allowedCardUrl(raw){
  const url=new URL(raw);
  if(url.origin!=='https://keirin.kdreams.jp'||url.username||url.password||!/^\/[a-z]+\/racedetail\/\d{16}\/$/.test(url.pathname)||url.search||url.hash)throw new Error('Invalid count source');
  return url.href;
}
export async function readCardHtml(raw){
  const url=allowedCardUrl(raw),response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{Accept:'text/html'}});
  if(!response.ok)throw new Error('Count source unavailable');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>6*1024*1024)throw new Error('Count source too large');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
export function countRows(document,sourceUrl,observedAt){
  allowedCardUrl(sourceUrl);
  const canonical=document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if(canonical && new URL(canonical).pathname!==new URL(sourceUrl).pathname)throw new Error('Count source race differs');
  const title=compact(document.querySelector('title')?.textContent),calendar=/(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(title),race=/(\d{1,2})R/.exec(title);
  if(!calendar||!race||Number(race[1])!==Number(new URL(sourceUrl).pathname.slice(-3,-1)))throw new Error('Count source title differs');
  const cardDate=calendar[1]+'-'+calendar[2].padStart(2,'0')+'-'+calendar[3].padStart(2,'0');
  if(new Date(cardDate).toISOString().slice(0,10)!==cardDate)throw new Error('Count source date differs');
  const tables=[...document.querySelectorAll('table.racecard_table')].filter(table=>{
    const text=compact(table.textContent);return !table.classList.contains('none')&&text.includes('競走得点')&&text.includes('1着')&&text.includes('着外')&&text.includes('S')&&text.includes('B');
  });
  if(tables.length!==1)throw new Error('Ambiguous count table');
  const expected=['競走得点','S','B','逃','捲','差','マ','1着','2着','3着','着外','勝率','2連対率','3連対率'];
  if(![...tables[0].querySelectorAll('tr')].some(row=>[...row.children].map(cell=>compact(cell.textContent)).join('|')===expected.join('|')))throw new Error('Count column meanings differ');
  const rows=[];
  for(const row of tables[0].querySelectorAll('tr')){
    if(row.closest('table')!==tables[0])continue;
    const cells=[...row.children].filter(n=>['TD','TH'].includes(n.tagName)),index=cells.findIndex(n=>n.classList.contains('rider'));
    if(index<0)continue;
    const prefectures='北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄';
    const text=cells.map(n=>compact(n.textContent)),identity=new RegExp('^(.+?)('+prefectures+')[都府県]?/(\\d{1,3})/(\\d{1,3})$').exec(text[index].replace(/\((?:欠車|欠場|出走取消|取消)\)$/,''));
    const number=compact(row.querySelector('td.num')?.textContent);
    if(!identity||!/^\d$/.test(number)||text.length<index+15)continue;
    const numeric=text.slice(index+5,index+15);
    if(!numeric.every(value=>/^\d+$/.test(value)))throw new Error('Count columns differ');
    const values=Object.fromEntries(['s','b','nige','makuri','sashi','mark'].map((key,i)=>[key,Number(numeric[i])]));
    values.total_starts=numeric.slice(6,10).reduce((sum,value)=>sum+Number(value),0);
    rows.push({name:identity[1],period:Number(identity[4]),car_number:Number(number),prefecture:identity[2],age:Number(identity[3]),
      counts:{unit:'count',scope:'直近4か月',provider:'kdreams',source_url:sourceUrl,card_date:cardDate,observed_at:observedAt,values}});
  }
  if(!rows.length||new Set(rows.map(row=>row.car_number)).size!==rows.length)throw new Error('Count riders differ');
  return rows;
}
export function matchCounts(rows,person,carNumber){
  const found=rows.filter(row=>compact(row.name)===compact(person.name)&&row.period===Number(person.period)&&(!carNumber||row.car_number===Number(carNumber)));
  if(found.length!==1)throw new Error('Count person differs');return found[0].counts;
}
