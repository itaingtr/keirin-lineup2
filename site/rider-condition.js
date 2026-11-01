(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || typeof races === 'undefined') return;
  const PREFIX = 'condition:v1:';
  const expected = new Map();
  const dates = new Set();
  const saved = new Map();
  const drafts = new Map();
  const queues = new Map();
  let loading = false;
  let loaded = false;
  let revision = 0;
  let acknowledgement = 0;

  const note = document.createElement('p');
  note.className = 'condition-note';
  note.append('車番を押すと調子が ', Object.assign(document.createElement('strong'), {textContent: '1 → 2 → 3 → 4 → 5 → 1'}), '。5が一番よい調子にゃ。緑の数字は皆で共有し、翌日の着順の横にも残るにゃ。');
  const status = document.createElement('span');
  status.className = 'condition-message';
  status.setAttribute('role', 'status');
  note.append(status);
  root.closest('.table-wrap').before(note);

  const keyFor = (date, raceId, playerId) => PREFIX + date + ':' + raceId + ':' + playerId;
  for (const race of races) for (const player of race.players) {
    if (!/^\d{1,12}$/.test(player.playerId || '')) continue;
    const id = String(race.race).padStart(2, '0') + race.venueCode + conditionDate.replaceAll('-', '');
    expected.set(keyFor(conditionDate, id, player.playerId), {race, player});
    dates.add(conditionDate);
    for (const result of player.meetingResults || []) {
      expected.set(keyFor(result.race_date, result.race_id, player.playerId), {race, player});
      dates.add(result.race_date);
    }
  }
  const sortedDates = [...dates].sort();
  const lastDay = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00Z');
  lastDay.setUTCDate(lastDay.getUTCDate() + 1);
  const upperDate = lastDay.toISOString().slice(0, 10);
  const board = () => window.keirinBoard;
  const valueFor = key => drafts.get(key)?.value ?? saved.get(key)?.value;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  }

  function paint() {
    for (const element of root.querySelectorAll('.condition-today, .condition-history')) {
      const key = keyFor(element.dataset.raceDate, element.dataset.raceId, element.dataset.playerId);
      const value = expected.has(key) ? valueFor(key) : undefined;
      element.textContent = value || '';
      element.title = value ? '調子 ' + value + ' / 5' : '未評価';
      element.setAttribute('aria-label', value ? '調子 ' + value + ' / 5' : '調子は未評価');
      element.classList.toggle('is-saving', drafts.has(key));
    }
    for (const car of root.querySelectorAll('.condition-car')) {
      const key = keyFor(car.dataset.raceDate, car.dataset.raceId, car.dataset.playerId);
      const value = valueFor(key);
      car.setAttribute('aria-label', car.dataset.playerName + 'の調子 ' + (value || '未評価') + '。押すと' + ((value || 0) % 5 + 1));
    }
  }

  async function load() {
    const connection = board();
    if (!connection?.ready || loading) return;
    loading = true;
    const startedAtAcknowledgement = acknowledgement;
    try {
      const values = new Map();
      for (let offset = 0; ; offset += 1000) {
        const {data, error} = await connection.client.from('race_comments')
          .select('id, race_key, body, created_at')
          .like('race_key', PREFIX + '%')
          .gte('race_key', PREFIX + sortedDates[0] + ':')
          .lt('race_key', PREFIX + upperDate + ':')
          .order('created_at', {ascending: false}).order('id', {ascending: false})
          .range(offset, offset + 999);
        if (error) throw error;
        for (const item of data || []) {
          if (!expected.has(item.race_key) || values.has(item.race_key) || !/^[1-5]$/.test(item.body)) continue;
          values.set(item.race_key, {value: Number(item.body), createdAt: item.created_at});
        }
        if (!data || data.length < 1000) break;
      }
      for (const [key, value] of saved) {
        if ((value.acknowledgement || 0) > startedAtAcknowledgement) values.set(key, value);
      }
      saved.clear();
      for (const [key, value] of values) saved.set(key, value);
      loaded = true;
      paint();
    } catch (_) {
      message('調子を読み込めなかったにゃ。再読み込みしてにゃ', true);
    } finally {
      loading = false;
    }
  }

  function flush(key, sentRevision) {
    const previous = queues.get(key) || Promise.resolve();
    const queued = previous.catch(() => {}).then(async () => {
      const draft = drafts.get(key);
      if (!draft || draft.revision !== sentRevision) return;
      const connection = board();
      if (!connection?.canWrite || !connection.user || connection.user.id !== draft.userId) {
        drafts.delete(key); paint(); return;
      }
      const value = draft.value;
      try {
        const {data, error} = await connection.client.from('race_comments').insert({
          race_key: key, body: String(value), user_id: connection.user.id,
        }).select('id, race_key, body, created_at').single();
        if (error || !data || data.race_key !== key || data.body !== String(value)) throw error || new Error('Save was not confirmed');
        saved.set(key, {value, createdAt: data.created_at, acknowledgement: ++acknowledgement});
        if (drafts.get(key)?.revision === sentRevision) drafts.delete(key);
        paint();
        message('調子 ' + value + ' を保存したにゃ');
      } catch (_) {
        if (drafts.get(key)?.revision === sentRevision) drafts.delete(key);
        paint();
        message('保存できなかったにゃ。接続を確認して、もう一度押してにゃ', true);
      }
    });
    queues.set(key, queued);
    queued.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
  }

  root.addEventListener('click', event => {
    const car = event.target.closest('.condition-car');
    if (!car || !root.contains(car)) return;
    event.preventDefault();
    const connection = board();
    if (!connection?.canWrite || !connection.user) {
      message('合言葉でログインすると、調子を付けられるにゃ');
      connection?.requestLogin();
      return;
    }
    if (!loaded) { message('調子を読み込み中にゃ。少し待ってから押してにゃ'); return; }
    const key = keyFor(car.dataset.raceDate, car.dataset.raceId, car.dataset.playerId);
    if (!expected.has(key)) return;
    const prior = drafts.get(key);
    if (prior) clearTimeout(prior.timer);
    const draft = {value: (valueFor(key) || 0) % 5 + 1, revision: ++revision, userId: connection.user.id};
    draft.timer = setTimeout(() => flush(key, draft.revision), 650);
    drafts.set(key, draft);
    message('調子を保存中にゃ…');
    paint();
  });
  new MutationObserver(paint).observe(root, {childList: true});
  window.addEventListener('keirin-board-state', () => {
    if (!board()?.canWrite) {
      for (const draft of drafts.values()) clearTimeout(draft.timer);
      drafts.clear();
      paint();
    }
    load();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  paint();
  load();
})();
