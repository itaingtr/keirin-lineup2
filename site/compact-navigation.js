// Mirror the current venue links and keep only live rating feedback, not instructions.
(() => {
  'use strict';
  if (document.body.dataset.cardHeader !== 'compact-20261115') return;
  const top = document.getElementById('venue-nav'),bottom = document.getElementById('venue-nav-bottom');
  const main = document.querySelector('main');
  if (!top || !bottom || !main) return;
  function mirror() {
    bottom.replaceChildren(...Array.from(top.children,node=>node.cloneNode(true)));
  }
  function trimHelp() {
    for (const note of main.querySelectorAll('.condition-note')) {
      for (const child of Array.from(note.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains('condition-message')) continue;
        child.remove();
      }
    }
  }
  new MutationObserver(mirror).observe(top,{childList:true});
  new MutationObserver(trimHelp).observe(main,{childList:true});
  mirror();trimHelp();
  document.body.dataset.compactNavigationStatus = 'ready';
})();
