/* Supplement published AI ranks without replacing saved scores or odds. */
(async function () {
  'use strict';
  if (typeof races === 'undefined') return;
  try {
    const response = await fetch('./media.json', {cache:'no-store'});
    if (!response.ok) return;
    const data = await response.json();
    if (data.provider !== 'winticket' || data.schema_version !== 1 || !Array.isArray(data.races)) return;
    for (const race of races) {
      const extra = data.races.find(r => r.source_url === race.source);
      if (!extra || extra.players.length !== race.players.length ||
          !race.players.every(p => extra.players.some(x => x.no === p.no && x.name === p.name)) ||
          !extra.players.every(p => ['', '◎', '○', '▲', '△'].includes(p.mark))) continue;
      for (const player of race.players) player.mark = extra.players.find(p => p.no === player.no).mark;
    }
    for (const row of document.getElementById('rows').children) {
      const race = races.find(r => r.source === row.querySelector('.race-link')?.href);
      if (!race) continue;
      for (const rider of row.querySelectorAll('.rider')) {
        const player = race.players.find(p => p.no === Number(rider.querySelector('.car')?.textContent));
        if (!player) continue;
        const mark = rider.querySelector('.prediction-mark');
        mark.textContent = player.mark;
        mark.title = player.mark ? 'WINTICKET AI予想' : '';
      }
    }
  } catch (_) { /* Keep the validated card when extra data is unavailable. */ }
})();
