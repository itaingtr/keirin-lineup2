// Public display fields only. This module never executes source scripts or writes data.
const venues = {
  '11':'hakodate','12':'aomori','13':'iwakitaira','21':'yahiko','22':'maebashi',
  '23':'toride','24':'utsunomiya','25':'omiya','26':'seibuen','27':'keiokaku',
  '28':'tachikawa','31':'matsudo','32':'chiba','34':'kawasaki','35':'hiratsuka',
  '36':'odawara','37':'ito','38':'shizuoka','42':'nagoya','43':'gifu','44':'ogaki',
  '45':'toyohashi','46':'toyama','47':'matsusaka','48':'yokkaichi','51':'fukui',
  '53':'nara','54':'mukomachi','55':'wakayama','56':'kishiwada','61':'tamano',
  '62':'hiroshima','63':'hofu','71':'takamatsu','73':'komatsushima','74':'kochi',
  '75':'matsuyama','81':'kokura','83':'kurume','84':'takeo','85':'sasebo',
  '86':'beppu','87':'kumamoto',
};
const require = (value, message) => { if (!value) throw new Error(message); };
const compact = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
const text = node => String(node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cells = row => Array.from(row.children).filter(node => /^(TH|TD)$/i.test(node.tagName));

export function raceIdentity(raw) {
  require(typeof raw === 'string' && raw.length <= 300, 'Invalid source');
  const url = new URL(raw);
  require(url.protocol === 'https:' && ['keirin.kdreams.jp','my.keirin.kdreams.jp'].includes(url.hostname)
    && !url.username && !url.password && !url.port && !url.hash, 'Invalid source host');
  require(!url.search || url.search === '?pageType=showResult', 'Invalid source query');
  const m = /^\/([a-z]+)\/racedetail\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(url.pathname);
  require(m, 'Invalid source path');
  const [,slug,code,start,day,number] = m;
  require(venues[code] === slug && +day >= 1 && +day <= 6 && +number >= 1 && +number <= 12, 'Invalid race identity');
  const date = new Date(start.slice(0,4)+'-'+start.slice(4,6)+'-'+start.slice(6)+'T00:00:00Z');
  require(Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10).replaceAll('-','') === start, 'Invalid meeting date');
  date.setUTCDate(date.getUTCDate() + Number(day) - 1);
  const raceDate = date.toISOString().slice(0,10);
  const source = 'https://keirin.kdreams.jp' + url.pathname;
  return {source_url:source,result_url:source+'?pageType=showResult',race_id:String(+number).padStart(2,'0')+code+raceDate.replaceAll('-',''),race_date:raceDate,race_number:+number};
}

function tableGrid(table) {
  const grid = [];
  for (const [index,row] of Array.from(table.querySelectorAll('tr')).entries()) {
    grid[index] ||= [];
    let column = 0;
    for (const cell of cells(row)) {
      while (grid[index][column]) column++;
      const rows = Number(cell.getAttribute('rowspan') || 1), columns = Number(cell.getAttribute('colspan') || 1);
      require(rows >= 1 && rows <= 10 && columns >= 1 && columns <= 20, 'Invalid payout dimensions');
      for (let y=0;y<rows;y++) {
        grid[index+y] ||= [];
        for (let x=0;x<columns;x++) grid[index+y][column+x] = cell;
      }
      column += columns;
    }
  }
  return grid;
}

function payoutItems(cell, type) {
  const output = [], count = type === 'trifecta' ? 3 : 2;
  const unordered = type === 'quinella' || type === 'wide';
  const add = (combination, value) => {
    combination = compact(combination).replace(/[‐‑‒–—−ー－→]/g,'-');
    const amount = compact(value).match(/([0-9][0-9,]*)円/);
    if (!amount) return;
    const pattern = count === 3 ? /^[1-9]-[1-9]-[1-9]$/
      : unordered ? /^[1-9][=-][1-9]$/ : /^[1-9]-[1-9]$/;
    if (!pattern.test(combination) && !['特払','特払い','返還','全返還'].includes(combination)) return;
    if (pattern.test(combination)) require(new Set(combination.split(/[=-]/)).size === count, 'Invalid winning combination');
    const yen = Number(amount[1].replaceAll(',',''));
    require(Number.isSafeInteger(yen) && yen > 0 && yen <= 1_000_000_000, 'Invalid payout');
    if (!output.some(item => item.combination === combination && item.yen === yen)) output.push({combination,yen});
  };
  for (const dt of cell.querySelectorAll('dt')) {
    let next = dt.nextElementSibling;
    while (next && next.tagName.toLowerCase() !== 'dt') {
      if (next.tagName.toLowerCase() === 'dd') { add(text(dt),text(next)); break; }
      next = next.nextElementSibling;
    }
  }
  if (!output.length) {
    const raw = compact(text(cell));
    const separator = unordered ? '[-=‐‑‒–—−ー－→]' : '[-‐‑‒–—−ー－→]';
    const pair = '[1-9]'+separator+'[1-9]';
    const combination = count === 3 ? pair+separator+'[1-9]' : pair;
    const pattern = new RegExp('(?<![1-9=‐‑‒–—−ー－→-])('+combination+'|特払い?|全?返還)([0-9][0-9,]*円)','g');
    for (const match of raw.matchAll(pattern)) add(match[1],match[2]);
  }
  return output;
}

