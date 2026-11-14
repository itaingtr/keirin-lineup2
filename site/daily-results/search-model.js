(function(root){
  'use strict';
  const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  function findPlayers(players,query){const key=normalize(query);if(!key)return[];return players.filter(p=>normalize(p.name).includes(key)||p.player_id===key);}
  function samePerson(a,b){return a.player_id===b.player_id && normalize(a.name)===normalize(b.name) && String(a.period)===String(b.period);}
  function mergeMeetings(stock,profile){
    if(!profile?.meetings?.length)return (stock?.meetings||[]).slice(-10).reverse();
    return profile.meetings.slice(-10).reverse().map(meeting=>{
      const matches=(stock?.meetings||[]).filter(old=>old.start_date===meeting.start_date && old.grade_code===meeting.grade_code
        && old.days.length===meeting.days.length && old.days.every((day,i)=>day.order===meeting.days[i].order && (day.accident||'')===(meeting.days[i].accident||''))
        && (old.venue===meeting.venue || old.venue?.startsWith(meeting.venue_label||meeting.venue) || old.venue==='いわき平' && meeting.venue==='平'));
      return matches.length===1?matches[0]:meeting;
    });
  }
  function resultRows(player,meetings){return meetings.flatMap(meeting=>meeting.days.map((day,i)=>({
    player_id:player.player_id,name:player.name,meeting_start:meeting.start_date,venue:meeting.venue,
    slot:day.slot??i+1,race_date:day.race_date??null,race_number:day.race_number??null,race_id:day.race_id??null,
    order:day.order,accident:day.accident||'',accident_name:day.accident_name||'',final_half_record:day.final_half_record??null,
    start:day.start??null,home:day.home??null,back:day.back??null,race_date_inferred:day.race_date_inferred??null,
    provider:day.provider||meeting.provider,source_url:day.source_url||meeting.rank_source?.url||player.source_url||player.profile_url,
    observed_at:day.observed_at||meeting.rank_source?.observed_at||player.observed_at,video_url:day.video_url??null})));}
  const api={normalize,findPlayers,samePerson,mergeMeetings,resultRows};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RiderSearch=api;
})(typeof window==='object'?window:globalThis);
