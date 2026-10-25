// Current-page reader; historical pages keep their existing odds.js.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root) return;
  let configPromise;
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  async function endpoint(signal) {
    if (!configPromise) {
      configPromise = fetch(new URL('odds-config.json', document.baseURI).href, {cache: 'no-store', signal})
        .then(response => { if (!response.ok) throw new Error('config'); return response.json(); })
        .catch(error => { configPromise = null; throw error; });
    }
    const config = await configPromise;
    if (!config.endpoint) return null;
    const url = new URL(config.endpoint, document.baseURI);
    if (url.protocol !== 'https:' && url.origin !== location.origin) throw new Error('endpoint');
    if (url.username || url.password) throw new Error('endpoint');
    return url;
  }
  function validate(data, raceKey, numbers) {
    if (data.race_key !== raceKey || data.bet_type !== 'exacta') throw new Error('race');
    if (!data || !['open', 'snapshot', 'closed', 'unavailable'].includes(data.status)) throw new Error('status');
    if (!['open', 'snapshot'].includes(data.status)) return data;
    const observed = Date.parse(data.observed_at);
    if (!Number.isFinite(observed) || !/(?:Z|[+-]\d\d:\d\d)$/.test(data.observed_at) || observed > Date.now() + 60000) throw new Error('time');
    if (!Array.isArray(data.odds) || data.odds.length !== numbers.length * (numbers.length - 1)) throw new Error('incomplete');
    const seen = new Set();
    for (const item of data.odds) {
      if (!numbers.includes(item.first) || !numbers.includes(item.second) || item.first === item.second) throw new Error('pair');
      const key = item.first + '-' + item.second;
      if (seen.has(key)) throw new Error('duplicate');
      seen.add(key);
      if (item.value !== null && (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value <= 0)) throw new Error('odds');
    }
    return data;
  }
  function normalizeSavedSnapshot(data) { return data; }
  function readSnapshot(payload, raceKey, numbers) {
    const candidate = Array.isArray(payload?.results)
      ? normalizeSavedSnapshot(payload.results.find(item => item.ok && item.snapshot?.race_key === raceKey)?.snapshot)
      : payload;
    return validate(candidate || {race_key:raceKey,bet_type:'exacta',status:'unavailable'}, raceKey, numbers);
  }
  const formatOdds = value => value >= 100 ? String(Math.floor(value)) : value.toFixed(1);
  const shadeClass = value => value >= 300 ? ' exacta-extreme' : value >= 200 ? ' exacta-very-high' : value >= 100 ? ' exacta-high' : '';
  function matrix(data, numbers, names, scores) {
    const values = new Map(data.odds.map(item => [item.first + '-' + item.second, item.value]));
    const minimums = new Map();
    for (const {first, value} of data.odds) {
      if (value !== null && (!minimums.has(first) || value < minimums.get(first))) minimums.set(first, value);
    }
    const combinedOdds = new Map(numbers.map(first => {
      const prices = numbers.filter(second => second !== first).map(second => values.get(first + '-' + second));
      // Equal payout uses inverse-odds stakes without ticket-unit rounding.
      // A missing quote prevents an all-combinations calculation.
      return [first, prices.every(price => typeof price === 'number')
        ? 1 / prices.reduce((sum, price) => sum + 1 / price, 0) : null];
    }));
    const favorite = Math.min(...[...combinedOdds.values()].filter(value => value !== null));
    const table = element('table', 'exacta-matrix');
    table.dataset.observedAt = data.observed_at;
    table.append(element('caption', '', '二車単 · 列1着／行2着 · 得点／単勝想定'));
    const columns = element('colgroup');
    columns.append(element('col', 'exacta-label-column'));
    for (const number of numbers) columns.append(element('col', 'exacta-value-column'));
    columns.append(element('col', 'exacta-label-column'));
    table.append(columns);
    function rider(number, orientation) {
      const label = element('span', 'exacta-rider exacta-' + orientation + '-rider');
      const name = names.get(number) || '';
      label.title = number + ' ' + name;
      if (orientation === 'column') {
        const originalScore = scores.get(number);
        const score = element('span', 'exacta-score ' + (originalScore?.className || 'score'), originalScore?.value || '—');
        score.title = number + ' ' + name + 'の競走得点（出走表と同じ表示）';
        label.append(score);
        const combined = combinedOdds.get(number);
        const summary = element('span', 'exacta-synthetic' + (combined === null ? '' : shadeClass(combined)) +
          (combined === favorite ? ' exacta-favorite' : ''), combined === null ? '—' : formatOdds(combined));
        summary.title = number + ' ' + name + 'の1着固定・2着全通り。払戻金がそろうように賭け金を配分した理論上の合成倍率（100円単位への丸めなし）。' +
          (combined === null ? '未発売・対象外の組合せがあるため計算しません。' : '計算式：1 ÷ Σ(1 ÷ 二車単オッズ)。実売の単勝オッズではありません。');
        summary.setAttribute('aria-label', number + '番の理論合成オッズ ' + (combined === null ? '計算不可' : formatOdds(combined) + '倍'));
        label.append(summary);
      }
      label.append(element('span', 'exacta-number c' + number, number));
      if (orientation === 'column') label.append(element('span', 'exacta-rider-name', [...name].slice(0, 4).join('')));
      else label.setAttribute('aria-label', '2着：' + number + ' ' + name);
      return label;
    }
    const thead = element('thead');
    const heading = element('tr');
    heading.append(element('th', 'exacta-corner', '2着'));
    for (const number of numbers) {
      const th = element('th');
      th.append(rider(number, 'column'));
      heading.append(th);
    }
    const mirrorHeading = element('th', 'exacta-corner', '2着');
    mirrorHeading.setAttribute('aria-hidden', 'true');
    heading.append(mirrorHeading);
    for (const th of heading.children) th.scope = 'col';
    thead.append(heading);
    table.append(thead);
    const tbody = element('tbody');
    for (const second of numbers) {
      const row = element('tr');
      const th = element('th');
      th.scope = 'row';
      th.append(rider(second, 'row'));
      row.append(th);
      for (const first of numbers) {
        const value = values.get(first + '-' + second);
        const text = first === second ? '·' : value === null ? '—' : formatOdds(value);
        const td = element('td', first === second ? 'exacta-diagonal' : 'exacta-value', text);
        if (first !== second) {
          td.dataset.combination = first + '-' + second;
          td.title = first + ' ' + (names.get(first) || '') + ' → ' + second + ' ' + (names.get(second) || '') + '：' + (value === null ? '未発売・対象外' : value.toFixed(1) + '倍');
          if (value === null) td.classList.add('exacta-unavailable');
          else {
            if (value < 10) td.classList.add('exacta-low');
            const shade = shadeClass(value).trim();
            if (shade) td.classList.add(shade);
            if (value === minimums.get(first)) td.classList.add('exacta-minimum');
          }
          if (text.length >= 6) td.classList.add('exacta-long');
        }
        row.append(td);
      }
      const mirror = element('th');
      mirror.setAttribute('aria-hidden', 'true');
      mirror.append(rider(second, 'mirror'));
      row.append(mirror);
      tbody.append(row);
    }
    table.append(tbody);
    return table;
  }

  function raceInfo(row) {
    const link = row.querySelector('td.race .race-link');
    const lineup = row.querySelector('.lineup-cell');
    if (!link || !lineup) return null;
    const raceKey = new URL(link.href).pathname;
    const numbers = [...new Set([...row.querySelectorAll('.car')].map(car => Number(car.textContent)))].sort((a,b) => a-b);
    const race = typeof races === 'undefined' ? null : races.find(race => new URL(race.source).pathname === raceKey);
    const names = new Map(race ? race.players.map(player => [player.no, player.name]) :
      [...row.querySelectorAll('.rider')].map(rider => [Number(rider.querySelector('.car')?.textContent), rider.querySelector('.name')?.textContent || '']));
    const scores = new Map([...row.querySelectorAll('.rider')].map(rider => {
      const score = rider.querySelector('.score');
      return [Number(rider.querySelector('.car')?.textContent), {value: score?.textContent, className: score?.className}];
    }));
    return {lineup, raceKey, numbers, names, scores};
  }

  // The initial summary and opened tables share validation, orientation and math.
  window.keirinExacta = Object.freeze({
    async loadSavedFeed(signal) {
      const url = await endpoint(signal);
      if (!url) return null;
      const response = await fetch(url.href, {cache:'no-store', signal});
      if (!response.ok) throw new Error('fetch');
      return response.json();
    },
    matrixForRow(payload, row) {
      const info = raceInfo(row);
      if (!info) return null;
      const data = readSnapshot(payload, info.raceKey, info.numbers);
      if (!['open','snapshot'].includes(data.status) || !data.odds.some(item => item.value !== null)) return null;
      return matrix(data, info.numbers, info.names, info.scores);
    }
  });

  function attach(row, index) {
    if (row.querySelector('.odds-toggle')) return;
    const info = raceInfo(row);
    if (!info) return;
    const {lineup, raceKey, numbers, names, scores} = info;
    const clearSummary = () => row.dispatchEvent(new CustomEvent('keirin-exacta-unavailable', {bubbles:true}));
    const button = element('button', 'odds-toggle', '二車単オッズ');
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    const panel = element('td', 'odds-cell');
    panel.id = 'exacta-panel-' + index;
    panel.style.setProperty('--exacta-width', (36 + numbers.length * 30) + 'px');
    panel.hidden = true;
    button.setAttribute('aria-controls', panel.id);
    const heading = element('strong', 'odds-heading', '二車単オッズ');
    const refresh = element('button', 'odds-refresh', '更新');
    refresh.type = 'button';
    refresh.setAttribute('aria-label', '二車単オッズを更新');
    const status = element('p', 'odds-status');
    status.setAttribute('role', 'status');
    const content = element('div', 'odds-content');
    panel.append(heading, refresh, status, content);
    lineup.append(button);
    row.append(panel);
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      refresh.disabled = true;
      content.replaceChildren();
      status.textContent = '二車単オッズを確認中にゃ…';
      panel.setAttribute('aria-busy', 'true');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const url = await endpoint(controller.signal);
        if (!url) {
          status.textContent = 'オッズはまだ表示できないにゃ。取得先を確認中にゃ。';
          clearSummary();
          return;
        }
        url.searchParams.set('race_key', raceKey);
        url.searchParams.set('bet_type', 'exacta');
        const response = await fetch(url.href, {cache: 'no-store', signal: controller.signal});
        if (!response.ok) throw new Error('fetch');
        const payload = await response.json();
        const data = readSnapshot(payload, raceKey, numbers);
        if (data.status === 'closed') status.textContent = 'このレースのオッズ発売は終了しているにゃ。';
        else if (data.status === 'unavailable') status.textContent = 'このレースのオッズはまだ取得できないにゃ。';
        else {
          const formatted = new Intl.DateTimeFormat('ja-JP', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo'}).format(new Date(data.observed_at));
          status.textContent = '取得時刻：' + formatted + (data.status === 'snapshot' ? '（保存値）' : '（変動あり）');
          status.title = data.status === 'snapshot' ? '取得時点の保存値です。現在の発売状態は未確認です。' : 'オッズは変動します。';
          content.append(matrix(data, numbers, names, scores));
        }
        if (!['open','snapshot'].includes(data.status)) clearSummary();
      } catch (error) {
        status.textContent = 'オッズを取得できなかったにゃ。「更新」で再確認してにゃ。';
        clearSummary();
      } finally {
        clearTimeout(timeout);
        loading = false;
        refresh.disabled = false;
        panel.removeAttribute('aria-busy');
      }
    }
    button.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      row.classList.toggle('odds-open', open);
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'オッズを閉じる' : '二車単オッズ';
      if (open) load();
    });
    refresh.addEventListener('click', load);
  }
  const attachAll = () => [...root.children].forEach(attach);
  attachAll();
  new MutationObserver(attachAll).observe(root, {childList: true});
})();
