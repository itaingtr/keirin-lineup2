const assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
(async()=>{
  const {allowedCardUrl,countRows,matchCounts}=await import('../supabase/functions/rider-profile/counts.mjs');
  const source='https://keirin.kdreams.jp/kumamoto/racedetail/8720261022010012/';
  const header=['競走得点','S','B','逃','捲','差','マ','1着','2着','3着','着外','勝率','2連対率','3連対率'];
  const values=['SS','逃','3.92','113.80','0','2','0','6','2','0','8','0','2','13','34.8','34.8','43.5'];
  const html='<title>熊本競輪 12R Ｓ級初特選 | 2026年10月22日</title><table class="racecard_table"><tr>'+header.map(v=>'<th>'+v+'</th>').join('')+'</tr><tr><td class="num">9</td><td class="rider">脇本 雄太 福 井/37/94(欠車)</td>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr></table>';
  const rows=countRows(parseHTML(html).document,source,'2026-11-15T23:00:00Z'),person={name:'脇本雄太',period:94};
  const counts=matchCounts(rows,person,9);assert.deepEqual(counts.values,{s:0,b:2,nige:0,makuri:6,sashi:2,mark:0,total_starts:23});
  assert.equal(counts.card_date,'2026-10-22');assert.equal(counts.unit,'count');
  assert.throws(()=>matchCounts(rows,{...person,period:95},9));assert.throws(()=>matchCounts(rows,{...person,name:'別人'},9));assert.throws(()=>matchCounts(rows,person,1));
  assert.throws(()=>countRows(parseHTML(html.replace('<th>S</th>','<th>H</th>')).document,source,new Date().toISOString()));
  assert.throws(()=>countRows(parseHTML(html.replace('12R','11R')).document,source,new Date().toISOString()));
  for(const url of ['https://example.com/kumamoto/racedetail/8720261022010012/','https://keirin.kdreams.jp/kumamoto/racedetail/8720261022010012/?a=1','https://keirin.kdreams.jp/pc/json'])assert.throws(()=>allowedCardUrl(url));
  console.log('RIDER COUNTS PASS: exact S/B/technique counts and same-window total, zero, withdrawals, source and complete person matching');
})().catch(error=>{console.error(error);process.exitCode=1;});
