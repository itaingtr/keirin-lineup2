// Reuse the existing feed validation, refresh control and comparison matrices.
(() => {
  'use strict';
  const root = document.getElementById('rows');
  if (!root || document.body.dataset.oddsOverlay !== 'up-20261116') return;
  const states = new WeakMap();
  const clock = new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let active = null, queued = false, positioned = false;

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
    const state = {row, button, panel, refresh, status, trigger:null};
    states.set(row, state);
    return state;
  }

  function position(state) {
    if (state.panel.hidden || !state.row.isConnected) return;
    const lineup = state.row.querySelector('.lineup');
    const band = lineup?.querySelector('.rider-odds');
    if (!lineup) return;
    const zoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
    const rowBox = state.row.getBoundingClientRect(), lineBox = lineup.getBoundingClientRect();
    const anchor = (band || lineup).getBoundingClientRect();
    const gap = 2, viewportTop = window.visualViewport?.offsetTop || 0;
    state.panel.style.setProperty('--odds-anchor-x', ((lineBox.left - rowBox.left) / zoom - state.row.clientLeft) + 'px');
    state.panel.style.setProperty('--odds-anchor-y', ((anchor.top - rowBox.top) / zoom - state.row.clientTop - gap) + 'px');
    state.panel.style.setProperty('--odds-available-height', Math.max(20, (anchor.top - viewportTop - 4) / zoom - gap) + 'px');
  }

  function close(state) {
    if (!state || state.panel.hidden) return;
    state.button.click();
  }

  function synchronize(state) {
    const open = !state.panel.hidden;
    // The original control adds a grid row. This panel has no layout slot.
    state.row.classList.remove('odds-open');
    state.row.classList.toggle('odds-up-open', open);
    for (const band of state.row.querySelectorAll('.lineup .rider-odds')) {
      attribute(band, 'role', 'button');
      attribute(band, 'tabindex', '0');
      attribute(band, 'aria-label', '二車単オッズを' + (open ? '閉じるにゃ' : '上に開くにゃ'));
      attribute(band, 'aria-expanded', String(open));
      attribute(band, 'aria-controls', state.panel.id);
    }
    if (open) {
      if (active && active !== state) close(active);
      active = state;
      position(state);
    } else if (active === state) active = null;
  }

  function decorate(state) {
    const table = state.panel.querySelector('.exacta-matrix[data-odds-order="number"]');
    state.panel.classList.toggle('odds-has-matrix', Boolean(table));
    if (!table) {
      // A failed initial read must still leave the original retry available.
      if (!state.panel.contains(state.refresh)) state.panel.prepend(state.refresh);
      return;
    }
    const first = [...table.querySelectorAll('.exacta-column-rider')]
      .find(node => node.querySelector('.exacta-number')?.textContent === '1');
    const name = first?.querySelector('.exacta-rider-name');
    if (!name) return;
    let tools = first.querySelector('.exacta-name-tools');
    if (!tools) {
      const row = document.createElement('span');
      row.className = 'exacta-name-row';
      tools = document.createElement('span');
      tools.className = 'exacta-name-tools';
      const time = document.createElement('time');
      time.className = 'exacta-time';
      name.replaceWith(row);
      tools.append(state.refresh, time);
      row.append(name, tools);
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

  function update() {
    queued = false;
    if (active && !active.row.isConnected) active = null;
    for (const row of root.children) {
      const state = prepare(row);
      if (!state) continue;
      decorate(state);
      synchronize(state);
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }

  function reposition() {
    if (positioned || !active) return;
    positioned = true;
    requestAnimationFrame(() => { positioned = false; if (active) position(active); });
  }

  root.addEventListener('click', event => {
    const band = event.target.closest('.lineup .rider-odds');
    if (band) {
      const state = prepare(band.closest('#rows > tr'));
      if (!state) return;
      event.preventDefault();
      state.trigger = band;
      state.button.click();
    } else if (event.target.closest('.odds-toggle')) {
      const state = prepare(event.target.closest('#rows > tr'));
      if (state) synchronize(state);
    }
  });
  root.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('.rider-odds[role="button"]')) return;
    event.preventDefault();
    event.target.click();
  });
  document.addEventListener('click', event => {
    if (active && !active.panel.contains(event.target) && !event.target.closest('.rider-odds,.odds-toggle')) close(active);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    const trigger = active.trigger;
    close(active);
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
  });
  window.addEventListener('resize', reposition, {passive:true});
  window.addEventListener('scroll', reposition, {passive:true});
  window.visualViewport?.addEventListener('resize', reposition, {passive:true});
  window.visualViewport?.addEventListener('scroll', reposition, {passive:true});
  new MutationObserver(schedule).observe(root, {childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-busy','disabled']});
  update();
})();
