// One bounded, read-only queue shared by current results and checked prior rides.
(() => {
  'use strict';
  if (document.body.dataset.historyRefinements !== '20261116') return;
  const pending = new Map(), queue = [];
  let active = 0, settings;
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  function identity(source) {
    const url = new URL(source), match = /^\/[a-z]+\/racedetail\/(\d{2})(\d{8})(\d{2})(\d{4})\/$/.exec(url.pathname);
    require(url.origin === 'https://keirin.kdreams.jp' && !url.username && !url.password && !url.search && !url.hash && match, 'Result source differs');
    const day = Number(match[3]), race = Number(match[4]);
    require(day >= 1 && day <= 6 && race >= 1 && race <= 12, 'Result coordinates differ');
    const date = new Date(match[2].slice(0,4)+'-'+match[2].slice(4,6)+'-'+match[2].slice(6)+'T00:00:00Z');
    date.setUTCDate(date.getUTCDate()+day-1);
    const actual = date.toISOString().slice(0,10);
    return {date:actual, race, id:String(race).padStart(2,'0')+match[1]+actual.replaceAll('-','')};
  }
  async function config() {
    if (!settings) settings = (async () => {
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
      try {
        const response = await fetch(document.body.dataset.raceResultsConfig,{cache:'no-store',signal:controller.signal});
        require(response.ok,'Result configuration unavailable');
        const value = await response.json();
        require(value.endpoint === 'https://ritinxywblgsccjvqoeh.supabase.co/functions/v1/race-results'
          && typeof value.anon_key === 'string' && value.anon_key.startsWith('eyJ'),'Result configuration differs');
        return value;
      } finally { clearTimeout(timer); }
    })().catch(error=>{settings=null;throw error;});
    return settings;
  }
  async function fetchResult(source) {
    const expected = identity(source), value = await config();
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),18000);
    try {
      const response = await fetch(value.endpoint+'?source='+encodeURIComponent(source),{
        method:'GET',cache:'no-store',credentials:'omit',signal:controller.signal,
        headers:{Authorization:'Bearer '+value.anon_key,apikey:value.anon_key},
      });
      require(response.ok,'Result unavailable');
      const data = await response.json();
      require(data?.schema_version === 1 && data.source_url === source && data.race_date === expected.date
        && data.race_id === expected.id && data.race_number === expected.race
        && typeof data.observed_at === 'string' && Number.isFinite(Date.parse(data.observed_at))
        && Date.parse(data.observed_at) <= Date.now()+60000 && Array.isArray(data.rows)
        && data.rows.length <= 9,'Result identity differs');
      const seen = new Set();
      for (const row of data.rows) {
        require(Number.isInteger(row.no) && row.no >= 1 && row.no <= 9 && !seen.has(row.no),'Result car differs');
        seen.add(row.no);
        for (const key of ['rank','name','time','reason']) require(typeof row[key] === 'string' && row[key].length <= 160,'Result text differs');
      }
      return data;
    } finally { clearTimeout(timer); }
  }
  function pump() {
    while (active < 3 && queue.length) {
      const {source,resolve,reject} = queue.shift();active++;
      fetchResult(source).then(resolve,reject).finally(()=>{active--;pump();});
    }
  }
  window.keirinPublicResults = Object.freeze({read(source) {
    try { identity(source); } catch (error) { return Promise.reject(error); }
    const previous = pending.get(source);
    if (!previous || previous.completed && Date.now()-previous.completed >= 5000) {
      const entry = {completed:0,request:null};
      const request = new Promise((resolve,reject)=>{queue.push({source,resolve,reject});pump();});
      entry.request = request.then(data=>{entry.completed=Date.now();return data;}).catch(error=>{if(pending.get(source)===entry)pending.delete(source);throw error;});
      pending.set(source,entry);
    }
    return pending.get(source).request;
  }});
})();
