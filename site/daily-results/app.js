(() => {
  'use strict';
  const M = window.DailyResults, base = new URL('../', location.href);
  const $ = id => document.getElementById(id);
  const elements = {date: $('date'), venue: $('venue'), race: $('race'), search: $('search'), rows: $('entries'), status: $('status'), count: $('count')};
  const immutableCache = new Map(), datesCache = new Map(), rowNodes = new Map();
  let calendar, selected, sequence = 0, conditions = new Map(), conditionBusy = false;
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  };

  async function readJSON(path, sha) {
    const key = path + ':' + sha;
    if (sha && immutableCache.has(key)) return immutableCache.get(key);
    const request = (async () => {
      const url = new URL(path, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('資料の参照先が違います');
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url.href, {cache: sha ? 'default' : 'no-store', signal: controller.signal});
        if (!response.ok) throw new Error('資料を読み込めません');
        const buffer = await response.arrayBuffer();
        if (sha) {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
          if (hash !== sha) throw new Error('資料のチェックサムが違います');
        }
        return JSON.parse(new TextDecoder().decode(buffer));
      } finally { clearTimeout(timeout); }
    })();
    if (sha) immutableCache.set(key, request);
    try { return await request; } catch (error) { immutableCache.delete(key); throw error; }
  }

  function lineup(groups) {
    return groups.map(group => group.map(unit => unit.type === 'contest' ? '(' + unit.riders.join('') + ')' : unit.riders.join('')).join('')).join('/');
  }

  function stateNode(entry, key, hasData) {
    const state = entry.data_status[key];
    if (state === 'ready' && hasData) return null;
    const labels = {ready: selected.loading ? '読込中…' : '確認済みの成績なし', missing: '未取得', pending: '一部未取得・保留', mismatch: '本人・出走の照合保留', error: '資料を確認できません', stale: '読込失敗・前回確認値を表示'};
    return node('span', 'data-state', labels[state] || '未取得');
  }

  function resultNode(result, meeting, entry) {
    const el = node('span', 'result'), date = result.race_date;
    el.append(node('span', 'result-head', (date ? date.slice(5).replace('-', '/') : '') + (result.race_number ? ' ' + result.race_number + 'R' : '') + (result.race_date_inferred ? ' 推定' : '')));
    const url = M.replayUrl(result, entry.player_id, meeting.venue_code);
    const line = node('span', 'result-rank'), rank = node(url ? 'a' : 'span', M.rankClass(result, meeting), M.rankLabel(result));
    if (url) { rank.href = url; rank.target = '_self'; rank.title = '照合済みレースの映像を開く'; }
    if (result.accident_name) rank.title = result.accident_name;
    line.append(rank, node('span', 'flags', ['start', 'home', 'back'].map((flag, i) => result[flag] === true ? 'SHB'[i] : '').join('')));
    if (M.verifiedRace(result, entry.player_id, meeting.venue_code)) {
      const rating = node('span', 'condition');
      rating.dataset.conditionKey = M.ratingKey(result.race_date, result.race_id, entry.player_id);
      line.append(rating);
    }
    el.append(line, node('span', 'result-time', result.final_half_record || ''));
    const source = result.source_url || meeting.rank_source?.url || result.result_url || '';
    const observed = result.observed_at || meeting.rank_source?.observed_at || '';
    el.title = [result.race_type, result.accident_name, source, observed, 'SHB: ' + ['start', 'home', 'back'].map((flag, i) => 'SHB'[i] + '=' + (result[flag] == null ? '不明' : result[flag] ? 'あり' : 'なし')).join(' ')].filter(Boolean).join('\n');
    return el;
  }

  function meetingsNode(meetings, entry, key) {
    const container = node('div');
    for (const meeting of meetings) {
      const block = node('div', 'meeting'), grade = meeting.grade_code;
      const title = node('span', 'meeting-title' + (grade === 3 ? ' grade-3' : grade >= 4 ? ' grade-high' : ''), meeting.venue + ' ' + meeting.start_date + (meeting.start_date_inferred ? '（初日推定）' : ''));
      const results = node('div', 'results');
      for (const result of meeting.days) results.append(resultNode(result, meeting, entry));
      block.append(title, results); container.append(block);
    }
    const state = stateNode(entry, key, meetings.some(m => m.days.length));
    if (state) container.append(state);
    return container;
  }

  function updateEntry(entry) {
    const cells = rowNodes.get(entry.entry_id);
    if (!cells) return;
    const current = {venue: entry.venue, venue_code: entry.venue_code, start_date: entry.meeting_start, days: entry.current_meeting_prior_results};
    cells.current.replaceChildren(meetingsNode(current.days.length ? [current] : [], entry, 'current'));
    if (!current.days.length && entry.data_status.current === 'ready') cells.current.textContent = '対象日より前の確認済み成績なし';
    cells.previous.replaceChildren(meetingsNode(entry.previous_meetings, entry, 'previous'));
    cells.ten.replaceChildren(meetingsNode(entry.prior_ten_meetings, entry, 'ten'));
    paintConditions();
  }

  function drawEntries() {
    elements.rows.replaceChildren(); rowNodes.clear();
    for (const entry of selected.entries) {
      const tr = node('tr'); tr.dataset.entryId = entry.entry_id;
      const race = node('td'), raceLink = node('a', '', entry.venue + ' ' + entry.race_number + 'R');
      raceLink.href = selected.index.card_href + (entry.target_date >= '2026-11-14' ? '#race-' + entry.venue_code + '-' + entry.race_number : '');
      race.append(raceLink, node('div', 'muted', entry.start_time), node('div', 'muted', entry.race_type), node('div', 'lineup', lineup(entry.groups)));
      const rider = node('th'); rider.scope = 'row';
      rider.append(node('div', 'name', entry.car_number + ' ' + entry.name + (entry.mark ? ' ' + entry.mark : '')), node('div', 'muted', entry.period + '期 / ' + (entry.prefecture || '県不明') + (entry.age != null ? ' ' + entry.age + '歳' : '')), node('div', 'muted', entry.player_id || 'JKA未照合'));
      if (entry.absent) rider.append(node('div', 'absent', '欠場'));
      if (entry.player_id) {
        const condition = node('span', 'condition');
        condition.dataset.conditionKey = M.ratingKey(entry.target_date, entry.race_id, entry.player_id);
        condition.title = '当日このレースの共有調子';
        rider.append(condition);
      }
      const stats = node('td', 'aggregate'); stats.append(node('div', '', entry.score_raw ?? '得点不明'));
      const maximum = Math.max(0, ...selected.entries.filter(p => p.race_id === entry.race_id).map(p => p.stats.s || 0));
      const s = node(entry.stats.s > 0 && entry.stats.s === maximum ? 'strong' : 'span', 'aggregate-s', 'S ' + (entry.stats.s > 0 ? entry.stats.s : ''));
      stats.append(s, node('div', 'aggregate-b', 'B ' + (entry.stats.b ?? '')), node('div', '', '逃/捲/差/マ ' + ['nige', 'makuri', 'sashi', 'mark'].map(k => entry.stats[k] ?? '').join('/')));
      const current = node('td'), previous = node('td'), ten = node('td');
      tr.append(race, rider, stats, current, previous, ten); elements.rows.append(tr);
      rowNodes.set(entry.entry_id, {tr, current, previous, ten}); updateEntry(entry);
    }
    applyFilters();
  }

  function options(select, entries, key, label) {
    select.replaceChildren(new Option(label, ''));
    const values = new Map(entries.map(entry => [String(entry[key]), key === 'venue_code' ? entry.venue : entry.race_number + 'R']));
    for (const [value, text] of values) select.append(new Option(text, value));
  }

  function applyFilters() {
    if (!selected) return;
    const query = elements.search.value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    let count = 0;
    for (const entry of selected.entries) {
      const matches = (!elements.venue.value || entry.venue_code === elements.venue.value) && (!elements.race.value || String(entry.race_number) === elements.race.value) && (!query || (entry.name + (entry.player_id || '')).normalize('NFKC').replace(/\s+/g, '').toLowerCase().includes(query));
      rowNodes.get(entry.entry_id).tr.hidden = !matches;
      if (matches) count++;
    }
    const summary = selected.index.summary;
    elements.count.textContent = '表示 ' + count + ' / 全' + summary.entries + '出走・' + summary.races + 'レース（欠場' + summary.absent + '人を含む）';
  }

  function paintConditions() {
    for (const el of elements.rows.querySelectorAll('[data-condition-key]')) {
      const value = conditions.get(el.dataset.conditionKey);
      el.textContent = value != null && value !== 0 ? String(value) : '';
    }
  }

  async function loadConditions() {
    const client = window.keirinResultsBoard?.client || window.keirinBoard?.client;
    if (!selected || selected.loading || !client || conditionBusy || document.visibilityState === 'hidden') return;
    const active = selected;
    conditionBusy = true;
    try {
      const keys = new Set();
      for (const entry of active.entries) {
        if (entry.player_id) keys.add(M.ratingKey(entry.target_date, entry.race_id, entry.player_id));
      }
      for (const row of M.resultRows(active.entries)) if (row.race_id && row.player_id && !row.race_date_inferred) keys.add(M.ratingKey(row.race_date, row.race_id, row.player_id));
      const values = await M.readConditions(client, [...keys]);
      if (selected !== active) return;
      conditions = values;
      for (const entry of active.entries) {
        entry.conditions_by_race = {};
        for (const [key, value] of values) if (key.endsWith(':' + entry.player_id)) entry.conditions_by_race[key] = value;
      }
      paintConditions(); $('condition-status').textContent = '共有の調子：確認済み（読取専用、表示中は約30秒ごとに確認）。0・未評価は空欄です。';
    } catch { $('condition-status').textContent = '共有の調子を読めません。確認済みの表示と競走成績を保持しています。'; }
    finally { conditionBusy = false; }
  }

  function setDownloads(enabled) {
    for (const id of ['json', 'riders-csv', 'results-csv']) $(id).disabled = !enabled;
    $('export-status').textContent = selected?.loading ? '全員分の成績を読込中…' : '';
  }

  async function loadDate(target, reload = false) {
    const ticket = ++sequence;
    elements.date.value = target;
    const url = new URL(location.href); url.searchParams.set('date', target.replaceAll('-', '')); history.replaceState(null, '', url);
    const day = calendar.days.find(day => day.date === target), card = $('card-link');
    if (!day) {
      selected = null; elements.rows.replaceChildren(); rowNodes.clear(); card.hidden = true; elements.count.textContent = '出走選手';
      elements.status.textContent = target + ' は未公開です。別の日のデータは表示していません。'; setDownloads(false); return;
    }
    card.href = day.href; card.hidden = false;
    selected = datesCache.get(target) || null;
    if (selected) drawEntries(); else { elements.rows.replaceChildren(); rowNodes.clear(); }
    setDownloads(false); elements.status.textContent = target + ' の全出走を確認しています…';
    try {
      if (!selected || reload) {
        const index = await readJSON('data/' + target.replaceAll('-', '') + '/all-rider-results.json');
        const entries = M.entriesFromIndex(index, target);
        if (ticket !== sequence) return;
        const old = new Map((selected?.entries || []).map(entry => [entry.entry_id, entry]));
        for (const entry of entries) {
          const saved = old.get(entry.entry_id);
          if (saved && saved.source_url === entry.source_url && saved.name === entry.name && String(saved.period) === String(entry.period)) {
            entry.previous_meetings = saved.previous_meetings; entry.prior_ten_meetings = saved.prior_ten_meetings;
          }
        }
        selected = {index, entries, loading: true}; datesCache.set(target, selected);
      }
      const active = selected; active.loading = true;
      options(elements.venue, active.entries, 'venue_code', '全場'); options(elements.race, active.entries, 'race_number', '全R');
      drawEntries(); setDownloads(false);
      elements.status.textContent = target + ' / 全' + active.entries.length + '出走を表示。保存済み成績を読込中…';
      await M.hydrate(active.entries, active.index, readJSON, entry => { if (ticket === sequence) updateEntry(entry); });
      active.loading = false;
      if (ticket !== sequence) return;
      for (const entry of active.entries) updateEntry(entry);
      const pending = active.entries.filter(e => ['previous', 'ten'].some(k => e.data_status[k] !== 'ready')).length;
      elements.status.textContent = target + ' / 全' + active.entries.length + '出走。成績を確認しました' + (pending ? '（不足・照合保留 ' + pending + '人）' : '') + '。';
      setDownloads(true); loadConditions();
    } catch (error) {
      if (ticket !== sequence) return;
      elements.status.textContent = target + ' の一覧を確認できません。' + (selected ? '前回確認した全出走・成績を表示しています。' : '日別出走表をご利用ください。');
      setDownloads(Boolean(selected && !selected.loading));
    }
  }

  function download(kind) {
    if (!selected || selected.loading) return;
    const entries = selected.entries;
    let text, name, type;
    if (kind === 'json') {
      const {races, ...meta} = selected.index;
      text = JSON.stringify({...meta, exported_at: new Date().toISOString(), entries}, null, 2);
      name = 'all-rider-results.json'; type = 'application/json;charset=utf-8';
    } else if (kind === 'riders-csv') {
      text = M.csv(M.RIDER_COLUMNS, entries); name = 'riders.csv'; type = 'text/csv;charset=utf-8';
    } else {
      text = M.csv(M.RESULT_COLUMNS, M.resultRows(entries, conditions)); name = 'results.csv'; type = 'text/csv;charset=utf-8';
    }
    const url = URL.createObjectURL(new Blob([text], {type})), link = node('a');
    link.href = url; link.download = selected.index.target_date.replaceAll('-', '') + '-' + name;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('filters').addEventListener('submit', event => event.preventDefault());
  elements.date.addEventListener('change', () => { if (elements.date.value) loadDate(elements.date.value); });
  $('today').addEventListener('click', () => loadDate(M.jstToday()));
  $('reload').addEventListener('click', async () => {
    try { calendar = await readJSON('calendar/dates.json'); await loadDate(elements.date.value, true); }
    catch { elements.status.textContent = '公開日の再確認に失敗しました。確認済みの表示を保持しています。'; }
  });
  for (const el of [elements.venue, elements.race, elements.search]) el.addEventListener('input', applyFilters);
  for (const id of ['json', 'riders-csv', 'results-csv']) $(id).addEventListener('click', () => download(id));
  window.addEventListener('keirin-results-board-ready', loadConditions);
  document.addEventListener('visibilitychange', loadConditions);
  setInterval(loadConditions, 30000);
  (async () => {
    try {
      const target = M.requestedDate(new URL(location.href).searchParams.get('date'));
      calendar = await readJSON('calendar/dates.json');
      await loadDate(target);
      const script = node('script'); script.src = new URL('daily-results/board-client.js', base).href; document.body.append(script);
    } catch (error) { elements.status.textContent = error.message || '公開日を確認できません。時間をおいて再読込してください。'; }
  })();
})();
