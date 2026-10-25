/* Public official media only. No credentials, proxy, or video downloads. */
(async function () {
  'use strict';
  const video = document.getElementById('video');
  const status = document.getElementById('status');
  const play = document.getElementById('play');
  const official = document.getElementById('official');
  const params = new URLSearchParams(location.search);
  let hls;

  function showObserved(observed) {
    const time = new Date(observed);
    if (!Number.isFinite(time.getTime())) throw new Error('Missing source observation time');
    document.getElementById('observed').textContent = '映像情報の確認：' + time.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'}) + ' JST';
  }

  function fail(message) {
    status.textContent = message;
    play.hidden = true;
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
  }

  async function start() {
    try { await video.play(); play.hidden = true; }
    catch (_) { play.hidden = false; status.textContent = '▶ 再生を押すと映像を再生します。'; }
  }

  play.addEventListener('click', start);
  video.addEventListener('playing', () => {
    play.hidden = true;
    status.textContent = params.get('kind') === 'live' ? 'ライブ中継 · WINTICKET' : 'レース映像 · WINTICKET';
  });
  video.addEventListener('error', () => fail('映像を読み込めませんでした。配信元の公開状況をご確認ください。'));
  window.addEventListener('pagehide', () => { if (hls) hls.destroy(); });

  try {
    const response = await fetch('./media.json', {cache:'no-store'});
    if (!response.ok) throw new Error('Media metadata unavailable');
    const data = await response.json();
    if (data.schema_version !== 1 || data.provider !== 'winticket') throw new Error('Unexpected media data');
    let src, observed, live = params.get('kind') === 'live';
    if (live) {
      const venue = data.venues[params.get('venue')];
      if (!venue || !/^[a-z]+$/.test(venue.slug)) throw new Error('Unknown venue');
      document.getElementById('title').textContent = venue.name + ' · ライブ中継';
      official.href = 'https://www.winticket.jp/keirin/' + venue.slug + '/live';
      official.hidden = false;
      src = venue.hls; observed = venue.observed_at;
      showObserved(observed);
      if (!src) { fail('現在、この競輪場のライブ配信情報はありません。'); return; }
      const url = new URL(src);
      if (url.origin !== 'https://keirin-' + venue.slug + '.winticket.live' ||
          !/^\/out\/v1\/[a-f0-9]{32}\/index\.m3u8$/.test(url.pathname) || url.search || url.hash || url.username || url.password)
        throw new Error('Invalid live media URL');
      const now = Date.now()/1000;
      if (!Number.isFinite(venue.start_at) || !Number.isFinite(venue.end_at)) throw new Error('Missing broadcast times');
      if (now < venue.start_at || now > venue.end_at) { fail('ライブ中継の配信時間外です。'); return; }
    } else if (params.get('kind') === 'digest') {
      const race = data.races.find(r => new URL(r.source_url).pathname === params.get('race'));
      if (!race) throw new Error('Unknown race');
      const source = new URL(race.source_url);
      if (source.origin !== 'https://www.winticket.jp' || !/^\/keirin\/[a-z]+\/racecard\/\d{10}\/[1-9]\/\d{1,2}\/?$/.test(source.pathname))
        throw new Error('Invalid race source');
      const venue = data.venues[race.venue_code];
      document.getElementById('title').textContent = (venue?.name || '') + ' ' + race.race + 'R · ' + data.target_date;
      official.href = race.source_url.replace('/racecard/', '/raceresult/');
      official.hidden = false;
      src = race.digest; observed = race.observed_at;
      showObserved(observed);
      if (!src) { fail('このレースの映像は確認時点で未公開です。公開後のデータ更新をお待ちください。'); return; }
      const url = new URL(src);
      if (url.origin !== 'https://video.winticket.jp' || !/^\/keirin\/digest\/[A-Za-z0-9_-]+\.mp4$/.test(url.pathname) ||
          url.search || url.hash || url.username || url.password) throw new Error('Invalid race media URL');
    } else throw new Error('Unknown media kind');

    if (live && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (!window.Hls?.isSupported()) { fail('このブラウザーではライブ映像を再生できません。ウィンチケットでご確認ください。'); return; }
      hls = new window.Hls({maxBufferLength:20,backBufferLength:15});
      hls.on(window.Hls.Events.ERROR, (_, detail) => {
        if (detail.fatal) fail('ライブ映像を読み込めませんでした。配信時間・通信状況をご確認ください。');
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, start);
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
      start();
    }
  } catch (_) { fail('映像情報を読み込めませんでした。出走表から開き直してください。'); }
})();
