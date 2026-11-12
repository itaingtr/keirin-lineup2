// Index2-only compact prior-ten-meeting results. No database operations.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.tenMeetings !== 'true' || typeof races === 'undefined') return;
  const current = new Map(races.map(race => [race.source, race]));
  const expanded = new Set(), records = new Map();
  let ready = false, failed = false;
  const normalize = value => String(value).normalize('NFKC').replace(/\s+/g, '');
  const require = (value, message) => { if (!value) throw new Error(message); };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
  const node = (tag, className, text) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  };

  function validateLink(value, meeting) {
    if (!value.video_url) return null;
    const url = new URL(value.video_url);
    require(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && ['keirin.kdreams.jp','my.keirin.kdreams.jp'].includes(url.hostname)
      && url.pathname === '/stadium/digest/', 'ten meeting video host');
    require(['kyogijoCd','kaisaiDate','raceNo','gradeCd'].every(key => url.searchParams.getAll(key).length === 1), 'ten meeting duplicate video identity');
    require(url.searchParams.get('kyogijoCd') === meeting.venue_code
      && url.searchParams.get('kaisaiDate') === value.race_date.replaceAll('-','')
      && Number(url.searchParams.get('raceNo')) === value.race_number
      && Number(url.searchParams.get('gradeCd')) === meeting.grade_code, 'ten meeting video identity');
    return url.href;
  }

  function validate(data) {
    const target = typeof conditionDate === 'string' ? conditionDate
      : document.querySelector('.eyebrow')?.textContent.match(/\d{4}\.\d{2}\.\d{2}/)?.[0].replaceAll('.','-');
    require(data?.schema_version === 1 && data.provider === 'keirin.jp' && validDate(target)
      && data.target_date === target && Array.isArray(data.races) && data.races.length === current.size, 'ten meeting card');
    const verified = new Map();
    for (const race of data.races) {
      const expected = current.get(race.source_url);
      require(expected && !verified.has(race.source_url) && Array.isArray(race.players)
        && race.players.length === expected.players.length, 'ten meeting race');
      const members = new Map();
      const before = /^\d{8}$/.test(expected.meetingStart || '')
        ? expected.meetingStart.slice(0,4)+'-'+expected.meetingStart.slice(4,6)+'-'+expected.meetingStart.slice(6) : target;
      for (const player of race.players) {
        const person = expected.players.find(person => person.no === player.no);
        require(person && !members.has(player.no) && normalize(person.name) === normalize(player.name)
          && String(person.period) === String(player.period) && /^\d{6}$/.test(player.player_id || '')
          && player.player_id === person.playerId && Array.isArray(player.meetings) && player.meetings.length <= 10, 'ten meeting rider');
        let lastEnd = '';
        const meetings = player.meetings.map(meeting => {
          require(validDate(meeting.start_date) && meeting.start_date < before && meeting.start_date > lastEnd
            && typeof meeting.venue === 'string' && meeting.venue.length > 0
            && /^\d{2}$/.test(meeting.venue_code || '') && Number.isInteger(meeting.grade_code)
            && meeting.grade_code >= 1 && meeting.grade_code <= 6
            && Array.isArray(meeting.days) && meeting.days.length <= 8, 'ten meeting identity');
          let lastDay = '', seen = new Set();
          const days = meeting.days.map(value => {
            const verifiedRace = Number.isInteger(value.race_number) && value.race_number >= 1 && value.race_number <= 12
              && value.race_id === String(value.race_number).padStart(2,'0') + meeting.venue_code + value.race_date.replaceAll('-','');
            const unavailableRace = value.race_number == null && value.race_id == null && !value.video_url;
            const resultKey = value.race_id || value.race_date + ':unavailable';
            require(validDate(value.race_date) && value.race_date >= meeting.start_date && value.race_date < before
              && value.race_date >= lastDay && (verifiedRace || unavailableRace)
              && !seen.has(resultKey), 'ten meeting result identity');
            require(value.order === null || value.order === undefined || Number.isInteger(value.order) && value.order >= 0 && value.order <= 9, 'ten meeting rank');
            require(value.accident === undefined || value.accident === null || typeof value.accident === 'string' && value.accident.length <= 4, 'ten meeting accident');
            require(value.race_type === undefined || value.race_type === null || typeof value.race_type === 'string' && value.race_type.length <= 80, 'ten meeting race type');
            seen.add(resultKey);lastDay = value.race_date;
            return {...value, link:validateLink(value,meeting)};
          });
          lastEnd = lastDay || meeting.start_date;
          return {...meeting, days};
        });
        members.set(player.no, {...player, meetings});
      }
      verified.set(race.source_url, members);
    }
    return verified;
  }

  function rankNode(result) {
    const label = result.order ? String(result.order) : String(result.accident || '');
    const rank = node(result.link ? 'a' : 'span','ten-rank',label);
    const kind = normalize(result.race_type || '');
    if (result.highlight_rank === true || result.semifinal_rank === true || /初日特選|初特選|初特/.test(kind)
      || /準決勝(?:戦)?$/.test(kind) || /決勝(?:戦)?$/.test(kind) && !kind.includes('準')) rank.classList.add('ten-rank-highlight');
    rank.dataset.raceDate = result.race_date;
    if (result.race_id) rank.dataset.raceId = result.race_id;
    rank.title = [result.race_date,result.race_number ? result.race_number+'R' : '',kind,label+'着'].filter(Boolean).join(' ');
    if (result.link) {
      rank.href = result.link;rank.target = '_self';
      rank.addEventListener('click',event => { if (typeof window.openVideo === 'function') window.openVideo(event,rank.href); });
    }
    return rank;
  }

  function populate(panel, player) {
    panel.replaceChildren();
    const blank = 10 - player.meetings.length;
    for (let index = 0; index < 10; index++) {
      const block = node('div','ten-meeting');block.dataset.tenSlot = String(index+1);
      const heading = node('div','ten-heading'), ranks = node('div','ten-ranks');
      const meeting = player.meetings[index-blank];
      if (!meeting) block.setAttribute('aria-hidden','true');
      else {
        block.title = meeting.venue+' '+meeting.start_date;
        const venue = /^(?:いわき平|いわき|平)$/.test(meeting.venue) ? '平' : Array.from(meeting.venue).slice(0,2).join('');
        const prefix = meeting.grade_code === 2 ? String(Number(meeting.start_date.slice(5,7))) : '';
        const name = node('span','ten-venue',prefix+venue);name.title = block.title;
        if (meeting.grade_code === 3) name.classList.add('ten-grade-g3');
        else if (meeting.grade_code >= 4) name.classList.add('ten-grade-high');
        if (prefix) name.classList.add('ten-month-venue');
        heading.append(name);
        const spill = Math.max(0,meeting.days.length-4);
        if (spill > 1) {
          // Rare six-or-more-start meetings still keep every placing within
          // the same two lines and the original rider-column width.
          const units = Array.from(prefix+venue).reduce((sum,char) => sum + (/\d/.test(char) ? 0.6 : 1),0);
          heading.classList.add('ten-heading-many');
          heading.style.setProperty('--ten-heading-size',Math.min(7,22/(units+spill*0.7))+'px');
        }
        meeting.days.forEach((result,number) => (number < spill ? heading : ranks).append(rankNode(result)));
      }
      block.append(heading,ranks);panel.append(block);
    }
  }

  function sourceFor(row) { const link = row.querySelector('.race-link');return link?.dataset.raceSource || link?.href; }
  function attachAll() {
    for (const row of root.children) {
      const source = sourceFor(row), race = current.get(source);
      if (!race) continue;
      for (const rider of row.querySelectorAll('.lineup .rider')) {
        if (rider.querySelector('.ten-controls')) continue;
        const number = Number(rider.querySelector('.car')?.textContent);
        const player = race.players.find(person => person.no === number);
        const previous = rider.querySelector('.previous-controls');
        if (!player || !previous) continue;
        const controls = node('div','ten-controls'), button = node('button','ten-toggle','成績'), panel = node('div','ten-results');
        button.type = 'button';button.disabled = !ready;
        button.dataset.tenSource = source;button.setAttribute('aria-expanded',String(expanded.has(source)));
        button.title = failed ? '過去10場所の成績を読み込めませんでした' : '過去10場所の成績を開閉';
        panel.id = 'ten-'+source.replace(/\W/g,'-')+'-'+player.playerId;
        panel.hidden = !expanded.has(source);panel.setAttribute('aria-label',player.name+'の過去10場所の成績');
        button.setAttribute('aria-controls',panel.id);
        controls.append(button,panel);previous.after(controls);
        if (ready) populate(panel,records.get(source).get(number));
      }
    }
  }
  root.addEventListener('click',event => {
    const button = event.target.closest('.ten-toggle');
    if (!button || !root.contains(button) || !ready) return;
    const source = button.dataset.tenSource;
    if (expanded.has(source)) expanded.delete(source); else expanded.add(source);
    for (const row of root.children) if (sourceFor(row) === source) {
      row.querySelectorAll('.ten-toggle').forEach(toggle => toggle.setAttribute('aria-expanded',String(expanded.has(source))));
      row.querySelectorAll('.ten-results').forEach(panel => { panel.hidden = !expanded.has(source); });
    }
  });
  new MutationObserver(mutations => { if (mutations.some(change => change.type === 'childList')) attachAll(); })
    .observe(root,{childList:true,subtree:true});
  attachAll();
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(),30000);
  fetch(new URL('ten-meetings.json',document.baseURI).href,{cache:'no-store',signal:abort.signal})
    .then(response => { if (!response.ok) throw new Error('ten meetings unavailable');return response.json(); })
    .then(data => {
      const checked = validate(data);checked.forEach((value,key) => records.set(key,value));ready = true;
      root.querySelectorAll('.ten-controls').forEach(control => control.remove());attachAll();
      document.body.dataset.tenMeetingsStatus = 'ready';
    })
    .catch(() => { failed = true;document.body.dataset.tenMeetingsStatus = 'error';
      root.querySelectorAll('.ten-toggle').forEach(button => { button.disabled = true;button.title = '過去10場所の成績を読み込めませんでした'; });
    }).finally(() => clearTimeout(timer));
})();
