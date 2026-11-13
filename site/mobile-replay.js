/* Mobile replay uses the official MP4 observed in Rakuten's digest player.
 * Playback starts synchronously in the original tap; no media is stored here.
 */
(() => {
  'use strict';
  if (document.body.dataset.historyLayout !== 'compact-20261113' || typeof window.openVideo !== 'function') return;
  const originalOpenVideo = window.openVideo;
  let current = null;
  let useSmallWindow = false;

  const mode=document.createElement('button');mode.type='button';
  mode.className='refresh-button replay-mode-button';
  function labelMode(){
    mode.textContent=useSmallWindow?'動画：小窓':'動画：全画面';
    mode.setAttribute('aria-pressed',String(useSmallWindow));
    mode.setAttribute('aria-label',useSmallWindow?'動画は画面上半分の小窓で表示。押すと全画面に変更':'動画は全画面で表示。押すと画面上半分の小窓に変更');
  }
  labelMode();
  mode.addEventListener('click',()=>{if(current)current();useSmallWindow=!useSmallWindow;labelMode();});
  document.querySelector('.tools')?.append(mode);

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
    const smallWindow=useSmallWindow;
    const dialog=document.createElement('dialog');dialog.className='mobile-replay'+(smallWindow?' mobile-replay-small':'');
    dialog.setAttribute('aria-label','レース映像');dialog.dataset.replayState='loading';
    dialog.dataset.replayPresentation=smallWindow?'small-window':'loading-fullscreen';
    const toolbar=document.createElement('div');toolbar.className='mobile-replay-toolbar';
    const fallback=document.createElement('a');fallback.className='mobile-replay-original';
    fallback.href=pageUrl;fallback.target='_self';fallback.textContent='楽天で開く';
    const fullscreen=document.createElement('button');fullscreen.type='button';fullscreen.className='mobile-replay-fullscreen';fullscreen.textContent='全画面';
    const close=document.createElement('button');close.type='button';close.className='mobile-replay-close';close.textContent='閉じる';
    const video=document.createElement('video');video.className='mobile-replay-video';
    video.controls=true;video.autoplay=true;video.playsInline=smallWindow;video.preload='metadata';
    if(smallWindow)video.setAttribute('webkit-playsinline','');
    video.setAttribute('aria-label','選択したレースの映像');
    const status=document.createElement('p');status.className='mobile-replay-status';status.setAttribute('role','status');status.textContent='映像を読み込んでいます';
    toolbar.append(fallback,fullscreen,close);dialog.append(toolbar,video,status);document.body.append(dialog);
    dialog.style.zoom=String(1/(Number.parseFloat(getComputedStyle(document.body).zoom)||1));
    let disposed=false,wasFullscreen=false,requestPending=false;
    const hasAppleFullscreen=typeof video.webkitEnterFullscreen==='function';
    fullscreen.hidden=!hasAppleFullscreen && typeof video.requestFullscreen!=='function';

    function enteredFullscreen(){
      if(disposed)return;
      wasFullscreen=true;requestPending=false;dialog.dataset.replayPresentation='native-fullscreen';
    }
    function leftFullscreen(){
      if(!wasFullscreen || disposed)return;
      if(smallWindow){wasFullscreen=false;requestPending=false;dialog.dataset.replayPresentation='small-window';}
      else dispose();
    }
    function fullscreenChanged(){
      if(document.fullscreenElement===video)enteredFullscreen();
      else leftFullscreen();
    }
    function dispose(){
      if(disposed)return;disposed=true;
      document.removeEventListener('fullscreenchange',fullscreenChanged);
      video.pause();video.removeAttribute('src');video.load();dialog.remove();
      if(current===dispose)current=null;
      if(trigger?.isConnected && typeof trigger.focus==='function')trigger.focus({preventScroll:true});
    }
    function requestFullscreen(){
      if(disposed || requestPending || wasFullscreen || document.fullscreenElement===video || video.webkitDisplayingFullscreen)return;
      try{
        if(hasAppleFullscreen){
          // WebKit cannot enter its native player before metadata exists.
          // The original synchronous play() unlocks this media element, so
          // loadedmetadata can invoke the SAME API as the working button.
          if(video.readyState<1)return;
          requestPending=true;video.webkitEnterFullscreen();
        }else if(typeof video.requestFullscreen==='function'){
          requestPending=true;
          const entered=video.requestFullscreen();
          if(entered?.catch)entered.catch(()=>{requestPending=false;});
        }
      }catch{requestPending=false; /* A native transition may already be starting. */ }
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
    video.addEventListener('webkitendfullscreen',leftFullscreen);
    video.addEventListener('webkitpresentationmodechanged',()=>{
      if(video.webkitPresentationMode==='fullscreen')enteredFullscreen();
      else if(video.webkitPresentationMode==='inline')leftFullscreen();
    });
    document.addEventListener('fullscreenchange',fullscreenChanged);
    video.addEventListener('loadedmetadata',()=>{if(!smallWindow && hasAppleFullscreen)requestFullscreen();});
    video.addEventListener('playing',()=>{
      if(disposed)return;dialog.dataset.replayState='playing';status.hidden=true;
      if(!smallWindow && hasAppleFullscreen)requestFullscreen();
    });
    video.addEventListener('error',()=>{if(disposed)return;dialog.dataset.replayState='error';status.hidden=false;status.textContent='映像を読み込めませんでした。「楽天で開く」から確認できます';});
    if(smallWindow && typeof dialog.show==='function')dialog.show();
    else if(!smallWindow && typeof dialog.showModal==='function')dialog.showModal();
    else dialog.setAttribute('open','');
    video.src=source;
    // Start in the original tap, before waiting for network/metadata.
    try{const started=video.play();if(started?.catch)started.catch(tapRequired);}catch{tapRequired();}
    // Standard fullscreen must be requested in the original tap. Apple's
    // native video API is also retried once metadata/playback becomes ready.
    if(!smallWindow)requestFullscreen();
  }

  window.openVideo=function(event,url) {
    if (!window.matchMedia('(max-width: 640px)').matches) return originalOpenVideo(event,url);
    const source=sourceFor(url);
    if (!source) return originalOpenVideo(event,url);
    event.preventDefault();show(source,url,event.currentTarget || document.activeElement);return false;
  };
  window.addEventListener('pagehide',()=>{if(current)current();});
})();
