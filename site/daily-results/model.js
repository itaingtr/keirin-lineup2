/* Date-bound display data only; no collectors, DOM scraping or database writes. */
(function (root) {
  'use strict';
  const requireValue = (value, message) => { if (!value) throw new Error(message); };
  const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
  const iso = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const ratingKey = (date, race, player) => 'condition:v1:' + date + ':' + race + ':' + player;
  const normalizedResult = (result, playerId) => ({...result, player_id: result.player_id ?? playerId,
    race_id: result.race_id ?? null, race_number: result.race_number ?? null,
    final_half_record: result.final_half_record ?? null,
    start: result.start ?? null, home: result.home ?? null, back: result.back ?? null});

  function jstToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
  }

  function requestedDate(value, now) {
    if (value === null || value === undefined) return jstToday(now);
    const normalized = /^\d{8}$/.test(value) ? value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6) : value;
    requireValue(iso(normalized), '日付はYYYYMMDDまたはYYYY-MM-DDで指定してください');
    return normalized;
  }

  function entriesFromIndex(index, target) {
    requireValue(index?.schema_version === 1 && index.kind === 'all_rider_results' && index.target_date === target && index.timezone === 'Asia/Tokyo', '一覧の日付が一致しません');
    requireValue(Array.isArray(index.races), '出走表を確認できません');
    const entries = [], seen = new Set(), races = new Set();
    for (const race of index.races) {
      requireValue(/^\d{12}$/.test(race.race_id) && race.race_id.slice(4) === target.replaceAll('-', '') && race.race_id.slice(2, 4) === race.venue_code && Number(race.race_id.slice(0, 2)) === race.race_number && !races.has(race.race_id), '出走レースが一致しません');
      races.add(race.race_id);
      const {players, ...metadata} = race, cars = new Set();
      for (const player of players) {
        const suffix = player.player_id || 'unidentified-car-' + player.car_number;
        requireValue(player.entry_id === target + ':' + race.race_id + ':' + suffix && !seen.has(player.entry_id) && !cars.has(player.car_number), '出走選手が重複しています');
        requireValue(player.player_id === null || /^\d{6}$/.test(player.player_id), 'JKA番号を確認できません');
        seen.add(player.entry_id); cars.add(player.car_number);
        entries.push({...player, ...metadata, current_meeting_prior_results: player.current_meeting_prior_results.map(result => normalizedResult(result, player.player_id)), target_date: target, data_status: {...player.data_status}, previous_meetings: [], prior_ten_meetings: [], conditions_by_race: {}});
      }
    }
    requireValue(entries.length === index.summary.entries && races.size === index.summary.races, '全出走件数が一致しません');
    return entries;
  }

  function verifiedRace(result, playerId, venueCode) {
    return /^\d{6}$/.test(playerId || '') && result.player_id === playerId && iso(result.race_date) && !result.race_date_inferred && /^\d{12}$/.test(result.race_id || '') && result.race_id.slice(4) === result.race_date.replaceAll('-', '') && (!venueCode || result.race_id.slice(2, 4) === venueCode) && Number.isInteger(result.race_number) && result.race_number >= 1 && result.race_number <= 12 && Number(result.race_id.slice(0, 2)) === result.race_number;
  }

  function replayUrl(result, playerId, venueCode) {
    if (!verifiedRace(result, playerId, venueCode) || !result.video_url || result.unavailable) return null;
    try {
      const url = new URL(result.video_url), q = url.searchParams;
      const code = result.race_id.slice(2, 4), date = result.race_date.replaceAll('-', '');
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !['keirin.kdreams.jp', 'my.keirin.kdreams.jp'].includes(url.hostname) || url.pathname !== '/stadium/digest/' || q.get('kyogijoCd') !== code || q.get('kaisaiDate') !== date || Number(q.get('raceNo')) !== result.race_number || !/^[1-6]$/.test(q.get('gradeCd') || '')) return null;
      return 'https://wm.st.keirin.jp/wm-keirin' + code + '/' + date + '-' + code + '-' + q.get('gradeCd').padStart(2, '0') + '-' + String(result.race_number).padStart(2, '0') + '-01-00.mp4';
    } catch { return null; }
  }

  function rankClass(result, meeting = {}) {
    const kind = compact(result.race_type);
    if (result.semifinal_rank || /準決勝(?:戦)?$/.test(kind)) return 'rank-semifinal';
    if (result.highlight_rank || /初日特選|初特選|初特/.test(kind) || /決勝(?:戦)?$/.test(kind) && !kind.includes('準') || result.meeting_day === 1 && !meeting.start_date_inferred && kind.endsWith('特選')) return 'rank-important';
    return '';
  }

  function rankLabel(result) {
    if (result.unavailable) return '未取得';
    if (result.accident) return result.accident;
    if (result.order > 0) return String(result.order);
    return result.accident_name || (result.has_accident ? '事故' : '不明');
  }

  function validateMeetings(meetings, entry, limit) {
    requireValue(Array.isArray(meetings) && meetings.length <= limit, '場所数を確認できません');
    let previousEnd = null, previousStart = null;
    for (const meeting of meetings) {
      requireValue(iso(meeting.start_date) && meeting.start_date < entry.meeting_start && /^\d{2}$/.test(meeting.venue_code || '') && typeof meeting.venue === 'string' && Array.isArray(meeting.days), '開催情報が一致しません');
      requireValue(!previousStart || previousStart < meeting.start_date, '開催順が一致しません');
      let last = null;
      for (const result of meeting.days) {
        requireValue(iso(result.race_date) && result.race_date >= meeting.start_date && result.race_date < entry.meeting_start && (!last || last <= result.race_date) && (result.player_id === undefined || result.player_id === entry.player_id), '過去成績の選手または日付が一致しません');
        if (result.race_id) requireValue(verifiedRace({...result, race_date_inferred: false, player_id: result.player_id || entry.player_id}, entry.player_id, meeting.venue_code), '過去レースが一致しません');
        for (const flag of ['start', 'home', 'back']) requireValue(result[flag] == null || typeof result[flag] === 'boolean', 'SHBを確認できません');
        last = result.race_date;
      }
      requireValue(!previousEnd || !meeting.days.length || previousEnd < meeting.days[0].race_date, '成績の日付が重複しています');
      previousEnd = last; previousStart = meeting.start_date;
    }
    return meetings.map(meeting => ({...meeting, days: meeting.days.map(result => normalizedResult(result, entry.player_id))}));
  }

  function previousFor(data, entry) {
    requireValue(data?.schema_version === 1 && data.target_date === entry.target_date, '前回資料の日付が違います');
    const races = data.races.filter(r => r.source_url === entry.source_url);
    requireValue(races.length === 1, '前回資料のレースが違います');
    const players = races[0].players.filter(p => p.no === entry.car_number && p.name === entry.name && String(p.period) === String(entry.period) && p.player_id === entry.player_id);
    requireValue(players.length === 1, '前回資料の本人を確認できません');
    return validateMeetings(players[0].meetings, entry, 2);
  }

  async function hydrate(entries, index, readJSON, onChange = () => {}) {
    const allowedPrevious = new Map(index.races.flatMap(r => r.players).map(p => [p.entry_id, p.data_status.previous]));
    const previous = (async () => {
      if (!index.assets.previous) return;
      try {
        const ref = index.assets.previous, data = await readJSON(ref.path, ref.sha256);
        for (const entry of entries) {
          if (!['ready', 'pending'].includes(allowedPrevious.get(entry.entry_id))) continue;
          try {
            entry.previous_meetings = previousFor(data, entry);
            entry.data_status.previous = entry.previous_meetings.length ? 'ready' : 'pending';
          } catch { entry.data_status.previous = entry.previous_meetings.length ? 'stale' : 'error'; }
          onChange(entry);
        }
      } catch {
        for (const entry of entries) {
          entry.data_status.previous = entry.previous_meetings.length ? 'stale' : 'error';
          onChange(entry);
        }
      }
    })();
    const cache = new Map(), queue = entries.filter(entry => entry.history_ref);
    async function worker() {
      while (queue.length) {
        const entry = queue.shift(), ref = entry.history_ref, key = ref.path + ':' + ref.sha256;
        try {
          requireValue(new RegExp('^rider-history/' + entry.player_id + '/[a-f0-9]{64}\\.json$').test(ref.path) && ref.path.endsWith('/' + ref.sha256 + '.json'), '参照先を確認できません');
          if (!cache.has(key)) cache.set(key, readJSON(ref.path, ref.sha256));
          const data = await cache.get(key);
          requireValue(data.schema_version === 1 && data.player_id === entry.player_id && data.name === entry.name && String(data.period) === String(entry.period), '成績の本人情報が違います');
          entry.prior_ten_meetings = validateMeetings(data.meetings, entry, 10);
          entry.data_status.ten = entry.data_status.ten === 'pending' ? 'pending' : data.meetings.length ? 'ready' : 'pending';
        } catch { entry.data_status.ten = entry.prior_ten_meetings.length ? 'stale' : 'error'; }
        onChange(entry);
      }
    }
    await Promise.all([previous, ...Array.from({length: 4}, worker)]);
    return entries;
  }

  function* resultRows(entries, conditions = new Map()) {
    for (const entry of entries) {
      const categories = [
        ['current', [{venue: entry.venue, venue_code: entry.venue_code, start_date: entry.meeting_start, days: entry.current_meeting_prior_results}]],
        ['previous', entry.previous_meetings], ['ten', entry.prior_ten_meetings],
      ];
      for (const [category, meetings] of categories) for (const [position, meeting] of meetings.entries()) for (const [slot, result] of meeting.days.entries()) {
        const identified = verifiedRace(result, entry.player_id, meeting.venue_code);
        const key = identified ? ratingKey(result.race_date, result.race_id, entry.player_id) : null;
        const source = meeting.rank_source || {};
        yield {target_date: entry.target_date, entry_id: entry.entry_id, player_id: entry.player_id, name: entry.name,
          entry_venue: entry.venue, entry_venue_code: entry.venue_code, entry_race: entry.race_number, entry_car: entry.car_number,
          category, meeting_position: meeting.position || position + 1, meeting_start: meeting.start_date,
          meeting_day: result.meeting_day, slot: result.slot ?? slot + 1, result_venue: meeting.venue,
          result_venue_code: meeting.venue_code, race_date: result.race_date, race_number: result.race_number,
          race_id: result.race_id, order: result.order, accident: result.accident, accident_name: result.accident_name,
          has_accident: result.has_accident, final_half_record: result.final_half_record,
          start: result.start, home: result.home, back: result.back, condition: key ? conditions.get(key) ?? null : null,
          race_date_inferred: result.race_date_inferred, start_date_inferred: meeting.start_date_inferred,
          unavailable: result.unavailable, provider: result.provider || meeting.provider || source.provider,
          source_url: result.source_url || source.url, observed_at: result.observed_at || source.observed_at,
          video_url: replayUrl(result, entry.player_id, meeting.venue_code), source_video_url: result.video_url,
          result_url: result.result_url, race_type: result.race_type, flag_sources: result.flag_sources,
          provenance: result};
      }
    }
  }

  const csvValue = value => {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  function csv(columns, rows) {
    const escape = value => '"' + csvValue(value).replaceAll('"', '""') + '"';
    return '\uFEFF' + [columns.map(escape).join(','), ...Array.from(rows, row => columns.map(key => escape(row[key])).join(','))].join('\r\n') + '\r\n';
  }
  const RIDER_COLUMNS = ['target_date', 'entry_id', 'player_id', 'name', 'venue', 'venue_code', 'race_number', 'car_number', 'period', 'prefecture', 'age', 'score_raw', 'mark', 'absent', 'stats', 'groups', 'source_url', 'identity_source', 'data_status'];
  const RESULT_COLUMNS = ['target_date', 'entry_id', 'player_id', 'name', 'entry_venue', 'entry_venue_code', 'entry_race', 'entry_car', 'category', 'meeting_position', 'meeting_start', 'meeting_day', 'slot', 'result_venue', 'result_venue_code', 'race_date', 'race_number', 'race_id', 'order', 'accident', 'accident_name', 'has_accident', 'final_half_record', 'start', 'home', 'back', 'condition', 'race_date_inferred', 'start_date_inferred', 'unavailable', 'provider', 'source_url', 'observed_at', 'video_url', 'source_video_url', 'result_url', 'race_type', 'flag_sources', 'provenance'];

  async function readConditions(client, keys) {
    const values = new Map(), expected = new Set(keys);
    for (let i = 0; i < keys.length; i += 50) for (let offset = 0; ; offset += 1000) {
      const {data, error} = await client.from('race_comments').select('id,race_key,body,created_at').in('race_key', keys.slice(i, i + 50))
        .order('created_at', {ascending: false}).order('id', {ascending: false}).range(offset, offset + 999);
      if (error) throw error;
      for (const row of data || []) if (expected.has(row.race_key) && !values.has(row.race_key) && /^(?:-2|-1|[0-5])$/.test(row.body)) values.set(row.race_key, Number(row.body));
      if (!data || data.length < 1000) break;
    }
    return values;
  }

  const api = {jstToday, requestedDate, entriesFromIndex, verifiedRace, replayUrl, rankClass, rankLabel, previousFor, hydrate, resultRows, csv, RIDER_COLUMNS, RESULT_COLUMNS, readConditions, ratingKey};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DailyResults = api;
})(typeof window === 'object' ? window : globalThis);
