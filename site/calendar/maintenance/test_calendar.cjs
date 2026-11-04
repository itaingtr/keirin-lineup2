// Run with NODE_PATH pointing to a temporary jsdom installation.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const schedule=JSON.parse(fs.readFileSync(path.join(root,'schedule.json')));
const code=fs.readFileSync(path.join(root,'calendar.js'),'utf8');
(async()=>{
for(const file of fs.readdirSync(root).filter(n=>/^\d{6}\.html$/.test(n))){
 const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'),{url:'https://itaingtr.github.io/keirin-lineup2/calendar/'+file,runScripts:'outside-only'});
 const {window:w}=dom;
 w.fetch=async url=>({ok:true,json:async()=>url.includes('schedule')?schedule:url.includes('race-links')?{schema_version:1,days:[]}:{schema_version:1,days:[]}});
 w.eval(code);await new Promise(r=>setImmediate(r));
 const d=w.document;
 assert.equal(d.getElementById('retry').hidden,true,d.getElementById('status').textContent);
 for(const week of d.querySelectorAll('.week')){
  const events=week.querySelector('.week-events');
  const bars=[...events.querySelectorAll('.meeting-bar')];
  const occupied=new Set();
  const count=Number(events.style.gridTemplateRows.match(/repeat\((\d+)/)?.[1]||0);
  for(const bar of bars){
   const m=schedule.meetings.find(m=>m.id===bar.dataset.meeting);
   const row=Number(bar.style.gridRow);
   if(m.grade==='F1'&&m.night)assert.ok(row>=count-1&&row<=count,'night outside bottom two rows');
   if(m.grade==='F1'&&!m.night&&bars.some(b=>schedule.meetings.find(m=>m.id===b.dataset.meeting).night&&b.dataset.grade==='F1'))assert.ok(row<count-1);
   assert.ok(bar.classList.contains(m.grade==='G3'?'grade-purple':['GP','G1','G2'].includes(m.grade)?'grade-red':bar.classList[1]));
   for(const day of bar.querySelectorAll('.meeting-day')){
    assert.equal(day.querySelector('small'),null);
    assert.equal(day.textContent,Array.from(m.venue).slice(0,3).join('')+(m.night?'🌛':''));
    const key=row+':'+day.dataset.date;assert.ok(!occupied.has(key),'overlapping meetings');occupied.add(key);
   }
  }
 }
 dom.window.close();
}
console.log('Calendar: all 18 months, labels, colors, night lanes and nonoverlap passed');
})().catch(e=>{console.error(e);process.exitCode=1});
