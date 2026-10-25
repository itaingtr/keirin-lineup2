/* Keep result viewing and media playback inside the current page. */
(function(){
 'use strict';
 const dialog=document.createElement('dialog');dialog.className='lineup-viewer';dialog.setAttribute('aria-labelledby','viewer-title');
 dialog.innerHTML='<div class="viewer-heading"><h2 id="viewer-title">競走成績</h2><button class="viewer-close" type="button">閉じる ×</button></div><div class="viewer-tabs"><button type="button" class="viewer-tab" data-mode="result">競走成績</button><button type="button" class="viewer-tab" data-mode="video">映像</button></div><p class="viewer-status" role="status"></p><p class="viewer-observed"></p><div class="viewer-content"></div><button class="viewer-retry" type="button" hidden>再試行</button><div class="viewer-source">出典：WINTICKET</div>';
 document.body.append(dialog);
 const title=dialog.querySelector('h2'),status=dialog.querySelector('.viewer-status'),observed=dialog.querySelector('.viewer-observed'),content=dialog.querySelector('.viewer-content'),retry=dialog.querySelector('.viewer-retry');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let datasetPromise,current,opener,hls,controller,version=0,hlsPromise;
 const loadData=()=>datasetPromise||(datasetPromise=fetch(new URL('./viewer.json',document.baseURI),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(data.provider!=='winticket'||data.schema_version!==1||!Array.isArray(data.results))throw Error();return data;}).catch(error=>{datasetPromise=null;throw error;}));
 function stop(){version++;controller?.abort();controller=null;if(hls){hls.destroy();hls=null;}const video=content.querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}}
 function close(){stop();if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');document.body.classList.remove('viewer-open');opener?.focus({preventScroll:true});}
 dialog.querySelector('.viewer-close').addEventListener('click',close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}});
 dialog.querySelectorAll('.viewer-tab').forEach(button=>button.addEventListener('click',()=>show(button.dataset.mode)));
 retry.addEventListener('click',()=>show(current.mode));
 function updateTime(value){const time=new Date(value);observed.textContent=Number.isFinite(time.getTime())?'確認：'+time.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST':'';}
 function showResults(card){
  updateTime(card?.observed_at);
  if(!card?.rows.length){status.textContent='確認時点では、このレースの結果はまだ発表されていません。';return;}
  status.textContent=current.player?'選んだ選手の背景を緑で表示しています。':'';
  content.innerHTML='<div class="viewer-table-wrap"><table class="viewer-results"><thead><tr><th>着</th><th>車</th><th>選手名</th><th>着差</th><th>上り</th><th>決</th><th>SB</th></tr></thead><tbody>'+card.rows.map(row=>'<tr'+(row.player_id===current.player?' class="viewer-selected" aria-current="true"':'')+'><td>'+escape(row.has_accident?row.accident:row.order)+'</td><td><span class="viewer-number c'+Number(row.number)+'">'+Number(row.number)+'</span></td><td class="viewer-name">'+escape(row.name)+'</td><td>'+escape(row.margin||'—')+'</td><td>'+escape(Number(row.final_half_record)>0?row.final_half_record:'—')+'</td><td>'+escape(row.factor||'—')+'</td><td>'+(row.standing?'S':'')+(row.back?'B':'')+'</td></tr>').join('')+'</tbody></table></div>';
 }
 function getHls(){return hlsPromise||(hlsPromise=new Promise((resolve,reject)=>{if(window.Hls){resolve(window.Hls);return;}const script=document.createElement('script');script.src=new URL('/vendor/hls-1.6.13.min.js',document.baseURI);script.onload=()=>resolve(window.Hls);script.onerror=()=>{hlsPromise=null;reject(Error());};document.head.append(script);}));}
 function validateMedia(media){
  if(media.provider!=='winticket')throw Error();if(!media.src)return;
  const url=new URL(media.src);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw Error();
  if(media.kind==='digest'){if(url.hostname!=='video.winticket.jp'||!/^\/keirin\/digest\/[A-Za-z0-9_-]+\.mp4$/.test(url.pathname))throw Error();}
  else if(media.kind==='live'){if(url.hostname!=='keirin-'+media.venue_slug+'.winticket.live'||!/^\/out\/v1\/[a-f0-9]{32}\/index\.m3u8$/.test(url.pathname))throw Error();}
  else throw Error();
 }
 async function showVideo(data,serial){
  const endpoint=new URL('/api/media',document.baseURI);endpoint.searchParams.set('kind',current.kind);
  if(current.kind==='live')endpoint.searchParams.set('venue',current.venue);else endpoint.searchParams.set('race',current.path);
  controller=new AbortController();
  const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const media=await response.json();if(serial!==version)return;
  validateMedia(media);updateTime(media.observed_at);
  if(!media.src){status.textContent=media.kind==='live'?'現在はライブ配信時間外です。':'このレースの映像はまだ公開されていません。';retry.hidden=false;return;}
  content.innerHTML='<div class="viewer-video-wrap"><video class="viewer-video" controls playsinline preload="metadata" aria-label="レース映像"></video><button type="button" class="viewer-play" hidden>▶ 再生</button></div>';
  const video=content.querySelector('video'),play=content.querySelector('.viewer-play');
  async function start(){if(serial!==version)return;try{await video.play();play.hidden=true;}catch(_){play.hidden=false;status.textContent='▶ 再生を押すと映像を再生します。';}}
  function failed(){if(serial!==version)return;status.textContent='映像を読み込めませんでした。再試行してください。';retry.hidden=false;play.hidden=true;}
  play.addEventListener('click',start);video.addEventListener('error',failed);video.addEventListener('playing',()=>{status.textContent=media.kind==='live'?'ライブ中継':'レース映像';play.hidden=true;});
  if(media.kind==='live'&&!video.canPlayType('application/vnd.apple.mpegurl')){
   const Hls=await getHls();if(serial!==version)return;if(!Hls?.isSupported())throw Error();hls=new Hls({maxBufferLength:20,backBufferLength:15});
   hls.on(Hls.Events.ERROR,(_,detail)=>{if(detail.fatal){failed();hls?.destroy();hls=null;}});hls.on(Hls.Events.MANIFEST_PARSED,start);hls.loadSource(media.src);hls.attachMedia(video);
  }else{video.src=media.src;start();}
 }
 async function show(mode){
  if(!current)return;stop();current.mode=mode;const serial=version;content.innerHTML='';status.textContent='読み込んでいます…';observed.textContent='';retry.hidden=true;
  dialog.querySelectorAll('.viewer-tab').forEach(button=>{button.hidden=current.kind==='live';button.setAttribute('aria-selected',String(button.dataset.mode===mode));});
  try{const data=await loadData();if(serial!==version)return;const card=data.results.find(item=>new URL(item.source_url).pathname===current.path);
   title.textContent=current.kind==='live'?current.label+' · ライブ中継':card?card.venue+' '+card.meeting_day+'日目 '+card.race+'R · '+(mode==='result'?'競走成績':'映像'):'レース映像';
   if(mode==='result')showResults(card);else await showVideo(data,serial);
  }catch(error){if(serial!==version||error.name==='AbortError')return;status.textContent='読み込めませんでした。再試行してください。';retry.hidden=false;}
 }
 function open(link){
  const url=new URL(link.dataset.sourceUrl||link.href,document.baseURI);if(url.origin!=='https://www.winticket.jp')return;
  const live=link.classList.contains('live-link');const result=link.classList.contains('meeting-order');
  const row=link.closest('tr');const race=typeof races!=='undefined'?races.find(r=>r.source===row?.querySelector('.race-link')?.href):null;
  if(live&&!race)return;
  opener=link;current={kind:live?'live':'digest',path:url.pathname,player:url.searchParams.get('playerIds')||'',venue:race?.venueCode,label:race?.venue||'',mode:result?'result':'video'};
  if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
  document.body.classList.add('viewer-open');show(current.mode);
 }
 window.LineupViewer={open,close};
 if(window.__lineupPending){open(window.__lineupPending);delete window.__lineupPending;}
})();
