(() => {
  'use strict';
  const GRADES = ['GP', 'G1', 'G2', 'G3', 'F1'];
  const F1_COLORS = ['blue', 'yellow', 'green', 'orange'];
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const $ = id => document.getElementById(id);
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const utc = iso => new Date(iso + 'T00:00:00Z');
  const iso = date => date.toISOString().slice(0, 10);
  const shift = (day, n) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  let schedule, links, months = [], selected, entries = new Map(), verified = new Map(), colors = new Map();

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
  function venueLink(day, meeting) {
    // Only saved, exported URLs are usable; future scheduled meetings are labels.
    if (day > today) return null;
    const d = entries.get(day);
    const venue = d?.venues.find(v => v.code === meeting.code);
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
    for (const m of list) {
      const from = [m.start, start, first].sort().at(-1), to = [m.end, end, last].sort()[0];
      const lanes = groupLanes.get(m.grade) || [];
      let lane = lanes.findIndex(end => end < from);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = to; groupLanes.set(m.grade, lanes);
      rows.push({m, from, to, lane});
    }
    const offsets = new Map(); let total = 0;
    for (const grade of GRADES) { offsets.set(grade, total); total += (groupLanes.get(grade) || []).length; }
    return rows.map(r => ({...r, lane: r.lane + offsets.get(r.m.grade)}));
  }
  function renderWeek(start, first, last) {
    const end = shift(start, 6), section = node('section', 'week');
    section.setAttribute('aria-label', `${Number(start.slice(5,7))}月${Number(start.slice(8))}日からの週`);
    const headings = node('div', 'day-headings');
    for (let col = 0; col < 7; col++) {
      const day = shift(start, col), outside = day < first || day > last;
      const cell = node('div', 'day-heading' + (col === 0 ? ' sunday' : col === 6 ? ' saturday' : '') + (outside ? ' outside' : '') + (day === today ? ' today' : ''));
      const d = outside || day > today ? null : entries.get(day);
      const number = node(d ? 'a' : 'span', 'day-number', String(Number(day.slice(8))));
      if (d) { number.href = d.href; number.setAttribute('aria-label', `${day}の掲載出走表`); }
      if (day === today) { number.setAttribute('aria-current', 'date'); cell.append(number, node('span', 'today-label', '今日')); } else cell.append(number);
      headings.append(cell);
    }
    const events = node('div', 'week-events');
    if (today >= start && today <= end && today >= first && today <= last) {
      const background = node('div', 'today-backdrop');
      background.style.setProperty('--today-column', (utc(today) - utc(start)) / 86400000);
      background.setAttribute('aria-hidden', 'true'); events.append(background);
    }
    const rows = weekMeetings(start, end, first, last);
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
        cell.title = description + (href ? `｜最終掲載${lastLabel}の出走メンバーへ` : '｜出走表は未掲載');
        if (href) { cell.href = href; cell.setAttribute('aria-label', `${day} ${m.venue} 最終掲載${lastLabel}の出走メンバー`); }
        cell.append(node('span', 'venue-name', m.venue), node('small', '', m.grade)); bar.append(cell);
      }
      events.append(bar);
    }
    section.append(headings, events); return section;
  }
  function render(month) {
    selected = month;
    const [year, mm] = month.split('-').map(Number), first = month + '-01', last = iso(new Date(Date.UTC(year, mm, 0)));
    $('month-title').textContent = `${year}年 ${mm}月`;
    document.title = `${year}年${mm}月の開催カレンダー｜競輪ラインナップ`;
    $('month-select').value = month;
    $('prev').disabled = months.indexOf(month) === 0; $('next').disabled = months.indexOf(month) === months.length - 1;
    $('this-month').disabled = month === today.slice(0, 7) || !months.includes(today.slice(0, 7));
    const header = node('div', 'weekdays');
    weekdays.forEach((day, i) => header.append(node('div', 'weekday' + (i === 0 ? ' sunday' : i === 6 ? ' saturday' : ''), day)));
    $('calendar').replaceChildren(header);
    for (let start = shift(first, -utc(first).getUTCDay()); start <= last; start = shift(start, 7)) $('calendar').append(renderWeek(start, first, last));
    $('calendar').setAttribute('aria-busy', 'false');
    const full = schedule.monthly_coverage.includes(month);
    const count = schedule.meetings.filter(m => m.start <= last && m.end >= first).length;
    $('status').textContent = `${count}開催${full ? '｜KEIRIN.JP の月別予定を確認済みにゃ' : '｜グレードレースの発表分を載せているにゃ。F1 は月別予定の確認後に追加するにゃ。'}`;
    $('official-link').href = `https://keirin.jp/pc/raceschedule?scyy=${year}&scym=${String(mm).padStart(2, '0')}`;
  }
  function navigate(month) {
    if (!months.includes(month)) return;
    location.href = './'+month.replace('-', '')+'.html';
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
      schedule = data; links = dates; entries = new Map(links.days.map(d => [d.date, d]));
      const sorted = [...data.meetings].sort((a, b) => a.start.localeCompare(b.start) || a.code.localeCompare(b.code));
      let f1 = 0; colors = new Map(sorted.map(m => [m.id, m.grade === 'F1' ? F1_COLORS[f1++ % 4] : m.grade === 'G3' ? 'purple' : m.grade === 'GP' ? 'gp' : 'pink']));
      const starts = [...data.monthly_coverage, ...data.meetings.map(m => m.start.slice(0, 7))].sort();
      const ends = [...data.monthly_coverage, ...data.meetings.map(m => m.end.slice(0, 7))].sort();
      // Keep the calendar focused on available archives and announced schedules.
      const earliest = [links.days[0]?.date.slice(0, 7) || today.slice(0, 7), starts[0]].sort().at(-1);
      months = rangeMonths(earliest, ends.at(-1));
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
