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
    const fullscreen=document.createElement('button');fullscreen.type='button';fullscreen.className='mobile-replay-fullscreen';fullscreen.textContent='全画面';
    const close=document.createElement('button');close.type='button';close.className='mobile-replay-close';close.textContent='閉じる';
    const video=document.createElement('video');video.className='mobile-replay-video';
    video.controls=true;video.autoplay=true;video.playsInline=false;video.preload='metadata';
    video.setAttribute('aria-label','選択したレースの映像');
    const status=document.createElement('p');status.className='mobile-replay-status';status.setAttribute('role','status');status.textContent='映像を読み込んでいます';
    toolbar.append(fallback,fullscreen,close);dialog.append(toolbar,video,status);document.body.append(dialog);
    dialog.style.zoom=String(1/(Number.parseFloat(getComputedStyle(document.body).zoom)||1));
    let disposed=false,wasFullscreen=false;
    const hasAppleFullscreen=typeof video.webkitEnterFullscreen==='function';
    fullscreen.hidden=!hasAppleFullscreen && typeof video.requestFullscreen!=='function';

    function enteredFullscreen(){
      if(disposed)return;
      wasFullscreen=true;dialog.dataset.replayPresentation='native-fullscreen';
    }
    function fullscreenChanged(){
      if(document.fullscreenElement===video)enteredFullscreen();
      else if(wasFullscreen)dispose();
    }
    function dispose(){
      if(disposed)return;disposed=true;
      document.removeEventListener('fullscreenchange',fullscreenChanged);
      video.pause();video.removeAttribute('src');video.load();dialog.remove();
      if(current===dispose)current=null;
      if(trigger?.isConnected && typeof trigger.focus==='function')trigger.focus({preventScroll:true});
    }
    function requestFullscreen(){
      if(disposed || document.fullscreenElement===video || video.webkitDisplayingFullscreen)return;
      try{
        if(hasAppleFullscreen){
          if(video.readyState>=1)video.webkitEnterFullscreen();
        }else if(typeof video.requestFullscreen==='function'){
          const entered=video.requestFullscreen();
          if(entered?.catch)entered.catch(()=>{ /* The visible native full-screen button remains available. */ });
        }
      }catch{ /* Keep native controls and the full-screen button available. */ }
    }
    function tapRequired(){
      if(disposed || dialog.dataset.replayState==='error')return;
      dialog.dataset.replayState='tap-required';status.hidden=false;status.textContent='再生ボタンを押すと視聴できます';
    }
    current=dispose;
    close.addEventListener('click',dispose);
    dialog.addEventListener('cancel',event=>{event.preventDefault();dispose();});
    dialog.addEventListener('close',dispose);
    fullscreen.addEventListener('click',requestFullscreen);
    video.addEventListener('webkitbeginfullscreen',enteredFullscreen);
    video.addEventListener('webkitendfullscreen',()=>{if(wasFullscreen)dispose();});
    document.addEventListener('fullscreenchange',fullscreenChanged);
    video.addEventListener('playing',()=>{if(disposed)return;dialog.dataset.replayState='playing';status.hidden=true;});
    video.addEventListener('error',()=>{if(disposed)return;dialog.dataset.replayState='error';status.hidden=false;status.textContent='映像を読み込めませんでした。「楽天で開く」から確認できます';});
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    video.src=source;
    // No playsinline attribute: iPhone starts its native full-screen player
    // directly from this user-initiated play call, just like Rakuten's player.
    try{const started=video.play();if(started?.catch)started.catch(tapRequired);}catch{tapRequired();}
    // Other mobile browsers use the standard full-screen API in the same tap,
    // before transient user activation expires. Seeking belongs to the browser.
    if(!hasAppleFullscreen)requestFullscreen();
  }

  window.openVideo=function(event,url) {
    if (!window.matchMedia('(max-width: 640px)').matches) return originalOpenVideo(event,url);
    const source=sourceFor(url);
    if (!source) return originalOpenVideo(event,url);
    event.preventDefault();show(source,url,event.currentTarget || document.activeElement);return false;
  };
  window.addEventListener('pagehide',()=>{if(current)current();});
})();
