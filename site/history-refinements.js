// Display-only history spacing and checked public win/loss reasons. No writes.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.historyRefinements !== '20261116' || typeof races === 'undefined') return;
  const current = new Map(races.map(race=>[race.source,race]));
  const normalize = value=>String(value || '').normalize('NFKC').replace(/\s+/g,'');
  const notes = new Map();
  let scheduled = false, fittedWidth = 0, referenceWidth = 0;
  const centered = document.body.dataset.lineupFit === 'nine-centered-20261122';
  const sourceFor = row=>{const link=row.querySelector('.race-link');return link?.dataset.raceSource || link?.href;};

  const pixels = value=>parseFloat(value)||0;
  function dimensions(node) {
    const box=node.getBoundingClientRect(),style=getComputedStyle(node);
    return {box,x:box.width/(pixels(style.width)||node.offsetWidth||box.width||1),y:box.height/(pixels(style.height)||node.offsetHeight||box.height||1)};
  }
  function fitNine(width) {
    const lineups=[...root.querySelectorAll('.lineup')];
    if (!lineups.length) return;
    let measured=0;
    for (const lineup of lineups) {
      const groups=[...lineup.children].filter(node=>node.classList.contains('line-group'));
      const gap=pixels(getComputedStyle(lineup).columnGap);
      const rider=lineup.querySelector('.rider');
      const column=rider ? pixels(getComputedStyle(rider).width) : 32;
      // Reserve nine complete rider columns and four line boundaries even
      // on a seven-rider-only card. Wider contests/singletons win this max.
      measured=Math.max(measured,9*column+4*gap,
        groups.reduce((sum,group)=>sum+(pixels(getComputedStyle(group).width)||group.offsetWidth),0)+Math.max(0,groups.length-1)*gap);
    }
    referenceWidth=Math.max(referenceWidth,measured);
    const row=lineups[0].closest('#rows > tr'),main=document.querySelector('main');
    const rowStyle=getComputedStyle(row),mainStyle=getComputedStyle(main);
    const gutter=pixels(mainStyle.paddingLeft)+pixels(mainStyle.paddingRight)
      +pixels(rowStyle.paddingLeft)+pixels(rowStyle.paddingRight)+pixels(rowStyle.borderLeftWidth)+pixels(rowStyle.borderRightWidth);
    const zoom=Math.floor(width/(referenceWidth+gutter)*10000)/10000;
    if (!(zoom>0)) return;
    const venue=Math.max(38,...[...root.children].map(row=>row.querySelector('.venue')?.scrollWidth||0));
    document.body.style.setProperty('--card-venue-width',Math.ceil(venue)+'px');
    document.body.style.setProperty('--lineup-reference-width',referenceWidth+'px');
    document.body.style.setProperty('--lineup-zoom',String(zoom));
    document.body.dataset.mobileLineupFit='ready';fittedWidth=width;
  }
  function centerMembers(lineup) {
    const cars=[...lineup.querySelectorAll('.car')];
    if (!cars.length) return;
    const {box,x}=dimensions(lineup),bounds=cars.map(car=>car.getBoundingClientRect());
    const middle=(Math.min(...bounds.map(b=>b.left))+Math.max(...bounds.map(b=>b.right)))/2;
    const current=pixels(lineup.style.getPropertyValue('--lineup-center-shift'));
    const shift=Math.round((current+(box.left+box.width/2-middle)/x)*100)/100;
    if (Math.abs(shift-current)>.01)lineup.style.setProperty('--lineup-center-shift',shift+'px');
  }
  function measuredSeparators(groups) {
    groups.forEach((group,index)=>{
      if (index===groups.length-1) {
        group.querySelector(':scope > .line-separator')?.remove();
        group.querySelector(':scope > .line-back-separator')?.remove();return;
      }
      const cars=[...group.querySelectorAll('.car')],car=cars.at(-1),next=groups[index+1].querySelector('.car');
      if (!car||!next)return;
      const {box,x,y}=dimensions(group),before=car.getBoundingClientRect(),after=next.getBoundingClientRect();
      const left=((before.left+before.width/2+after.left+after.width/2)/2-box.left)/x;
      const back=group.querySelector('.stats .stat-b,.stats .stat-b-zero');
      for (const [className,target] of [['line-separator',before],['line-back-separator',back?.getBoundingClientRect()]]) {
        let dot=group.querySelector(':scope > .'+className);
        if (!target){dot?.remove();continue;}
        if (!dot) {
          dot=document.createElement('span');dot.className=className;dot.textContent='•';
          dot.setAttribute('aria-hidden','true');group.append(dot);
        }
        const top=(target.top+target.height/2-box.top)/y;
        for (const [name,value] of [['left',left],['top',top]]) {
          const position=(Math.round(value*100)/100)+'px';
          if (dot.style[name]!==position)dot.style[name]=position;
        }
      }
    });
  }
  function fitMobile() {
    const width=document.documentElement.clientWidth;
    if (!window.matchMedia('(max-width:640px)').matches) {fittedWidth=0;return;}
    if (width===fittedWidth) return;
    if (centered) {fitNine(width);return;}
    const rows=[...root.children], live=rows[0]?.querySelector('.live-link');
    if (!live) return;
    const zoom=parseFloat(getComputedStyle(document.body).zoom)||1;
    let venueWidth=38, headerWidth=218;
    for (const row of rows) {
      const venue=row.querySelector('td.venue'), header=row.querySelector('td.race');
      if (venue) venueWidth=Math.max(venueWidth,venue.scrollWidth);
      if (!header) continue;
      const parts=['.race-link','.race-time','.video-actions'].map(selector=>header.querySelector(selector)).filter(Boolean);
      const gap=parseFloat(getComputedStyle(header).columnGap)||0;
      headerWidth=Math.max(headerWidth,parts.reduce((sum,node)=>sum+node.getBoundingClientRect().width/zoom,0)+gap*(parts.length-1));
    }
    const baseHeaderWidth=Math.ceil(headerWidth+1);
    document.body.style.setProperty('--card-venue-width',Math.ceil(venueWidth)+'px');
    document.body.style.setProperty('--race-header-width',baseHeaderWidth+'px');
    const compact=document.body.dataset.mobileLayout==='compact-20261122';
    const edge=compact ? Math.max(...rows.map(row=>((row.querySelector('.live-link')?.getBoundingClientRect().right||0)+window.scrollX)/zoom))
      : (live.getBoundingClientRect().right+window.scrollX)/zoom;
    if (!(edge>0&&width>0)) return;
    const requested=Math.floor((width-2)/edge*10000)/10000;
    const fitted=Math.max(1,Math.min(1.2544,requested));
    const targetEdge=(width-2)/fitted;
    const expandedHeader=compact ? baseHeaderWidth : baseHeaderWidth+Math.max(0,targetEdge-edge);
    const balancedHeader=Math.floor(expandedHeader*100)/100;
    document.body.style.setProperty('--race-header-width',balancedHeader+'px');
    document.body.style.setProperty('--lineup-zoom',String(fitted));
    document.body.dataset.mobileLineupFit='ready';fittedWidth=width;
  }

  function nativeInputs() {
    if (document.body.dataset.mobileLayout!=='compact-20261122') return;
    const mobile=window.matchMedia('(max-width:640px)').matches;
    const zoom=mobile ? parseFloat(getComputedStyle(document.body).zoom)||1 : 1;
    // Use a numeric zoom for older iOS WebKit, which may not accept calc()
    // for this property. This runs on layout/redraw, never on focus/typing.
    const value=String(1/zoom);
    for (const input of document.querySelectorAll('.race-comment-input,.page-bottom #search,.page-bottom .race-comments-email,.page-bottom .race-comments-code')) {
      if (mobile) {if(Math.abs((parseFloat(input.style.zoom)||0)-1/zoom)>.000001)input.style.zoom=value;}
      else if(input.style.zoom)input.style.removeProperty('zoom');
    }
  }

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
      const available=heading.clientWidth-(parseFloat(getComputedStyle(heading).paddingLeft)||0);
      const width = Math.max(1,(available-units*6.5+Array.from(venue.textContent).length*.25)/spill);
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
    fitMobile();
    nativeInputs();
    for (const lineup of root.querySelectorAll('.lineup')) {
      const groups=[...lineup.children].filter(node=>node.classList.contains('line-group'));
      if (centered) {centerMembers(lineup);measuredSeparators(groups);continue;}
      groups.forEach((group,index)=>{
        const current=group.querySelector(':scope > .line-separator');
        const backSeparator=group.querySelector(':scope > .line-back-separator');
        if (index===groups.length-1) {current?.remove();backSeparator?.remove();return;}
        let separator=current;
        if (!separator) {
          separator=document.createElement('span');separator.className='line-separator';separator.textContent='•';
          separator.setAttribute('aria-hidden','true');group.append(separator);
        }
        const zoom=parseFloat(getComputedStyle(document.body).zoom)||1;
        const owner=group.getBoundingClientRect(),next=groups[index+1].getBoundingClientRect();
        const left=(Math.round(((owner.right+next.left)/2-owner.left)/zoom*100)/100)+'px';
        if (separator.style.left!==left) separator.style.left=left;
        const back=group.querySelector('.stats .stat-b,.stats .stat-b-zero');
        if (back) {
          const separator=backSeparator || document.createElement('span');
          if (!backSeparator) {
            separator.className='line-back-separator';separator.textContent='•';
            separator.setAttribute('aria-hidden','true');
          }
          const zoom=parseFloat(getComputedStyle(document.body).zoom)||1;
          const box=back.getBoundingClientRect(),origin=group.getBoundingClientRect();
          const top=(Math.round((box.top+box.height/2-origin.top)/zoom*100)/100)+'px';
          if (separator.style.top!==top) separator.style.top=top;
          if (!backSeparator) group.append(separator);
        } else backSeparator?.remove();
      });
    }
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
    if(centered)document.body.dataset.lineupFitStatus='ready';
  }
  function schedule() { if (!scheduled) {scheduled=true;queueMicrotask(refine);} }
  new MutationObserver(schedule).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-expanded']});
  root.addEventListener('click',event=>{if(event.target.closest('.period-toggle'))requestAnimationFrame(schedule);});
  window.addEventListener('resize',()=>{fitMobile();schedule();});
  if(centered&&typeof ResizeObserver!=='undefined')new ResizeObserver(schedule).observe(root);
  if(centered&&document.fonts)document.fonts.ready.then(()=>{fittedWidth=0;schedule();});
  refine();
})();
