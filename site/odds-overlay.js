// Inline upward expansion using the existing verified readers and controls.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.oddsOverlay !== 'up-20261116') return;
  const states = new WeakMap();
  const pending = new Set();
  const clock = new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let queued = false, finishing = false;

  function attribute(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  function prepare(row) {
    if (states.has(row)) return states.get(row);
    const button = row.querySelector('.odds-toggle'), panel = row.querySelector(':scope > .odds-cell');
    const refresh = panel?.querySelector('.odds-refresh'), status = panel?.querySelector('.odds-status');
    if (!button || !panel || !refresh || !status) return null;
    button.hidden = true;
    refresh.setAttribute('aria-label', '二車単オッズを更新するにゃ');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '二車単オッズにゃ');
    const state = {row, button, panel, refresh, status, anchor:null, focus:null};
    states.set(row, state);
    return state;
  }

  function begin(state) {
    const node = state.row.querySelector('.lineup');
    if (!node) return;
    state.anchor = {node, top:node.getBoundingClientRect().top};
    const focused = document.activeElement;
    if (focused?.matches('.rider-odds') && state.row.contains(focused)) {
      state.focus = {node:focused, car:focused.closest('.rider').querySelector('.car')?.textContent};
    } else state.focus = focused === state.refresh ? {node:focused, refresh:true} : null;
    pending.add(state);
    // Prevent the browser and this explicit, user-requested compensation
    // from both adjusting the same expansion. Restore normal anchoring later.
    document.documentElement.dataset.oddsLayoutChange = 'true';
  }

  function preserve(state) {
    const anchor = state.anchor;
    if (!anchor?.node.isConnected) return;
    const delta = anchor.node.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > .5) window.scrollBy({left:0, top:delta, behavior:'auto'});
  }

  function preserveFocus(state) {
    if (!state.focus || document.activeElement !== document.body) return;
    const node = state.focus.refresh ? state.refresh : [...state.row.querySelectorAll('.lineup .rider')]
      .find(rider => rider.querySelector('.car')?.textContent === state.focus.car)?.querySelector('.rider-odds');
    if (node?.isConnected) {
      node.focus({preventScroll:true});
      state.focus.node = node;
    }
  }

  function finish() {
    if (finishing || !pending.size) return;
    finishing = true;
    requestAnimationFrame(() => {
      for (const state of pending) preserve(state);
      requestAnimationFrame(() => {
        finishing = false;
        for (const state of pending) {
          preserve(state);
          if (!state.row.isConnected || state.panel.hidden || !state.panel.hasAttribute('aria-busy')) {
            state.anchor = null;
            state.focus = null;
            pending.delete(state);
          }
        }
        if (!pending.size) delete document.documentElement.dataset.oddsLayoutChange;
      });
    });
  }

  function synchronize(state) {
    const open = !state.panel.hidden;
    for (const band of state.row.querySelectorAll('.lineup .rider-odds')) {
      attribute(band, 'role', 'button');
      attribute(band, 'tabindex', '0');
      attribute(band, 'aria-label', '二車単オッズを' + (open ? '閉じるにゃ' : '上に開くにゃ'));
      attribute(band, 'aria-expanded', String(open));
      attribute(band, 'aria-controls', state.panel.id);
    }
  }

  function decorate(state) {
    const table = mixedAxes(state);
    state.panel.classList.toggle('odds-has-matrix', Boolean(table));
    if (!table) {
      // A failed initial read must still leave the original retry available.
      if (!state.panel.contains(state.refresh)) state.panel.prepend(state.refresh);
      return;
    }
    // Use the empty corner above the second-place labels. Every name keeps
    // its original, centered position directly beneath its car number.
    const corner = table.tHead.rows[0].cells[0];
    let tools = corner.querySelector('.exacta-corner-tools');
    if (!tools) {
      tools = document.createElement('span');
      tools.className = 'exacta-corner-tools';
      const time = document.createElement('time');
      time.className = 'exacta-time';
      tools.append(state.refresh, time);
      corner.append(tools);
    }
    const time = tools.querySelector('.exacta-time');
    const observed = table.dataset.observedAt;
    if (Number.isFinite(Date.parse(observed))) {
      const value = clock.format(new Date(observed));
      if (time.textContent !== value) time.textContent = value;
      attribute(time, 'datetime', observed);
      attribute(time, 'aria-label', '取得時刻 ' + value + 'にゃ');
    }
    const stale = !state.panel.hasAttribute('aria-busy') && !state.status.textContent.startsWith('取得時刻：');
    attribute(time, 'data-stale', String(stale));
    attribute(time, 'title', state.status.textContent);
    attribute(state.refresh, 'title', stale ? state.status.textContent : '二車単オッズを更新するにゃ');
  }

  function mixedAxes(state) {
    const existing = state.panel.querySelector('.exacta-matrix[data-odds-order="hybrid"]');
    if (existing) return existing;
    const table = state.panel.querySelector('.exacta-matrix[data-odds-order="lineup"]');
    if (!table) return null;
    const body = table.tBodies[0], rows = [...body.rows];
    const first = [...table.tHead.rows[0].cells].slice(1, -1)
      .map(cell => Number(cell.querySelector('.exacta-number')?.textContent));
    const second = row => Number(row.cells[0].querySelector('.exacta-number')?.textContent);
    const numbers = rows.map(second);
    if (new Set(numbers).size !== first.length || numbers.length !== first.length || !first.every(number => numbers.includes(number))) return null;
    // Only move complete source rows. Each cell retains its first-second
    // identity and price; contested alternatives still use the source columns.
    rows.sort((a, b) => second(a) - second(b));
    for (const row of rows) row.classList.remove('exacta-line-row-start');
    body.append(...rows);
    table.dataset.oddsOrder = 'hybrid';
    table.dataset.secondAxisOrder = rows.map(second).join('-');
    table.setAttribute('aria-label', '1着はライン順・2着は車番順の二車単オッズにゃ');
    // Keep the native live status even when its old numeric figure is removed.
    if (state.status.parentElement !== state.panel) state.panel.append(state.status);
    state.panel.querySelector('.exacta-matrix[data-odds-order="number"]')?.closest('.odds-comparison-view')?.remove();
    return table;
  }

  function update() {
    queued = false;
    for (const row of root.children) {
      const state = prepare(row);
      if (!state) continue;
      decorate(state);
      synchronize(state);
      preserveFocus(state);
    }
    finish();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }

  root.addEventListener('click', event => {
    if (!event.target.closest('.odds-toggle,.odds-refresh')) return;
    const state = prepare(event.target.closest('#rows > tr'));
    if (state) begin(state);
  }, true);
  root.addEventListener('click', event => {
    const band = event.target.closest('.lineup .rider-odds');
    if (band) {
      const state = prepare(band.closest('#rows > tr'));
      if (!state) return;
      event.preventDefault();
      state.button.click();
    } else if (event.target.closest('.odds-toggle')) {
      const state = prepare(event.target.closest('#rows > tr'));
      if (state) {
        synchronize(state);
        finish();
      }
    }
  });
  root.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('.rider-odds[role="button"]')) return;
    event.preventDefault();
    event.target.click();
  });
  // A deliberate scroll while a read is pending becomes the new reference.
  // Never restore an old page position after the user has moved elsewhere.
  function rememberScroll() {
    for (const state of pending) if (state.anchor?.node.isConnected) {
      state.anchor.top = state.anchor.node.getBoundingClientRect().top;
    }
  }
  window.addEventListener('scroll', rememberScroll, {passive:true});
  window.addEventListener('resize', rememberScroll, {passive:true});
  window.visualViewport?.addEventListener('scroll', rememberScroll, {passive:true});
  new MutationObserver(schedule).observe(root, {childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-busy','disabled']});
  update();
})();
