// Isolated index2 prototype. Saved results and shared notes are read only.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.previousMeetings !== 'true' || typeof races === 'undefined') return;
  const current = new Map(races.map(race => [race.source, race]));
  const expanded = new Set();
  const entries = new Map();
  const expectedRatings = new Set();
  const ratings = new Map();
  const currentResultTypes = new Map();
  let ready = false, failed = false, ratingRequest = null, lastRatingAttempt = 0;
  const normalize = value => String(value).normalize('NFKC').replace(/\s+/g, '');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const keyFor = (date, raceId, playerId) => 'condition:v1:' + date + ':' + raceId + ':' + playerId;
  const validDate = value => typeof value === 'string' && datePattern.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const require = (value, message) => { if (!value) throw new Error(message); };

  function importantResult(result, meeting = {}) {
    if (result.highlight_rank === true) return true;
    const kind = normalize(result.race_type || '');
    if (kind.includes('決勝') && !kind.includes('準決')) return true;
    if (/初日特選|初特選|初特/.test(kind)) return true;
    return kind.includes('特選') && result.meeting_day === 1 && meeting.start_date_inferred !== true;
  }

  function paintCurrent(rider, player, maximumS) {
    const count = rider.querySelector('.recent-s');
    if (count) {
      count.classList.add('previous-s-count');
      const value = Number(player.stats?.[0]);
      count.classList.toggle('previous-s-max', value > 0 && value === maximumS);
    }
    for (const row of rider.querySelectorAll('.meeting-result[data-meeting-day]')) {
      const result = (player.meetingResults || []).find(item => item.meeting_day === Number(row.dataset.meetingDay));
      const rank = row.querySelector('.meeting-rank');
      if (rank) rank.classList.toggle('previous-important-rank', Boolean(result && importantResult({
        ...result, race_type: currentResultTypes.get(result.race_id) || result.race_type,
      }, {start_date_inferred:false})));
    }
  }

  function readCurrentTypes(payload) {
    const source = payload.current_result_types || {};
    require(source && typeof source === 'object' && !Array.isArray(source), 'current result types');
    currentResultTypes.clear();
    for (const race of races) for (const player of race.players) for (const result of player.meetingResults || []) {
      const kind = source[result.race_id];
      if (kind !== undefined) {
        require(typeof kind === 'string' && kind.length <= 80, 'current result type');
        currentResultTypes.set(result.race_id, kind);
      }
    }
  }

  function verifiedLink(raw, result) {
    if (!raw) return null;
    const url = new URL(raw);
    require(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash, 'history link');
    const code = result.race_id.slice(2, 4), day = result.race_date.replaceAll('-', '');
    if (['keirin.kdreams.jp', 'my.keirin.kdreams.jp'].includes(url.hostname) && url.pathname === '/stadium/digest/') {
      require(url.searchParams.get('kyogijoCd') === code && url.searchParams.get('kaisaiDate') === day && Number(url.searchParams.get('raceNo')) === result.race_number && /^[1-6]$/.test(url.searchParams.get('gradeCd') || ''), 'history video identity');
      return {url: url.href, video: true};
    }
    if (['keirin.jp', 'www.keirin.jp'].includes(url.hostname) && url.pathname === '/pc/dfw/dataplaza/guest/raceresult') {
      require(url.searchParams.get('KCD') === code && url.searchParams.get('KBI') === day && Number(url.searchParams.get('RNO')) === result.race_number, 'history result identity');
      return {url: url.href, video: false};
    }
    const match = /^\/[a-z]+\/racedetail\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(url.pathname);
    if (['keirin.kdreams.jp', 'my.keirin.kdreams.jp'].includes(url.hostname) && match) {
      const start = match[2], date = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8) + Number(match[3]) - 1));
      require(match[1] === code && date.toISOString().slice(0, 10) === result.race_date && Number(match[4]) === result.race_number && url.searchParams.get('pageType') === 'showResult', 'history result identity');
      return {url: url.href, video: false};
    }
    throw new Error('history link host');
  }

  function validate(payload) {
    const target = typeof conditionDate === 'string' ? conditionDate : document.querySelector('.eyebrow')?.textContent.match(/\d{4}\.\d{2}\.\d{2}/)?.[0].replaceAll('.', '-');
    require(payload?.schema_version === 1 && payload.target_date === target && validDate(target), 'history date');
    require(Array.isArray(payload.races) && payload.races.length === current.size, 'history race count');
    const verified = new Map();
    for (const row of payload.races) {
      const race = current.get(row.source_url);
      require(race && !verified.has(row.source_url) && Array.isArray(row.players) && row.players.length === race.players.length, 'history race identity');
      const members = new Map(), expected = new Map(race.players.map(player => [player.no, player]));
      let slots = 4;
      for (const player of row.players) {
        const card = expected.get(player.no);
        require(card && !members.has(player.no) && normalize(player.name) === normalize(card.name) && String(player.period) === String(card.period) && /^\d{6}$/.test(player.player_id || '') && player.player_id === card.playerId && Array.isArray(player.meetings), 'history rider identity');
        require(player.meetings.length <= 2, 'history meeting count');
        const meetings = [], seenMeetings = new Set(), seenPositions = new Set();
        for (const meeting of player.meetings) {
          require(validDate(meeting.start_date) && meeting.start_date < target && !seenMeetings.has(meeting.start_date) && Array.isArray(meeting.days), 'history meeting identity');
          seenMeetings.add(meeting.start_date);
          if (meeting.position !== undefined) {
            require(['previous_previous', 'previous'].includes(meeting.position) && !seenPositions.has(meeting.position), 'history meeting position');
            seenPositions.add(meeting.position);
          }
          const seenSlots = new Set(), days = [];
          for (const value of meeting.days) {
            const slot = value.slot ?? value.meeting_day;
            require(Number.isInteger(slot) && slot >= 1 && slot <= 8 && !seenSlots.has(slot), 'history slot');
            seenSlots.add(slot); slots = Math.max(slots, slot);
            const meetingStart = /^\d{8}$/.test(race.meetingStart || '') ? race.meetingStart.slice(0, 4) + '-' + race.meetingStart.slice(4, 6) + '-' + race.meetingStart.slice(6) : target;
            require(validDate(value.race_date) && value.race_date < meetingStart && value.player_id === player.player_id, 'history result identity');
            if (value.race_id !== null && value.race_id !== undefined || value.race_number !== null && value.race_number !== undefined) {
              require(/^\d{12}$/.test(value.race_id || '') && value.race_id.slice(4) === value.race_date.replaceAll('-', '') && Number.isInteger(value.race_number) && value.race_number >= 1 && value.race_number <= 12 && Number(value.race_id.slice(0, 2)) === value.race_number, 'history result identity');
            } else require(!value.video_url && !value.result_url, 'unverified history link');
            require(value.order === null || value.order === undefined || Number.isInteger(value.order) && value.order >= 0 && value.order <= 9, 'history rank');
            require(value.final_half_record === null || value.final_half_record === undefined || value.final_half_record === '' || typeof value.final_half_record === 'string' && /^\d{1,2}\.\d{1,3}$/.test(value.final_half_record), 'history time');
            for (const flag of ['home', 'back', 'start']) require(value[flag] === undefined || value[flag] === null || typeof value[flag] === 'boolean', 'history flag');
            const result = {...value, slot};
            result.link = verifiedLink(value.video_url || value.result_url, result);
            days.push(result);
          }
          meetings.push({...meeting, days: days.sort((a, b) => a.slot - b.slot)});
        }
        meetings.sort((a, b) => a.start_date.localeCompare(b.start_date));
        require(!seenPositions.size || seenPositions.size === meetings.length, 'mixed history meeting positions');
        for (let i = 1; i < meetings.length; i++) if (meetings[i - 1].days.length && meetings[i].days.length) {
          require(meetings[i - 1].days.at(-1).race_date < meetings[i].days[0].race_date, 'overlapping history meetings');
        }
        members.set(player.no, {...player, meetings});
      }
      verified.set(row.source_url, {members, slots});
    }
    return verified;
  }

  function paintRatings() {
    for (const node of root.querySelectorAll('.previous-condition')) {
      const value = ratings.get(node.dataset.conditionKey);
      node.textContent = Number.isInteger(value) && value !== 0 ? String(value) : '';
      node.setAttribute('aria-label', node.textContent ? 'その日の調子 ' + value : 'その日の調子は未表示');
    }
  }

  async function loadRatings(force = false) {
    const board = window.keirinBoard;
    if (!board?.ready || !expanded.size || !expectedRatings.size || document.visibilityState === 'hidden') return;
    if (ratingRequest) return ratingRequest;
    if (!force && Date.now() - lastRatingAttempt < 60000) return;
    lastRatingAttempt = Date.now();
    ratingRequest = (async () => {
      const values = new Map(), keys = [...expectedRatings];
      for (let i = 0; i < keys.length; i += 50) {
        const batch = keys.slice(i, i + 50);
        for (let offset = 0; ; offset += 1000) {
          const {data, error} = await board.client.from('race_comments')
            .select('id, race_key, body, created_at').in('race_key', batch)
            .order('created_at', {ascending: false}).order('id', {ascending: false}).range(offset, offset + 999);
          if (error) throw error;
          for (const row of data || []) {
            if (!expectedRatings.has(row.race_key) || values.has(row.race_key) || !/^(?:-2|-1|[0-5])$/.test(row.body)) continue;
            values.set(row.race_key, Number(row.body));
          }
          if (!data || data.length < 1000) break;
        }
      }
      ratings.clear();
      for (const [key, value] of values) ratings.set(key, value);
      paintRatings();
    })().catch(() => { /* A read failure retains confirmed notes without writing. */ });
    try { await ratingRequest; } finally { ratingRequest = null; }
  }

  function resultNode(result, player, meeting) {
    const row = element('div', 'previous-result');
    if (!result) {
      row.append(element('span', 'previous-order-line'), element('span', 'previous-time'));
      row.setAttribute('aria-hidden', 'true');
      return row;
    }
    row.dataset.raceDate = result.race_date;
    if (result.race_id) row.dataset.raceId = result.race_id;
    const title = [meeting.venue, result.race_date, result.race_number ? result.race_number + 'R' : ''].filter(Boolean).join(' ');
    row.title = title;
    const orderLine = element('div', 'previous-order-line');
    const order = element(result.link ? 'a' : 'span', 'previous-order');
    if (result.link) {
      order.href = result.link.url;
      order.target = '_self';
      order.title = title + (result.link.video ? 'の楽天レース動画' : 'の競走成績');
      if (result.link.video) order.addEventListener('click', event => {
        if (typeof window.openVideo === 'function') window.openVideo(event, order.href);
      });
    }
    const label = result.order ? String(result.order) : String(result.accident || '');
    const rank = element('span', 'previous-rank', label);
    rank.classList.toggle('previous-important-rank', importantResult(result, meeting));
    if (result.display_type === 1) rank.classList.add('previous-rank-circle');
    else if (result.display_type === 2) rank.classList.add('previous-rank-solid');
    order.append(rank);
    for (const [field, text] of [['start', 'S'], ['home', 'H'], ['back', 'B']]) {
      if (result[field] === true) order.append(element('span', 'previous-flag', text));
    }
    const condition = element('span', 'previous-condition');
    if (result.race_id) {
      condition.dataset.conditionKey = keyFor(result.race_date, result.race_id, player.player_id);
      expectedRatings.add(condition.dataset.conditionKey);
    }
    orderLine.append(order, condition);
    const time = element('span', 'previous-time');
    time.append(element('span', 'previous-time-value', result.final_half_record || ''));
    row.append(orderLine, time);
    return row;
  }

  function populate(panel, source, number) {
    const record = entries.get(source), player = record?.members.get(number);
    if (!record || !player) return;
    const blocks = player.meetings.some(meeting => meeting.position !== undefined)
      ? ['previous_previous', 'previous'].map(position => player.meetings.find(meeting => meeting.position === position) || null)
      : player.meetings.length === 2 ? player.meetings : [null, player.meetings[0] || null];
    panel.replaceChildren();
    blocks.forEach((meeting, index) => {
      const block = element('div', 'previous-meeting');
      block.dataset.previousMeeting = index === 0 ? 'older' : 'newer';
      const venue = meeting?.venue || '';
      const heading = element('span', 'previous-heading', Array.from(venue).slice(0, 3).join('') || '—');
      heading.title = meeting ? [meeting.venue, meeting.start_date].filter(Boolean).join(' ') : '取得なし';
      heading.setAttribute('aria-label', venue || '競輪場未取得');
      const grade = Number(meeting?.grade_code);
      if (grade === 3) heading.classList.add('previous-grade-g3');
      else if (grade >= 4 && grade <= 6) heading.classList.add('previous-grade-high');
      block.append(heading);
      for (let slot = 1; slot <= record.slots; slot++) {
        const value = meeting?.days.find(result => result.slot === slot);
        const node = resultNode(value, player, meeting || {});
        node.dataset.previousSlot = String(slot);
        block.append(node);
      }
      panel.append(block);
    });
    paintRatings();
  }

  function rowSource(row) {
    const link = row.querySelector('.race-link');
    return link?.dataset.raceSource || link?.href;
  }

  function attachRow(row) {
    const source = rowSource(row), race = current.get(source);
    if (!race) return;
    const open = expanded.has(source);
    const maximumS = Math.max(0, ...race.players.map(player => Number(player.stats?.[0]) || 0));
    for (const rider of row.querySelectorAll('.lineup .rider')) {
      const number = Number(rider.querySelector('.car')?.textContent);
      const player = race.players.find(member => member.no === number);
      if (!player) continue;
      paintCurrent(rider, player, maximumS);
      if (rider.querySelector('.previous-controls')) continue;
      // Only this prototype removes the opening-day placeholder. Existing
      // current-meeting results remain above the new control.
      rider.querySelector('.meeting-first-day')?.remove();
      const control = element('div', 'previous-controls');
      const button = element('button', 'previous-toggle', '前回');
      button.type = 'button';
      button.dataset.previousSource = source;
      button.setAttribute('aria-expanded', String(open));
      const panel = element('div', 'previous-results');
      panel.id = 'previous-' + source.replace(/\W/g, '-') + '-' + player.playerId;
      panel.hidden = !open;
      panel.setAttribute('aria-label', player.name + 'の前々走・前走の成績');
      button.setAttribute('aria-controls', panel.id);
      button.title = failed ? '前回成績を読み込めませんでした' : '前々走・前走の成績を開閉';
      button.disabled = !ready;
      control.append(button, panel);
      const currentResults = rider.querySelector('.meeting-results');
      if (currentResults) currentResults.after(control);
      else rider.append(control);
      if (ready) populate(panel, source, number);
    }
  }

  function attachAll() {
    for (const row of root.children) attachRow(row);
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('.previous-toggle');
    if (!button || !root.contains(button) || !ready) return;
    const source = button.dataset.previousSource;
    if (expanded.has(source)) expanded.delete(source); else expanded.add(source);
    const open = expanded.has(source);
    for (const row of root.children) if (rowSource(row) === source) {
      for (const toggle of row.querySelectorAll('.previous-toggle')) toggle.setAttribute('aria-expanded', String(open));
      for (const panel of row.querySelectorAll('.previous-results')) panel.hidden = !open;
    }
    loadRatings();
  });
  new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.target === root)) attachAll();
  }).observe(root, {childList: true});
  document.querySelectorAll('.notice').forEach(node => {
    for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) child.textContent = child.textContent.replace('初日には前日までの今場所成績がないため「初日」と表示します。', '「前回」を押すと前々走・前走の成績を表示します。');
  });
  attachAll();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  fetch(new URL('previous-meetings.json', document.baseURI).href, {cache: 'no-store', signal: controller.signal})
    .then(response => { if (!response.ok) throw new Error('history unavailable'); return response.json(); })
    .then(payload => {
      for (const [source, record] of validate(payload)) entries.set(source, record);
      readCurrentTypes(payload);
      ready = true;
      document.body.dataset.previousMeetingsStatus = 'ready';
      for (const row of root.children) {
        const source = rowSource(row);
        const race = current.get(source);
        const maximumS = Math.max(0, ...(race?.players || []).map(player => Number(player.stats?.[0]) || 0));
        for (const rider of row.querySelectorAll('.lineup .rider')) {
          const number = Number(rider.querySelector('.car')?.textContent);
          const player = race?.players.find(member => member.no === number);
          if (player) paintCurrent(rider, player, maximumS);
          const panel = rider.querySelector('.previous-results');
          if (panel) populate(panel, source, number);
          const button = rider.querySelector('.previous-toggle');
          if (button) button.disabled = false;
        }
      }
      loadRatings();
    }).catch(() => {
      failed = true;
      document.body.dataset.previousMeetingsStatus = 'error';
      root.querySelectorAll('.previous-toggle').forEach(button => { button.title = '前回成績を読み込めませんでした'; });
    }).finally(() => clearTimeout(timeout));
  window.addEventListener('keirin-board-state', () => loadRatings(true));
  document.addEventListener('visibilitychange', () => loadRatings());
  setInterval(() => loadRatings(), 60000);
})();
