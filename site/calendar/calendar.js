(() => {
  'use strict';
  const GRADES = ['GP', 'G1', 'G2', 'G3', 'F1'];
  const F1_COLORS = ['blue', 'yellow', 'green', 'orange', 'pink', 'purple', 'mint', 'peach'];
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const $ = id => document.getElementById(id);
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const utc = iso => new Date(iso + 'T00:00:00Z');
  const iso = date => date.toISOString().slice(0, 10);
  const shift = (day, n) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const tomorrow = shift(today, 1);
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  let schedule, links, months = [], fixedMonths = new Set(), selected, entries = new Map(), verified = new Map(), assignments = new Map(), colors = new Map();

  function check(condition, message) { if (!condition) throw new Error(message); }
  function publicHref(href) {
    check(typeof href === 'string' && /^\/keirin-lineup2\/line\d{8}\.html(?:#race-\d{2}-\d{1,2})?$/.test(href), '出走表リンクの形式を確認できませんでした。');
    return href;
  }
  function validate(data, dates) {
    check(data.schema_version === 1 && Array.isArray(data.meetings) && data.meetings.length && Array.isArray(data.monthly_coverage), '開催予定の形式を確認できませんでした。');
    check(dates.schema_version === 1 && Array.isArray(dates.days), '日別リンク一覧の形式を確認できませんでした。');
    const ids = new Set();
    for (const m of data.meetings) {
      check(GRADES.includes(m.grade) && /^\d{2}$/.test(m.code) && typeof m.venue === 'string' && m.venue.length > 0 && !ids.has(m.id), '開催情報を確認できませんでした。');
      check(/^\d{4}-\d{2}-\d{2}$/.test(m.start) && /^\d{4}-\d{2}-\d{2}$/.test(m.end) && m.start <= m.end && (utc(m.end) - utc(m.start)) / 86400000 <= 5 && iso(utc(m.start)) === m.start && iso(utc(m.end)) === m.end, '開催日の形式を確認できませんでした。');
      ids.add(m.id);
    }
    for (const d of dates.days) {
      publicHref(d.href);
      check(/^\d{4}-\d{2}-\d{2}$/.test(d.date) && Array.isArray(d.venues), '掲載日の形式を確認できませんでした。');
      for (const v of d.venues) { publicHref(v.href); if (v.last_href) publicHref(v.last_href); }
    }
  }
  function rangeMonths(first, last) {
    const output = []; let d = utc(first + '-01');
    while (iso(d).slice(0, 7) <= last) { output.push(iso(d).slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
    return output;
  }
  function monthShift(month, offset) {
    const day = utc(month + '-01'); day.setUTCMonth(day.getUTCMonth() + offset);
    return iso(day).slice(0, 7);
  }
  const monthLabel = month => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
  const monthHref = month => fixedMonths.has(month) ? './'+month.replace('-', '')+'.html' : './index.html?month='+month;
  function assignmentHref(record, meeting) {
    const match = typeof record.href === 'string' && /^https:\/\/keirin\.kdreams\.jp\/[a-z]+\/assen\/(\d{2})(\d{8})\/$/.exec(record.href);
    check(match && match[1] === meeting.code && match[2] === meeting.start.replaceAll('-', '')
      && record.code === meeting.code && record.venue === meeting.venue && record.start === meeting.start
      && record.end === meeting.end && record.http_status === 200, 'あっせん情報の開催を確認できませんでした。');
    return record.href;
  }
  function venueLink(day, meeting) {
    const d = entries.get(day);
    const venue = d?.venues.find(v => v.code === meeting.code);
    if (day > tomorrow || (day > today && !venue)) {
      const planned = assignments.get(meeting.id);
      return planned ? {href: planned.href, kind: 'entries'} : null;
    }
    // Use an actual published card through tomorrow; never guess a date URL.
    if (!venue) return null;
    const checked = verified.get(day)?.venues.find(v => v.code === meeting.code && v.meeting_start === meeting.start);
    if (checked?.anchored) return {...checked, last_href: checked.href};
    // A calendar-owned viewer scrolls unchanged old archives with no row IDs.
    // It also handles a just-published card before the nightly link check.
    return {...checked, last_href: `./race.html?date=${day}&venue=${venue.code}`};
  }
  function weekMeetings(start, end, first, last) {
    const list = schedule.meetings.filter(m => m.start <= end && m.end >= start && m.start <= last && m.end >= first)
      .sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade) || a.start.localeCompare(b.start) || a.code.localeCompare(b.code));
    const rows = []; const groupLanes = new Map();
    const group = m => m.grade === 'F1' && m.night ? 'F1-night' : m.grade;
    for (const m of list) {
      const from = [m.start, start, first].sort().at(-1), to = [m.end, end, last].sort()[0];
      const lanes = groupLanes.get(group(m)) || [];
      let lane = lanes.findIndex(end => end < from);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = to; groupLanes.set(group(m), lanes);
      rows.push({m, from, to, lane});
    }
    const offsets = new Map(); let total = 0;
    for (const grade of GRADES) { offsets.set(grade, total); total += (groupLanes.get(grade) || []).length; }
    offsets.set('F1-night', total);
    const nightRows = (groupLanes.get('F1-night') || []).length;
    check(nightRows <= 2, 'ナイター開催の配置を確認できませんでした。');
    const rowCount = total + (nightRows ? 2 : 0);
    return {rows: rows.map(r => ({...r, lane: r.lane + offsets.get(group(r.m))})), rowCount};
  }
  function renderWeek(start, first, last) {
    const end = shift(start, 6), section = node('section', 'week');
    section.setAttribute('aria-label', `${Number(start.slice(5,7))}月${Number(start.slice(8))}日からの週`);
    const headings = node('div', 'day-headings');
    for (let col = 0; col < 7; col++) {
      const day = shift(start, col), outside = day < first || day > last, isToday = day === today && !outside;
      const cell = node('div', 'day-heading' + (col === 0 ? ' sunday' : col === 6 ? ' saturday' : '') + (outside ? ' outside' : '') + (isToday ? ' today' : ''));
      const d = outside || day > tomorrow ? null : entries.get(day);
      const number = node(d ? 'a' : 'span', 'day-number', String(Number(day.slice(8))));
      if (d) { number.href = d.href; number.setAttribute('aria-label', `${day}の掲載出走表`); }
      if (isToday) { number.setAttribute('aria-current', 'date'); cell.append(number, node('span', 'today-label', '今日')); } else cell.append(number);
      headings.append(cell);
    }
    const events = node('div', 'week-events');
    if (today >= start && today <= end && today >= first && today <= last) {
      const background = node('div', 'today-backdrop');
      background.style.setProperty('--today-column', (utc(today) - utc(start)) / 86400000);
      background.setAttribute('aria-hidden', 'true'); events.append(background);
    }
    const {rows, rowCount} = weekMeetings(start, end, first, last);
    if (rowCount) events.style.gridTemplateRows = `repeat(${rowCount}, var(--meeting-height))`;
    if (!rows.length) events.append(node('span', 'empty-week', '掲載中の開催予定はないにゃ'));
    for (const {m, from, to, lane} of rows) {
      const count = (utc(to) - utc(from)) / 86400000 + 1, col = (utc(from) - utc(start)) / 86400000 + 1;
      const bar = node('div', `meeting-bar ${colors.get(m.id)}${m.start < from ? ' continues-before' : ''}${m.end > to ? ' continues-after' : ''}`);
      bar.dataset.meeting = m.id; bar.dataset.grade = m.grade;
      bar.style.gridColumn = `${col} / span ${count}`; bar.style.gridRow = String(lane + 1); bar.style.setProperty('--days', count);
      for (let offset = 0; offset < count; offset++) {
        const day = shift(from, offset), target = venueLink(day, m);
        const href = target?.last_href || target?.href;
        const cell = node(href ? 'a' : 'span', 'meeting-day' + (href ? ' available' : ''));
        cell.dataset.date = day;
        const description = `${day} ${m.venue} ${m.grade}｜${m.title}（${m.start}〜${m.end}）`;
        const lastLabel = target?.last_race ? `${target.last_race}R` : 'レース';
        const destination = target?.kind === 'entries' ? '楽天Kドリームスのあっせん情報' : `最終掲載${lastLabel}の出走メンバー`;
        cell.title = description + (href ? `｜${destination}へ` : day > today ? '｜あっせん情報は未掲載・未確認' : '｜出走表は未掲載');
        if (href) {
          cell.href = href; cell.dataset.linkKind = target?.kind || 'race';
          cell.setAttribute('aria-label', `${day} ${m.venue} ${destination}`);
        }
        const venueName = Array.from(m.venue).slice(0, 3).join('');
        cell.append(node('span', 'venue-name', venueName + (m.night ? '🌛' : '')));
        if (!href) cell.setAttribute('aria-label', description + (m.night ? ' ナイター' : ''));
        bar.append(cell);
      }
      events.append(bar);
    }
    section.append(headings, events); return section;
  }
  function renderMonth(month) {
    const [year, mm] = month.split('-').map(Number), first = month + '-01', last = iso(new Date(Date.UTC(year, mm, 0)));
    const panel = node('section', 'month-panel'); panel.dataset.month = month;
    const heading = node('div', 'month-heading');
    const title = node('h3', '', monthLabel(month)); title.id = 'calendar-month-'+month;
    panel.setAttribute('aria-labelledby', title.id); heading.append(title);
    if (month !== selected && months.includes(month)) {
      const link = node('a', 'month-start-link', 'この月から見る →'); link.href = monthHref(month);
      link.setAttribute('aria-label', `${monthLabel(month)}から3か月を表示`); heading.append(link);
    }
    const full = schedule.monthly_coverage.includes(month);
    const count = schedule.meetings.filter(m => m.start <= last && m.end >= first).length;
    const note = full ? 'KEIRIN.JP の月別予定を確認済みにゃ' : count ? 'グレードレースの発表分にゃ。F1 は月別予定の確認後に追加するにゃ。' : '開催予定の発表・確認待ちにゃ。';
    const status = node('p', 'month-status', `${count}開催｜${note}`);
    const grid = node('div', 'calendar'); grid.setAttribute('aria-labelledby', title.id);
    const header = node('div', 'weekdays');
    weekdays.forEach((day, i) => header.append(node('div', 'weekday' + (i === 0 ? ' sunday' : i === 6 ? ' saturday' : ''), day)));
    grid.append(header);
    for (let start = shift(first, -utc(first).getUTCDay()); start <= last; start = shift(start, 7)) grid.append(renderWeek(start, first, last));
    panel.append(heading, status, grid); return panel;
  }
  function render(month) {
    selected = month;
    const shown = [0, 1, 2].map(offset => monthShift(month, offset));
    $('month-title').textContent = monthLabel(month);
    document.title = `${monthLabel(month)}から3か月の開催カレンダー｜競輪ラインナップ`;
    $('month-select').value = month;
    $('prev').disabled = months.indexOf(month) === 0; $('next').disabled = months.indexOf(month) === months.length - 1;
    $('this-month').disabled = month === today.slice(0, 7);
    $('calendar').replaceChildren(...shown.map(renderMonth));
    $('calendar').setAttribute('aria-busy', 'false');
    const first = month + '-01', finalMonth = shown.at(-1), [year, mm] = finalMonth.split('-').map(Number);
    const last = iso(new Date(Date.UTC(year, mm, 0)));
    const count = schedule.meetings.filter(m => m.start <= last && m.end >= first).length;
    $('status').textContent = `${monthLabel(month)}〜${monthLabel(finalMonth)}の3か月・${count}開催を表示しているにゃ。`;
    $('official-link').href = `https://keirin.jp/pc/raceschedule?scyy=${month.slice(0,4)}&scym=${month.slice(5)}`;
  }
  function navigate(month) {
    if (!months.includes(month)) return;
    location.href = monthHref(month);
  }
  async function load() {
    $('retry').hidden = true; $('calendar').setAttribute('aria-busy', 'true');
    $('status').textContent = '公式の開催日程を読み込み中にゃ。';
    try {
      const responses = await Promise.all(['./schedule.json', './dates.json'].map(url => fetch(url, {cache: 'no-store'})));
      check(responses.every(r => r.ok), '開催日程を読み込めませんでした。');
      const [data, dates] = await Promise.all(responses.map(r => r.json())); validate(data, dates);
      try {
        const response = await fetch('./race-links.json', {cache: 'no-store'});
        if (response.ok) {
          const saved = await response.json();
          if (saved.schema_version === 1 && Array.isArray(saved.days)) {
            saved.days.forEach(d => d.venues.forEach(v => publicHref(v.href)));
            verified = new Map(saved.days.map(d => [d.date, d]));
          }
        }
      } catch (_) { verified = new Map(); }
      try {
        assignments = new Map();
        const response = await fetch('./entry-links.json', {cache: 'no-store'});
        if (response.ok) {
          const saved = await response.json();
          check(saved.schema_version === 1 && saved.provider === 'kdreams' && saved.verification === 'anonymous-http' && Array.isArray(saved.meetings), 'あっせん情報を確認できませんでした。');
          const planned = [];
          for (const record of saved.meetings) {
            const meeting = data.meetings.find(m => m.id === record.id);
            if (meeting) planned.push([meeting.id, {...record, href: assignmentHref(record, meeting)}]);
          }
          assignments = new Map(planned);
        }
      } catch (_) { assignments = new Map(); }
      schedule = data; links = dates; entries = new Map(links.days.map(d => [d.date, d]));
      const sorted = [...data.meetings].sort((a, b) => a.start.localeCompare(b.start) || a.code.localeCompare(b.code));
      let f1 = 0; colors = new Map(sorted.map(m => [m.id, m.grade === 'F1' ? F1_COLORS[f1++ % F1_COLORS.length] : m.grade === 'G3' ? 'grade-purple' : 'grade-red']));
      const starts = [...data.monthly_coverage, ...data.meetings.map(m => m.start.slice(0, 7))].sort();
      const ends = [...data.monthly_coverage, ...data.meetings.map(m => m.end.slice(0, 7))].sort();
      // Keep the calendar focused on available archives and announced schedules.
      const currentMonth = today.slice(0, 7);
      const earliest = [links.days[0]?.date.slice(0, 7) || currentMonth, starts[0]].sort().at(-1);
      fixedMonths = new Set(rangeMonths([starts[0], '2026-10'].sort().at(-1), ends.at(-1)));
      months = rangeMonths([earliest, currentMonth].sort()[0], [ends.at(-1), currentMonth].sort().at(-1));
      $('month-select').replaceChildren(...months.map(month => { const option = node('option', '', `${month.slice(0, 4)}年${Number(month.slice(5))}月`); option.value = month; return option; }));
      $('month-select').disabled = false;
      const requested = document.body.dataset.calendarMonth || new URLSearchParams(location.search).get('month');
      render(months.includes(requested) ? requested : months.includes(today.slice(0, 7)) ? today.slice(0, 7) : months[0]);
      const checked = new Date(data.checked_at);
      check(!isNaN(checked.getTime()), '予定の確認日時を読み込めませんでした。');
      $('checked-at').textContent = '予定の確認：' + new Intl.DateTimeFormat('ja-JP', {timeZone: 'Asia/Tokyo', dateStyle: 'medium'}).format(checked) + '（日本時間）｜毎月初めに公式日程を再確認するにゃ';
    } catch (error) {
      $('status').textContent = `${error.message} 時間をおいて再読み込みしてにゃ。`;
      $('calendar').setAttribute('aria-busy', 'false'); $('retry').hidden = false;
    }
  }
  $('prev').addEventListener('click', () => navigate(months[months.indexOf(selected) - 1]));
  $('next').addEventListener('click', () => navigate(months[months.indexOf(selected) + 1]));
  $('this-month').addEventListener('click', () => navigate(today.slice(0, 7)));
  $('month-select').addEventListener('change', e => navigate(e.target.value));
  $('retry').addEventListener('click', load);
  load();
})();
