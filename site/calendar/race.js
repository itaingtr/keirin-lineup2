(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), day = params.get('date'), code = params.get('venue');
  const fail = message => { $('race-status').textContent = '出走表を確認できなかったにゃ'; $('race-error').hidden = false; $('race-error').textContent = message; };
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}$/.test(code)) throw new Error('日付と開催場を選び直してにゃ。');
    const response = await fetch('./dates.json', {cache: 'no-store'});
    if (!response.ok) throw new Error('日別リンク一覧を読み込めなかったにゃ。');
    const index = await response.json(), entry = index.days.find(d => d.date === day), venue = entry?.venues.find(v => v.code === code);
    if (!venue || !/^\/keirin-lineup2\/line\d{8}\.html(?:#race-\d{2}-\d{1,2})?$/.test(venue.href)) throw new Error('まだ掲載を確認できない開催にゃ。');
    const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
    if (day > today) throw new Error('未来の出走表は当日から開けるにゃ。');
    $('back').href = './'+day.slice(0, 7).replace('-', '')+'.html';
    $('full-card').href = entry.href; $('full-card').hidden = false;
    const frame = $('race-frame');
    frame.addEventListener('load', () => {
      try {
        // Inspect the existing rendered rows; never alter the archived page.
        const doc = frame.contentDocument;
        const matches = [...doc.querySelectorAll('tr')].filter(row => row.querySelector('.venue')?.textContent.trim() === venue.name && row.querySelector('.race-link'));
        const numbered = matches.map(row => ({row, n: Number(/^\s*(\d+)R/.exec(row.querySelector('.race-link').textContent)?.[1])})).filter(x => x.n >= 1 && x.n <= 12);
        if (numbered.length !== venue.race_count) throw new Error('公開済みレースの数を確認できなかったにゃ。全レースのリンクから確認してにゃ。');
        const last = numbered.reduce((a, b) => a.n > b.n ? a : b);
        last.row.scrollIntoView({block: 'start', inline: 'nearest'});
        $('race-status').textContent = `${day} ${venue.name} ${last.n}R にゃ`;
        document.title = `${day} ${venue.name} ${last.n}R｜開催カレンダー`;
      } catch (error) { fail(error.message); }
    }, {once: true});
    frame.src = venue.href; frame.hidden = false;
  } catch (error) { fail(error.message); }
})();
