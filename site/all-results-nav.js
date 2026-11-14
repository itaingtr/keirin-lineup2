// Use this card's verified date, including archived and next-day cards.
(() => {
  'use strict';
  const date = document.body.dataset.allResultsDate;
  const nav = document.getElementById('venue-nav');
  if (!nav || !/^\d{8}$/.test(date || '')) return;
  function attach() {
    let link = nav.querySelector('.all-results-button');
    if (!link) {
      link = document.createElement('a');
      link.className = 'venue-button all-results-button';
      nav.append(link);
    }
    link.textContent = '全結果';
    link.href = '/keirin-lineup2/results' + date + '.html';
    link.setAttribute('aria-label',date.slice(0,4)+'年'+date.slice(4,6)+'月'+date.slice(6)+'日の全出走表と全結果を開く');
  }
  new MutationObserver(changes => {
    if (changes.some(change => change.target === nav)) {
      const link = nav.querySelector('.all-results-button');
      if (!link) attach();
    }
  }).observe(nav,{childList:true});
  attach();
})();