function payouts(document) {
  const result = {exacta:[],trifecta:[],quinella:[],wide:[]}, seen = new Set();
  const labels = { '2車単':'exacta', '2車連単':'exacta', '3連単':'trifecta',
    '2車複':'quinella', '2車連複':'quinella', 'ワイド':'wide', '拡大2連複':'wide' };
  for (const table of document.querySelectorAll('table')) {
    const headers = Array.from(table.querySelectorAll('th')).map(node => compact(text(node)));
    if (!headers.some(value => labels[value] || value === '2車連' || value === '3連勝')) continue;
    for (const row of tableGrid(table)) for (let i=0;i<row.length;i++) {
      if (i && row[i] === row[i-1]) continue;
      const label = compact(text(row[i]));
      let next = i+1;
      while (row[next] && row[next] === row[i]) next++;
      let type = labels[label];
      if (label === '2車連' || label === '3連勝') {
        const subtype = compact(text(row[next]));
        type = label === '2車連' ? {'単':'exacta','複':'quinella'}[subtype]
          : subtype === '単' ? 'trifecta' : null;
        const subheader = row[next];
        while (row[next] && row[next] === subheader) next++;
      }
      if (!type) continue;
      const cell = row[next];
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      result[type].push(...payoutItems(cell,type));
    }
  }
  return result;
}

export function parseResult(document, rawSource, observedAt = new Date().toISOString()) {
  const identity = raceIdentity(rawSource);
  const title = text(document.querySelector('title'));
  const number = title.match(/\b(\d+)R\b/), date = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  require(number && +number[1] === identity.race_number && date
    && date[1]+'-'+date[2].padStart(2,'0')+'-'+date[3].padStart(2,'0') === identity.race_date, 'Result title differs');
  for (const node of document.querySelectorAll('link[rel="canonical"]')) {
    require(raceIdentity(node.getAttribute('href')).source_url === identity.source_url, 'Result canonical differs');
  }
  const tables = document.querySelectorAll('table.result_table');
  require(tables.length <= 1, 'Ambiguous result table');
  const rows = [], seen = new Set();
  if (tables.length) {
    let verifiedHeader = false;
    for (const row of tables[0].querySelectorAll('tr')) {
      const values = cells(row), labels = values.map(node => compact(text(node)));
      if (labels[0] === '予想' && labels[1] === '着順') {
        require(labels.length === 9 && labels.slice(0,7).join('|') === '予想|着順|車番|選手名|着差|上り|決まり手'
          && ['S/B','S/H/B','SHB'].includes(labels[7]) && labels[8] === '勝敗因', 'Result columns differ');
        verifiedHeader = true; continue;
      }
      if (!values.some(node => node.classList.contains('num'))) continue;
      require(verifiedHeader && values.length === 9, 'Result dimensions differ');
      const no = Number(labels[2]), rank = labels[1];
      require(Number.isInteger(no) && no >= 1 && no <= 9 && !seen.has(no), 'Result car differs');
      seen.add(no);
      if (!rank || /^[-—―]+$/.test(rank)) continue;
      require(/^[1-9]$/.test(rank) || /^(?:落|失|欠|棄|故|除|事故|落車|失格|欠場|棄権|事故棄権|落滑入|事故入)$/.test(rank), 'Unknown placing');
      const flags = labels[7].replaceAll('/','');
      require(/^[SHB]*$/.test(flags) && new Set(flags).size === flags.length, 'Unknown result flags');
      const name = labels[3], margin = text(values[4]), time = labels[5], finish = text(values[6]), reason = text(values[8]);
      require(name.length > 0 && name.length <= 30 && margin.length <= 30 && finish.length <= 12 && reason.length <= 160, 'Result text exceeds limit');
      require(!time || /^\d{1,2}\.\d{1,2}$/.test(time) || /^[-—―]+$/.test(time), 'Invalid individual time');
      rows.push({rank,no,name,margin,time:/^[-—―]+$/.test(time)?'':time,finish,shb:['S','H','B'].filter(flag=>flags.includes(flag)).join(''),reason});
    }
  }
  rows.sort((a,b) => (/^[1-9]$/.test(a.rank)?Number(a.rank):99)-(/^[1-9]$/.test(b.rank)?Number(b.rank):99));
  const payments = payouts(document);
  return {schema_version:1,...identity,observed_at:observedAt,state:rows.length?'results':Object.values(payments).some(items=>items.length)?'payouts':'pending',rows,payouts:payments};
}
