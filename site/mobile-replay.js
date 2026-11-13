/* Mobile replay uses the official MP4 observed in Rakuten's digest player.
 * Playback starts synchronously in the original tap; no media is stored here.
 */
(() => {
  'use strict';
  if (document.body.dataset.historyLayout !== 'compact-20261113' || typeof window.openVideo !== 'function') return;
  const originalOpenVideo = window.openVideo;
  let current = null;

  function sourceFor(value) {
    try {
      const url = new URL(value, document.baseURI), query = url.searchParams;
      if (url.protocol !== 'https:' || !['keirin.kdreams.jp','my.keirin.kdreams.jp'].includes(url.hostname)
          || url.pathname !== '/stadium/digest/' || url.username || url.password || url.port) return null;
      for (const key of ['kyogijoCd','kaisaiDate','gradeCd','raceNo']) if (query.getAll(key).length !== 1) return null;
      const code=query.get('kyogijoCd'), day=query.get('kaisaiDate'), grade=query.get('gradeCd'), race=query.get('raceNo');
      if (!/^\d{2}$/.test(code || '') || !/^\d{8}$/.test(day || '') || !/^[1-6]$/.test(grade || '')
          || !/^\d{1,4}$/.test(race || '') || Number(race)<1 || Number(race)>12) return null;
      return 'https://wm.st.keirin.jp/wm-keirin'+code+'/'+day+'-'+code+'-'+grade.padStart(2,'0')+'-'+String(Number(race)).padStart(2,'0')+'-01-00.mp4';
    } catch { return null; }
  }

  function show(source, pageUrl, trigger) {
    if (current) current();
    const dialog=document.createElement('dialog');dialog.className='mobile-replay';
    dialog.setAttribute('aria-label','レース映像');dialog.dataset.replayState='loading';
    const toolbar=document.createElement('div');toolbar.className='mobile-replay-toolbar';
    const fallback=document.createElement('a');fallback.className='mobile-replay-original';
    fallback.href=pageUrl;fallback.target='_self';fallback.textContent='楽天で開く';
    const close=document.createElement('button');close.type='button';close.className='mobile-replay-close';close.textContent='閉じる';
    const video=document.createElement('video');video.className='mobile-replay-video';
    video.controls=false;video.autoplay=true;video.playsInline=true;video.preload='metadata';
    video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.setAttribute('aria-label','選択したレースの映像');
    const controls=document.createElement('div');controls.className='mobile-replay-controls';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='mobile-replay-toggle';toggle.textContent='再生';toggle.setAttribute('aria-label','映像を再生');
    const seek=document.createElement('input');seek.type='range';seek.className='mobile-replay-seek';seek.min='0';seek.max='0';seek.step='.1';seek.value='0';seek.disabled=true;seek.setAttribute('aria-label','動画の再生位置');
    const clock=document.createElement('span');clock.className='mobile-replay-time';clock.textContent='0:00 / 0:00';
    const fullscreen=document.createElement('button');fullscreen.type='button';fullscreen.className='mobile-replay-fullscreen';fullscreen.textContent='全画面';fullscreen.disabled=true;
    fullscreen.hidden=typeof video.webkitEnterFullscreen!=='function' && typeof video.requestFullscreen!=='function';
    const status=document.createElement('p');status.className='mobile-replay-status';status.setAttribute('role','status');status.textContent='映像を読み込んでいます';
    toolbar.append(fallback,fullscreen,close);controls.append(toggle,seek,clock);dialog.append(toolbar,video,controls,status);document.body.append(dialog);
    const pageZoom=Number.parseFloat(getComputedStyle(document.body).zoom)||1;
    dialog.style.zoom=String(1/pageZoom);
    let disposed=false,dragging=false,resumeAfterSeek=false;
    function timeText(value){const seconds=Math.max(0,Math.floor(Number(value)||0));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
    function syncControls(){
      if(disposed)return;
      const duration=Number.isFinite(video.duration)?video.duration:0;
      seek.max=String(duration);seek.disabled=duration<=0;fullscreen.disabled=video.readyState<1;
      if(!dragging)seek.value=String(Math.min(duration,Number(video.currentTime)||0));
      clock.textContent=timeText(video.currentTime)+' / '+timeText(duration);
      seek.setAttribute('aria-valuetext',clock.textContent);
      toggle.textContent=video.paused?'再生':'一時停止';toggle.setAttribute('aria-label',video.paused?'映像を再生':'映像を一時停止');
    }
    function startPlayback(){
      try{const started=video.play();if(started&&typeof started.catch==='function')started.catch(tapRequired);}
      catch{tapRequired();}
    }
    function beginSeek(){if(!dragging){dragging=true;resumeAfterSeek=!video.paused;}}
    function seekToValue(){
      if(disposed || seek.disabled)return;
      if(!dragging)resumeAfterSeek=!video.paused;
      const value=Math.max(0,Math.min(video.duration,Number(seek.value)));
      if(!Number.isFinite(value))return;
      video.currentTime=value;clock.textContent=timeText(value)+' / '+timeText(video.duration);
      if(resumeAfterSeek && video.paused)startPlayback();
    }
    function finishSeek(){dragging=false;if(resumeAfterSeek && video.paused)startPlayback();syncControls();}
    function fullscreenChanged(){if(document.fullscreenElement!==video)video.controls=false;}
    function dispose() {
      if (disposed) return;disposed=true;
      document.removeEventListener('fullscreenchange',fullscreenChanged);
      video.pause();video.removeAttribute('src');video.load();dialog.remove();
      if (current===dispose) current=null;
      if (trigger?.isConnected && typeof trigger.focus==='function') trigger.focus({preventScroll:true});
    }
    current=dispose;
    close.addEventListener('click',dispose);
    dialog.addEventListener('cancel',event=>{event.preventDefault();dispose();});
    dialog.addEventListener('close',dispose);
    toggle.addEventListener('click',()=>{if(video.paused){if(video.ended)video.currentTime=0;resumeAfterSeek=true;startPlayback();}else{resumeAfterSeek=false;video.pause();}syncControls();});
    seek.addEventListener('pointerdown',beginSeek);seek.addEventListener('touchstart',beginSeek,{passive:true});
    seek.addEventListener('input',seekToValue);
    seek.addEventListener('change',()=>{seekToValue();finishSeek();});
    seek.addEventListener('pointerup',finishSeek);seek.addEventListener('pointercancel',finishSeek);seek.addEventListener('touchend',finishSeek,{passive:true});
    for(const name of ['loadedmetadata','durationchange','timeupdate','play','pause','ended'])video.addEventListener(name,syncControls);
    video.addEventListener('seeked',()=>{if(resumeAfterSeek && video.paused)startPlayback();syncControls();});
    video.addEventListener('pause',()=>{if(!dragging && !video.seeking)resumeAfterSeek=false;if(!disposed && dialog.dataset.replayState!=='error')dialog.dataset.replayState='paused';});
    video.addEventListener('ended',()=>{resumeAfterSeek=false;if(!disposed)dialog.dataset.replayState='ended';});
    video.addEventListener('playing',()=>{if(disposed)return;dialog.dataset.replayState='playing';status.hidden=true;syncControls();});
    fullscreen.addEventListener('click',()=>{
      video.controls=true;
      try{
        if(typeof video.webkitEnterFullscreen==='function')video.webkitEnterFullscreen();
        else{const entered=video.requestFullscreen();if(entered?.catch)entered.catch(()=>{video.controls=false;});}
      }catch{video.controls=false;}
    });
    video.addEventListener('webkitendfullscreen',()=>{video.controls=false;});
    document.addEventListener('fullscreenchange',fullscreenChanged);
    video.addEventListener('error',()=>{if(disposed)return;dialog.dataset.replayState='error';status.hidden=false;status.textContent='映像を読み込めませんでした。「楽天で開く」から確認できます';});
    if (typeof dialog.showModal==='function') dialog.showModal();else dialog.setAttribute('open','');
    video.src=source;
    // Keep this call in the tap handler so iPhone receives a user-initiated
    // play request, including when it needs to load the media asynchronously.
    function tapRequired(){
      if(disposed || dialog.dataset.replayState==='error')return;
      dialog.dataset.replayState='tap-required';status.hidden=false;status.textContent='下の再生ボタンを押すと視聴できます';syncControls();
    }
    startPlayback();
  }

  window.openVideo=function(event,url) {
    if (!window.matchMedia('(max-width: 640px)').matches) return originalOpenVideo(event,url);
    const source=sourceFor(url);
    if (!source) return originalOpenVideo(event,url);
    event.preventDefault();show(source,url,event.currentTarget || document.activeElement);return false;
  };
  window.addEventListener('pagehide',()=>{if(current)current();});
})();
