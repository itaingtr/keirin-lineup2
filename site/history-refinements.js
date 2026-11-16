// Display-only history spacing and checked public win/loss reasons. No writes.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.historyRefinements !== '20261116' || typeof races === 'undefined') return;
  const current = new Map(races.map(race=>[race.source,race]));
  const normalize = value=>String(value || '').normalize('NFKC').replace(/\s+/g,'');
  const notes = new Map();
  let scheduled = false;
  const sourceFor = row=>{const link=row.querySelector('.race-link');return link?.dataset.raceSource || link?.href;};

  function alignTen(block) {
    if (block.dataset.refined === 'true') return;
    const heading = block.querySelector('.ten-heading'), ranks = block.querySelector('.ten-ranks'), venue = block.querySelector('.ten-venue');
    if (!heading || !ranks || !venue) return;
    block.dataset.refined = 'true';
    const results = [...block.querySelectorAll('.ten-rank')];
    const first = results[0], start = / (\d{4}-\d{2}-\d{2})$/.exec(block.title)?.[1];
    const difference = first && start && !first.title.includes('未照合')
      ? (Date.parse(first.dataset.raceDate+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000 : 0;
    const leading = Number.isInteger(difference) && difference > 0 && difference <= 7 ? difference : 0;
    const slots = [];
    for (let i=0;i<leading;i++) {
      const blank = document.createElement('span');blank.className='ten-empty';
      blank.dataset.meetingDay=String(i+1);blank.setAttribute('aria-label',(i+1)+'日目は出走なし');slots.push(blank);
    }
    slots.push(...results);
    const spill = Math.max(0,slots.length-4);
    heading.replaceChildren(venue,...slots.slice(0,spill));ranks.replaceChildren(...slots.slice(spill));
    if (spill) {
      const units = Array.from(venue.textContent).reduce((sum,char)=>sum+(/\d/.test(char)?.6:1),0);
      const width = Math.max(1,(20-units*6.5+Array.from(venue.textContent).length*.25)/spill);
      heading.style.setProperty('--ten-spill-width',width+'px');
      heading.style.setProperty('--ten-spill-size',Math.min(8,width/.7)+'px');
    }
  }
  function spaceFlags(order) {
    const flag = order.querySelector('.meeting-back,.previous-flag');
    if (flag) {
      flag.classList.add('history-flag-first');
      if (flag.previousSibling?.textContent !== ' ') flag.before(document.createTextNode(' '));
    }
  }
  async function reason(race,player,history) {
    if (history.player_id !== player.playerId || !history.start_source_url) return null;
    const url = new URL(history.start_source_url);url.search='';url.hash='';
    const data = await window.keirinPublicResults.read(url.href);
    if (data.race_id !== history.race_id || data.race_date !== history.race_date || data.race_number !== history.race_number) return null;
    const row = data.rows.find(row=>row.no === history.car_number && normalize(row.name) === normalize(player.name));
    if (!row || (history.has_accident ? normalize(row.rank)[0] !== normalize(history.accident)[0] : row.rank !== String(history.order))) return null;
    const time = history.final_half_record || '';
    if (row.time !== time && !(['','-','—','―'].includes(row.time) && !time)) return null;
    return {text:row.reason,observed:data.observed_at};
  }
  function fill(node,value,state) {
    node.textContent = value ? Array.from(normalize(value.text)).slice(0,5).join('') : '';
    node.title = value ? value.text+'（楽天Kドリームス '+value.observed+'）' : state === 'error' ? '勝敗因を確認できなかったにゃ' : '勝敗因は未確認にゃ';
    node.dataset.reasonState=state;
    node.setAttribute('aria-label',value ? '勝敗因 '+value.text : '勝敗因は未確認');
  }
  function refine() {
    scheduled=false;
    for (const block of root.querySelectorAll('.ten-meeting')) alignTen(block);
    for (const order of root.querySelectorAll('.meeting-order,.previous-order')) spaceFlags(order);
    for (const row of root.children) {
      const race = current.get(sourceFor(row));if (!race) continue;
      for (const rider of row.querySelectorAll('.lineup .rider')) {
        const reference = rider.querySelector('.previous-order-line,.meeting-order-line');
        if (reference) {
          const inset = parseFloat(getComputedStyle(reference).paddingLeft);
          if (Number.isFinite(inset)) rider.style.setProperty('--history-inset',inset+'px');
        }
        const player = race.players.find(player=>player.no === Number(rider.querySelector('.car')?.textContent));
        if (!player) continue;
        for (const result of rider.querySelectorAll('.meeting-result')) {
          if (result.querySelector('.meeting-reason')) continue;
          const node = document.createElement('span');node.className='meeting-reason';result.append(node);
          const history = player.meetingResults?.find(value=>value.meeting_day === Number(result.dataset.meetingDay));
          fill(node,null,'pending');
          if (!history) {
            if (player.meetingResults?.some(value=>value.meeting_day > Number(result.dataset.meetingDay))) {
              for (const empty of result.querySelectorAll('.meeting-empty,.meeting-time')) empty.textContent='';
            }
            continue;
          }
          const key = history.race_id+':'+player.playerId;
          if (!notes.has(key)) notes.set(key,reason(race,player,history).catch(()=>null));
          notes.get(key).then(value=>{
            fill(node,value,value?'ready':'unavailable');
            window.dispatchEvent(new CustomEvent('keirin-history-reason',{detail:{key,state:node.dataset.reasonState}}));
          });
        }
      }
    }
    document.body.dataset.historyRefinementsStatus='ready';
  }
  function schedule() { if (!scheduled) {scheduled=true;queueMicrotask(refine);} }
  new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  refine();
})();
