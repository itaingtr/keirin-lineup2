// Public profile display fields only. Opaque navigation values are never read.
export const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const requireValue = (value, message) => {if (!value) throw new Error(message);};
const rowsOf = table => [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
const cellsOf = row => [...row.children].filter(node => ['TD','TH'].includes(node.tagName));

export function profileView(document) {
  return {
    tables: [...document.querySelectorAll('table')].map(table => rowsOf(table).map(row => cellsOf(row).map(cell => compact(cell.textContent)))),
    meetings: [...document.querySelectorAll('table.seiseki_kobetsu')].map(table => {
      const rows = rowsOf(table);
      return {heading: cellsOf(rows[0]).map(cell => compact(cell.textContent)),
        days: rows.slice(1).flatMap(row => cellsOf(row).map(cell => ({
          label: cell.querySelector('.imgbadge_s4')?.getAttribute('title') || null,
          back: /(?:^|\s)B(?:\s|$)/.test(cell.textContent) ? true : null,
        })))};
    }),
    updates: [...document.querySelectorAll('*')].filter(node => node.children.length === 0)
      .map(node => compact(node.textContent)).filter(text => /^20\d\d\/\d\d\/\d\d\d\d:\d\d更新$/.test(text)),
  };
}

function attributes(view) {
  const found = new Map();
  for (const rows of view.tables) for (let i=0;i<rows.length-1;i++) {
    if (rows[i].length !== rows[i+1].length) continue;
    rows[i].forEach((key,j) => {
      if (['氏名','登録番号','期別','府県','年齢','級班','脚質','今期得点'].includes(key)) {
        if (!found.has(key)) found.set(key, new Set());
        found.get(key).add(rows[i+1][j]);
      }
    });
  }
  const value = key => {const values=[...(found.get(key)||[])];requireValue(values.length<=1,'Ambiguous official identity');return values[0] ?? null;};
  return value;
}

function placing(label) {
  const value=compact(label);
  if (!value || ['未','途中欠場'].includes(value)) return null;
  if (/^[1-9]$/.test(value)) return {order:Number(value),accident:'',accident_name:''};
  const labels={欠:'欠',欠場:'欠',欠車:'欠',落:'落',落車:'落',落棄:'落',落再:'落',落車棄権:'落',落車再入:'落',故:'故',故棄:'故',故再:'故',故障棄権:'故',故障再入:'故',失:'失',失格:'失',棄:'棄',棄権:'棄',事故棄権:'棄',除:'除',除外:'除'};
  const accident=labels[value] || (/^失格(?:第)?\d{1,3}条$/.test(value)?'失':null);
  requireValue(accident,'Unknown official placing');
  return {order:0,accident,accident_name:value};
}

export function parseProfile(view, playerId, observedAt, expected={}) {
  requireValue(/^\d{6}$/.test(playerId),'Invalid JKA registration');
  const value=attributes(view), name=value('氏名'), period=value('期別');
  requireValue(value('登録番号')===playerId && name && /^\d{1,3}期$/.test(period||''),'Official profile identity differs');
  requireValue(!expected.name || compact(expected.name)===name,'Official profile name differs');
  requireValue(!expected.period || Number(expected.period)===Number(period.slice(0,-1)),'Official profile period differs');
  const target=new Date(new Date(observedAt).getTime()+9*3600000).toISOString().slice(0,10);
  let cursor=target;
  const meetings=[];
  for (const meeting of view.meetings) {
    const [label, venue]=meeting.heading, match=/^(\d{1,2})\/(\d{1,2})$/.exec(label), grade=/^(.+?)(F[12]|G[123]|GP)$/.exec(venue);
    requireValue(match && grade,'Official meeting heading differs');
    let start=null;
    for (const year of [Number(cursor.slice(0,4)),Number(cursor.slice(0,4))-1]) {
      const candidate=year+'-'+match[1].padStart(2,'0')+'-'+match[2].padStart(2,'0');
      if (candidate<=cursor && new Date(candidate).toISOString().slice(0,10)===candidate) {start=candidate;break;}
    }
    requireValue(start,'Official meeting date differs');
    cursor=new Date(new Date(start).getTime()-86400000).toISOString().slice(0,10);
    const days=meeting.days.flatMap((day,i) => {
      const result=placing(day.label);
      return result ? [{...result,slot:i+1,meeting_day:null,race_date:null,race_date_inferred:true,
        race_number:null,race_id:null,player_id:playerId,final_half_record:null,
        start:null,home:null,back:day.back,video_url:null,provider:'keirin.jp'}] : [];
    });
    if (!days.length || start>=target) continue;
    meetings.push({venue:grade[1],venue_label:grade[1],venue_code:null,grade_code:{F2:1,F1:2,G3:3,G2:4,G1:5,GP:6}[grade[2]],
      start_date:start,start_date_inferred:true,days,provider:'keirin.jp'});
    if (meetings.length===10) break;
  }
  const techniques=[];
  for (const rows of view.tables) for (let i=1;i<rows.length;i++) {
    const labels=rows[i].filter(Boolean);
    if (labels.join(',')==='逃げ,捲り,差し,マーク') {
      const percentages=rows[i-1].slice(0,4);
      requireValue(percentages.every(text=>/^(?:\d{1,2}|100)%$/.test(text)),'Official technique percentages differ');
      techniques.push(Object.fromEntries(['nige','makuri','sashi','mark'].map((key,j)=>[key,Number(percentages[j].slice(0,-1))])));
    }
  }
  requireValue(techniques.length<=1,'Ambiguous official technique table');
  return {schema_version:1,player_id:playerId,name,period:Number(period.slice(0,-1)),prefecture:value('府県'),
    age:value('年齢')?Number(value('年齢').replace('歳','')):null,class_name:value('級班'),style:value('脚質'),
    current_score:value('今期得点'),provider:'keirin.jp',source_url:'https://keirin.jp/pc/racerprofile?snum='+playerId,
    observed_at:observedAt,source_updates:[...new Set(view.updates)],
    techniques:techniques.length?{unit:'percent',scope:'連対時・直近4か月',values:techniques[0]}:null,
    meetings:meetings.reverse()};
}
