// On-demand public race results. No result, comment or media is saved by this reader.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.raceResults !== 'true' || typeof races === 'undefined') return;
  const all = document.body.dataset.raceResultsAll === 'true';
  const current = new Map(races.map(race => [race.source,race]));
  const states = new Map();
  const queue = [];
  let active = 0, configRequest;
  const normalize = value => String(value).normalize('NFKC').replace(/\s+/g,'');
  const element = (tag,className,text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const require = (value,message) => { if (!value) throw new Error(message); };
  function state(source) {
    if (!states.has(source)) states.set(source,{open:all,loading:false,value:null,error:false});
    return states.get(source);
  }
  function sourceFor(row) {
    const link = row.querySelector('.race-link');
    return link?.dataset.raceSource || link?.href;
  }
  function addNavigation() {
    const nav = document.getElementById('venue-nav');
    if (!nav || nav.querySelector('.all-results-button')) return;
    const link = element('a','venue-button all-results-button','今日の全結果');
    link.href = '/keirin-lineup2/results.html';
    link.setAttribute('aria-label','今日の全出走表と全結果を開く');
    nav.append(link);
  }
  function validate(payload,race) {
    const source = new URL(race.source);
    const m = /^\/[a-z]+\/racedetail\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(source.pathname);
    require(m,'result source identity');
    const date = new Date(m[2].slice(0,4)+'-'+m[2].slice(4,6)+'-'+m[2].slice(6)+'T00:00:00Z');
    date.setUTCDate(date.getUTCDate()+Number(m[3])-1);
    const day = date.toISOString().slice(0,10), id = String(+m[4]).padStart(2,'0')+m[1]+day.replaceAll('-','');
    require(payload?.schema_version === 1 && payload.source_url === 'https://keirin.kdreams.jp'+source.pathname
      && payload.race_id === id && payload.race_date === day && payload.race_number === race.race,'result race differs');
    require(typeof payload.observed_at === 'string' && Number.isFinite(Date.parse(payload.observed_at))
      && Date.parse(payload.observed_at) <= Date.now()+60000,'result observation differs');
    require(['pending','payouts','results'].includes(payload.state) && Array.isArray(payload.rows)
      && payload.rows.length <= race.players.length,'result rows differ');
    const seen = new Set();
    for (const row of payload.rows) {
      const player = race.players.find(player => player.no === row.no);
      require(player && !seen.has(row.no) && normalize(player.name) === normalize(row.name),'result rider differs');
      seen.add(row.no);
      for (const field of ['rank','name','margin','time','finish','shb','reason']) require(typeof row[field] === 'string' && row[field].length <= 160,'result text differs');
      require(/^[SHB]*$/.test(row.shb) && new Set(row.shb).size === row.shb.length,'result flags differ');
    }
    require(payload.payouts && typeof payload.payouts === 'object','payouts missing');
    for (const type of ['exacta','trifecta']) {
      const values = payload.payouts[type];
      require(Array.isArray(values) && values.length <= 12,'payout count differs');
      for (const item of values) require(typeof item.combination === 'string' && item.combination.length <= 20
        && Number.isSafeInteger(item.yen) && item.yen > 0 && item.yen <= 1_000_000_000,'payout differs');
    }
    require(payload.state === (payload.rows.length?'results':payload.payouts.exacta.length||payload.payouts.trifecta.length?'payouts':'pending'),'result state differs');
    return payload;
  }
  function resultTable(payload) {
    const table = element('table','race-result-table');
    table.setAttribute('aria-label','着順順のレース結果');
    const head = element('thead'), headings = element('tr');
    for (const label of ['着順','車番','選手名','着差','あがり','決まり手','SHB','勝敗因']) headings.append(element('th','',label));
    head.append(headings);table.append(head);
    const body = element('tbody');
    const sorted = [...payload.rows].sort((a,b)=>(/^[1-9]$/.test(a.rank)?Number(a.rank):99)-(/^[1-9]$/.test(b.rank)?Number(b.rank):99));
    for (const result of sorted) {
      const row = element('tr');row.dataset.carNumber = String(result.no);
      for (const field of ['rank','no','name','margin','time','finish','shb','reason']) row.append(element('td','race-result-'+field,String(result[field])));
      body.append(row);
    }
    table.append(body);return table;
  }
  function paint(row) {
    const source = sourceFor(row), value = states.get(source), cell = row.querySelector('.race-results-cell');
    if (!value || !cell) return;
    const button = cell.querySelector('.race-result-toggle'), panel = cell.querySelector('.race-result-panel');
    button.setAttribute('aria-expanded',String(value.open));
    panel.hidden = !value.open;
    if (!value.open) return;
    panel.setAttribute('aria-busy',String(value.loading));panel.replaceChildren();
    if (value.value) {
      const payload = value.value;
      panel.title = '楽天Kドリームス '+payload.observed_at;
      if (payload.rows.length) panel.append(resultTable(payload));
      for (const [type,label] of [['exacta','2車単'],['trifecta','3連単']]) {
        for (const payout of payload.payouts[type]) {
          const line = element('div','race-result-payout');
          line.append(element('span','race-result-bet',label),element('span','race-result-combination',payout.combination),
            element('span','race-result-yen',payout.yen.toLocaleString('ja-JP')+'円'));
          panel.append(line);
        }
      }
      if (payload.state === 'pending') panel.append(element('span','race-result-pending','未定にゃ！'));
    } else if (!value.error) panel.append(element('span','race-result-loading','読み込み中にゃ…'));
    if (value.error) panel.append(element('span','race-result-error','結果を取得できなかったにゃ。もう一度「結果」を押してにゃ。'));
    cell.dataset.resultState = value.error?'error':value.value?.state || 'loading';
  }
  function paintAll(source) {
    for (const row of root.children) if (sourceFor(row) === source) paint(row);
  }
  async function config() {
    if (!configRequest) configRequest = (async () => {
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
      try {
        const response = await fetch(document.body.dataset.raceResultsConfig,{cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('result configuration unavailable');
        const value = await response.json();
        require(value.endpoint === 'https://ritinxywblgsccjvqoeh.supabase.co/functions/v1/race-results'
          && typeof value.anon_key === 'string' && value.anon_key.startsWith('eyJ'),'result configuration differs');
        return value;
      } finally { clearTimeout(timeout); }
    })().catch(error => { configRequest=null;throw error; });
    return configRequest;
  }
  async function read(source) {
    const value = state(source);
    let timer;
    try {
      const settings = await config(), controller = new AbortController();
      timer = setTimeout(()=>controller.abort(),18000);
      const response = await fetch(settings.endpoint+'?source='+encodeURIComponent(source),{
        method:'GET',cache:'no-store',credentials:'omit',signal:controller.signal,
        headers:{'Authorization':'Bearer '+settings.anon_key,'apikey':settings.anon_key},
      });
      if (!response.ok) throw new Error('result unavailable');
      value.value = validate(await response.json(),current.get(source));
      value.error = false;
    } catch { value.error=true; }
    finally {
      clearTimeout(timer);value.loading=false;paintAll(source);
      window.dispatchEvent(new CustomEvent('keirin-race-result',{detail:{source,state:value.error?'error':value.value.state}}));
    }
  }
  function pump() {
    while (active<3 && queue.length) {
      const source = queue.shift();active++;
      read(source).finally(()=>{active--;pump();});
    }
  }
  function load(source) {
    const value=state(source);
    if (value.loading) return;
    value.loading=true;value.error=false;paintAll(source);queue.push(source);pump();
  }
  function attach() {
    for (const row of root.children) {
      const source = sourceFor(row), race = current.get(source);
      if (!race) continue;
      const value = state(source);
      if (!row.querySelector('.race-results-cell')) {
        const cell = element('div','race-results-cell');
        const button = element('button','race-result-toggle','結果');button.type='button';
        const panel = element('div','race-result-panel');panel.id='race-result-'+race.venueCode+'-'+race.race;
        panel.setAttribute('role','region');panel.setAttribute('aria-label',race.venue+' '+race.race+'R 結果');
        button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-label',race.venue+' '+race.race+'Rの結果を開閉');
        button.addEventListener('click',()=>{value.open=!value.open;paint(row);if(value.open)load(source);});
        cell.append(button,panel);
        const lineup = row.querySelector('.lineup');
        if (lineup) lineup.after(cell);else row.querySelector('.lineup-cell')?.append(cell);
      }
      paint(row);
      if (all && !value.loading && !value.value && !value.error) load(source);
    }
    addNavigation();
  }
  new MutationObserver(changes=>{if(changes.some(change=>change.target===root))attach();}).observe(root,{childList:true});
  const nav = document.getElementById('venue-nav');
  if (nav) new MutationObserver(addNavigation).observe(nav,{childList:true});
  attach();
})();
