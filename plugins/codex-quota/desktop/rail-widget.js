/* Owned overlays for quota and thread usage; only reads native geometry/IDs. */
(function installQuotaRail() {
  'use strict';
  const key = '__codexQuotaRailV1';
  const allowed = location.protocol === 'app:' && ['-', 'app'].includes(location.hostname) && !/avatar|composition|detached-window|pet-overlay/i.test(location.href) ||
    location.protocol === 'file:' && /\/(?:webview\/index\.html|codex-quota-fixture\.html)$/.test(location.pathname.replaceAll('\\', '/'));
  if (window !== window.top || !allowed || window[key]) return;
  const rowSelector = '[data-app-action-sidebar-thread-id]';
  const idPattern = /^(?:(?:local|thread)[:/|])?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
  const effortLabels = new Map(Object.entries({ none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }));
  let host, root, stack, panel, turnLayer, data, lease, frame, hideTimer, threadTimer, anchor, detail, threadId, threadUsage;
  const turnBadges = new Map(), turnValues = new Map();
  let lastTurnRequest = 0;
  const ask = action => { if (typeof window.__codexQuotaActionV2 === 'function') window.__codexQuotaActionV2(action); };
  const zh = () => data?.language !== 'en';
  const t = (cn, en) => zh() ? cn : en;
  const full = value => quotaDisplay.full(value, data?.language);
  const number = (value, precision) => quotaDisplay.compact(value, data?.language, precision);
  const percent = value => Number.isFinite(value?.remaining) ? Math.round(Math.max(0, Math.min(100, value.remaining))) : null;
  const pct = remaining => remaining == null ? '—' : remaining + '%';
  const level = remaining => remaining == null ? 'unknown' : remaining <= 20 ? 'low' : remaining <= 50 ? 'caution' : 'healthy';
  const date = value => Number.isFinite(value) ? new Date(value).toLocaleString(zh() ? 'zh-CN' : 'en-US', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
  const shortDate = (value, weekly) => Number.isFinite(value) ? new Intl.DateTimeFormat(zh() ? 'zh-CN' : 'en-GB', weekly ? {month:'2-digit',day:'2-digit'} : {hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value) : '—';
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  }
  function svg(tag, attributes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }
  function openUsage() {
    closeDetail();
    // This is the same fixed route used by the desktop usage entry.
    if (location.protocol === 'app:' && typeof window.electronBridge?.sendMessageFromView === 'function') {
      try { Promise.resolve(window.electronBridge.sendMessageFromView({ type: 'navigate-to-route', path: '/settings/usage' })).catch(() => ask('official')); return; } catch {}
    }
    ask('official');
  }
  function mount() {
    if (host || !document.body) return;
    host = element('div'); host.id = 'codex-quota-rail-v1';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147482999;pointer-events:none';
    root = host.attachShadow({ mode: 'open' });
    const style = element('style');
    style.textContent = `
      :host {
        color-scheme: light dark;
        font: 12px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
        --ink: var(--display-ink, light-dark(#20252b, #f8f9fa));
        --muted: light-dark(#545c66, #b7bbc2);
        --base: light-dark(#f2f3f5, #252629);
        --card: var(--display-card, light-dark(#fff, #2c2e31));
        --edge: light-dark(#cfd3d9, #494b50);
        --line: light-dark(#252c3814, #fff1);
        --track: light-dark(#e1e4e9, #45474c);
        --accent: var(--display-accent, light-dark(#176e4c, #63d5a0));
        --tint: color-mix(in srgb, var(--accent) 15%, var(--base));
        --green: var(--display-main, light-dark(#16835a, #5ed29b));
        --yellow: light-dark(#946400, #f1c75b);
        --red: light-dark(#c23242, #f47c85);
      }
      * { box-sizing: border-box; }
      button { font: inherit; color: inherit; cursor: pointer; }
      button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      .stack, .panel { position: fixed; pointer-events: auto; color: var(--ink); background: var(--base); }
      [hidden] { display: none !important; }
      .stack {
        --u: 1px;
        --ring-size: 33;
        --quota-inset: 2;
        --reset-gap: 1.5;
        display: grid;
        gap: calc(3 * var(--u));
        padding: calc(4 * var(--u)) calc(3 * var(--u));
        border: 1px solid var(--edge);
        border-radius: calc(8 * var(--u));
        box-shadow: inset 0 0 0 1px var(--line), 0 2px 5px #0002;
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
      .limit, .mini, .end {
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: calc(6 * var(--u));
        background: var(--card);
      }
      .limit {
        display: grid;
        justify-items: center;
        gap: calc(var(--reset-gap) * var(--u));
        padding: calc(var(--quota-inset) * var(--u)) 0 calc((var(--quota-inset) + 1) * var(--u));
      }
      .limit:hover, .mini:hover { border-color: var(--edge); }
      .dial {
        position: relative;
        display: grid;
        place-items: center;
        width: clamp(22px, calc(var(--ring-size) * var(--u) * var(--ring-scale)), calc(39 * var(--u)));
        aspect-ratio: 1;
      }
      .ring { position: absolute; inset: 0; width: 100%; height: 100%; fill: none; stroke-width: 2.2; }
      .ring-track { stroke: var(--track); }
      .ring-fill { stroke: var(--tone); }
      [data-depleted] .ring-track { stroke: color-mix(in srgb, var(--red) 45%, var(--track)); }
      [data-level="healthy"] { --tone: var(--green); }
      [data-level="caution"] { --tone: var(--yellow); }
      [data-level="low"] { --tone: var(--red); }
      [data-level="unknown"] { --tone: var(--muted); }
      .metrics { display: grid; justify-items: center; gap: calc(1 * var(--u)); line-height: 1; }
      .period, .reset { color: var(--display-ink, var(--muted)); font-size: calc(max(7px, 7 * var(--u)) * var(--font-scale)); }
      .metrics b { color: var(--display-ink, var(--accent)); font-size: min(calc(max(8px, 9 * var(--u)) * var(--font-scale)), calc(8 * var(--u) * var(--ring-scale) + 2px)); font-weight: 740; }
      .reset { display: grid; line-height: 1.05; }
      .weekly .reset { min-height: 2lh; align-content: center; }
      .pair { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: calc(2 * var(--u)); }
      .mini {
        display: grid;
        align-content: center;
        gap: calc(1 * var(--u));
        padding: calc(2 * var(--u)) 0;
        font-size: calc(max(6px, 5.5 * var(--u)) * var(--font-scale));
        line-height: 1.1;
        color: var(--display-ink, var(--muted));
        white-space: nowrap;
      }
      .mini b {
        font-size: calc(max(7px, 7.5 * var(--u)) * var(--font-scale));
        color: var(--ink);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mini b.long { font-size: min(calc(7px * var(--font-scale)), calc(7 * var(--u))); letter-spacing: -.2px; }
      .end {
        display: grid;
        grid-template-columns: minmax(0, 1fr) max(14px, calc(14 * var(--u)));
        align-items: center;
        min-height: calc(16 * var(--u));
        border-radius: 999px;
        background: var(--tint);
      }
      .plan {
        padding: 2px;
        color: var(--accent);
        font-size: calc(max(7px, 7 * var(--u)) * var(--font-scale));
        font-weight: 750;
        line-height: 1.05;
        overflow-wrap: anywhere;
      }
      .gear {
        position: relative;
        display: grid;
        place-items: center;
        align-self: stretch;
        padding: 0;
        border: 0;
        border-radius: inherit;
        color: var(--muted);
        background: none;
      }
      .gear::before { content: ""; position: absolute; inset: 22% auto 22% 0; border-left: 1px solid currentColor; opacity: .35; }
      .gear:hover { color: var(--accent); }
      .gear svg { width: max(9px, calc(9 * var(--u))); height: auto; }
      .stack.compact {
        --ring-size: 29;
        --quota-inset: .5;
        --reset-gap: 0;
        gap: calc(2 * var(--u));
        padding-block: calc(2 * var(--u));
      }
      .compact .metrics { gap: 0; }
      .compact .mini { padding-block: 1px; }
      .compact .end { min-height: max(14px, calc(14 * var(--u))); }
      .stack.gear-only { padding: 2px; border-radius: 9px; }
      .gear-only > :not(.end), .gear-only .plan, .gear-only .gear::before { display: none; }
      .gear-only .end { grid-template-columns: 1fr; min-height: 22px; }
      .gear-only .gear svg { width: 13px; }
      .panel {
        width: 258px;
        max-width: calc(100vw - 16px);
        max-height: min(410px, 80vh);
        overflow: auto;
        padding: 14px;
        border: 1px solid var(--edge);
        border-radius: 11px;
        box-shadow: 0 12px 36px #0003;
        line-height: 1.5;
      }
      .panel h3 { margin: 0 0 8px; font-size: 14px; }
      .panel p { margin: 6px 0; color: var(--muted); font-size: 11px; }
      .panel .big { font-size: calc(25px * var(--font-scale)); font-weight: 720; color: var(--tone, var(--accent)); }
      .panel .exact { color: var(--muted); font-size: 10px; }
      .panel .track { height: 5px; border-radius: 3px; background: var(--track); overflow: hidden; }
      .panel .track i { display: block; height: 100%; background: var(--tone); }
      .panel .item { padding: 7px 0; border-bottom: 1px solid var(--line); }
      .panel .official { width: 100%; margin-top: 10px; border: 1px solid var(--edge); border-radius: 7px; background: var(--card); padding: 6px; }
      .panel .official:hover { border-color: var(--accent); }
      .stale { opacity: .68; }
      .turn-badge {
        position: fixed;
        white-space: nowrap;
        font-size: calc(11px * var(--font-scale));
        font-variant-numeric: tabular-nums;
        color: var(--accent);
        font-weight: 600;
        pointer-events: auto;
      }
    `;
    stack = element('div', 'stack'); stack.hidden = true; stack.setAttribute('aria-label', 'Codex Quota');
    for (const name of ['short', 'weekly']) {
      const button = element('button', 'limit ' + name); button.type = 'button';
      const dial = element('span', 'dial');
      const ring = svg('svg', { class: 'ring', viewBox: '0 0 36 36', 'aria-hidden': 'true' });
      const circle = { cx: 18, cy: 18, r: 16.9 };
      ring.append(svg('circle', { ...circle, class: 'ring-track' }),
        svg('circle', { ...circle, class: 'ring-fill', pathLength: 100, transform: 'rotate(-90 18 18)' }));
      const metrics = element('span', 'metrics');
      metrics.append(element('span', 'period', name === 'short' ? '5h' : '7d'), element('b', '', '—'));
      dial.append(ring, metrics);
      button.append(dial, element('span', 'reset', '—')); stack.append(button); bindDetail(button, name);
      button.addEventListener('click', () => openDetail(name, button));
    }
    const extra = element('div', 'pair');
    for (const name of ['credits','resets']) {
      const button = element('button', 'mini ' + name); button.type = 'button';
      button.append(element('span'), element('b', '', '—')); extra.append(button); bindDetail(button, name);
      button.addEventListener('click', openUsage);
    }
    const end = element('div', 'end'); const gear = element('button', 'gear'); gear.type = 'button';
    const icon = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    icon.append(svg('path', { d: 'M10.5 2h3l.7 3 1.3.6 2.6-1.6 1.9 1.9-1.6 2.6.6 1.3 3 .7v3l-3 .7-.6 1.3 1.6 2.6-1.9 1.9-2.6-1.6-1.3.6-.7 3h-3l-.7-3-1.3-.6-2.6 1.6L4 18.1l1.6-2.6-.6-1.3-3-.7v-3l3-.7.6-1.3L4 5.9 5.9 4l2.6 1.6L9.8 5z' }),
      svg('circle', { cx: 12, cy: 12, r: 3.5 }));
    gear.append(icon);
    gear.addEventListener('click', () => { closeDetail(); ask('settings'); });
    end.append(element('span', 'plan', '—'), gear);
    panel = element('div', 'panel'); panel.hidden = true;
    panel.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    panel.addEventListener('pointerleave', closeLater);
    turnLayer = element('div', 'turn-layer');
    stack.append(extra, end); root.append(style, stack, panel, turnLayer); document.body.append(host);
  }
  function bindDetail(node, name) {
    node.addEventListener('pointerenter', () => openDetail(name, node));
    node.addEventListener('pointerleave', closeLater);
    node.addEventListener('focus', () => openDetail(name, node));
    node.addEventListener('blur', closeLater);
  }
  function closeDetail() { clearTimeout(hideTimer); clearTimeout(threadTimer); detail = anchor = threadId = null; if (panel) panel.hidden = true; }
  function closeLater() { clearTimeout(threadTimer); clearTimeout(hideTimer); hideTimer = setTimeout(closeDetail, 230); }
  function openDetail(name, node) {
    clearTimeout(hideTimer); detail = name; anchor = node; paintDetail();
  }
  function paintDetail() {
    if (!anchor?.isConnected || !data || Date.now() > lease) { closeDetail(); return; }
    panel.replaceChildren();
    const title = {short:t('5 小时额度','5-hour quota'),weekly:t('7 天额度','Weekly quota'),credits:t('Codex 点数','Codex credits'),resets:t('重置卡','Saved resets'),thread:t('此会话 Token 用量','Tokens in this chat')}[detail];
    panel.append(element('h3', '', title));
    if (detail === 'short' || detail === 'weekly') {
      const value = data[detail], remaining = percent(value);
      panel.dataset.level = level(remaining);
      panel.append(element('div', 'big', pct(remaining)));
      const track = element('div', 'track'); const fill = element('i'); fill.style.width = (remaining ?? 0) + '%'; track.append(fill);
      panel.append(track, element('p', '', t('重置时间：','Resets: ') + date(value?.resetsAt)));
    } else if (detail === 'credits') {
      const value = quotaDisplay.creditValue(data.credits);
      const balance = element('div', 'big', data.credits?.unlimited ? t('不限','Unlimited') : number(value, 0));
      balance.title = data.credits?.unlimited ? balance.textContent : full(value);
      panel.append(balance, element('p', '', t('独立点数余额，点击额度图标查看官方详情。','Separate credit balance. Click the quota icon for official details.')));
    } else if (detail === 'resets') {
      panel.append(element('p', '', data.resets ? t('剩余 ', 'Available: ') + number(data.resets.count) + t(' 张','') : t('重置卡数据暂不可用','Reset data unavailable')));
      data.resets?.cards.forEach((card, i) => panel.append(element('div', 'item', t('重置卡 ', 'Reset ') + (i + 1) + ' · ' + t('到期 ', 'Expires ') + date(card.expiresAt))));
      const button = element('button', 'official', t('前往官方页面使用','Open official usage page')); button.type = 'button';
      button.addEventListener('click', () => { closeDetail(); ask('official'); }); panel.append(button);
    } else {
      if (!threadUsage) panel.append(element('p', '', threadUsage === undefined ? t('读取本机记录…','Reading local history…') : t('没有此会话的本机统计','No local stats for this chat')));
      else {
        const total = number(threadUsage.total);
        panel.append(element('div', 'big', total));
        if (total.startsWith('≈')) panel.append(element('div', 'exact', full(threadUsage.total) + ' Token'));
        for (const [k, label] of [['input',t('输入','Input')],['cached',t('其中缓存','Cached input')],['output',t('输出','Output')],['reasoning',t('其中推理','Reasoning output')]]) {
          const row = element('div', 'item', label + ' · ' + number(threadUsage[k]));
          row.title = full(threadUsage[k]);
          panel.append(row);
        }
        if (threadUsage.estimated) panel.append(element('p', '', t('服务端估算','Account estimate')));
      }
    }
    if (detail !== 'short' && detail !== 'weekly') delete panel.dataset.level;
    if (detail !== 'thread' && data.error) panel.append(element('p', '', t('显示上次同步的数据','Showing last synced data')));
    panel.hidden = false;
    positionDetail();
  }
  function positionDetail() {
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    const x = Math.max(6, Math.min(rect.right + 9, innerWidth - width - 8));
    const y = Math.max(6, Math.min(rect.top, innerHeight - height - 8));
    const tooltips = detail === 'thread' ? [...document.querySelectorAll('[role="tooltip"]')]
      .map(node => node.getBoundingClientRect()).filter(r => r.width && r.height) : [];
    const candidates = [[x, y], ...tooltips.flatMap(r => [[x, r.bottom + 8], [x, r.top - height - 8], [r.right + 8, y]])];
    const position = candidates.find(([left, top]) => left >= 6 && top >= 6 && left + width <= innerWidth - 6 &&
      top + height <= innerHeight - 6 && !tooltips.some(r => left < r.right + 4 && left + width > r.left - 4 && top < r.bottom + 4 && top + height > r.top - 4));
    panel.style.visibility = position ? 'visible' : 'hidden';
    if (position) {
      panel.style.left = position[0] + 'px';
      panel.style.top = position[1] + 'px';
    }
  }
  function findSlot(lane, obstacles, height) {
    let lower = Math.max(4, lane.top + 4), best = null;
    const upper = Math.min(innerHeight - 4, lane.bottom - 4);
    for (const r of obstacles.sort((a,b) => a.top - b.top)) {
      if (r.bottom + 4 < lower) continue;
      const limit = Math.min(upper, r.top - 4);
      if (limit - lower >= height) best = limit - height;
      lower = Math.max(lower, r.bottom + 4);
      if (lower >= upper) break;
    }
    return upper - lower >= height ? upper - height : best;
  }
  function layout() {
    frame = 0; mount(); if (!host) return;
    if (!data || Date.now() > lease) { stack.hidden = true; turnLayer.hidden = true; closeDetail(); return; }
    const nav = [...document.querySelectorAll('[data-app-navigation-rail]')].find(node => {
      const r = node.getBoundingClientRect(); return r.width >= 32 && r.width <= 100 && r.height >= 100 && r.left < 100 && r.right > 0 && !node.closest('[aria-hidden="true"],[inert]') && getComputedStyle(node).visibility !== 'hidden';
    });
    host.style.colorScheme = quotaDisplay.colorScheme(nav || document.body, data.theme);
    layoutTurns();
    if (!nav || data.display?.sidebar === false) { stack.hidden = true; if (detail && detail !== 'thread') closeDetail(); else if (detail) positionDetail(); return; }
    const lane = nav.getBoundingClientRect();
    const controls = [...nav.querySelectorAll('button,a,[role="button"],[role="menuitem"]'), ...document.querySelectorAll('[data-orbit-profile-trigger]')];
    const obstacles = controls.map(node => node.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0 && r.left < lane.right && r.right > lane.left);
    const width = Math.min(72, lane.width - 4);
    stack.style.width = width + 'px';
    stack.style.setProperty('--u', width / 48 + 'px');
    const modes = lane.width >= 42 ? ['full', 'compact', 'gear-only'] : ['gear-only'];
    let y = null;
    stack.hidden = false;
    for (const mode of modes) {
      stack.className = 'stack ' + mode + (data.error ? ' stale' : '');
      y = findSlot(lane, obstacles, stack.getBoundingClientRect().height);
      if (y !== null) break;
    }
    if (y === null) { stack.hidden = true; if (detail !== 'thread') closeDetail(); else positionDetail(); return; }
    stack.style.left = Math.max(1, lane.left + (lane.width - width) / 2) + 'px';
    stack.style.top = y + 'px';
    if (detail && (!anchor?.isConnected || !anchor.getClientRects().length)) closeDetail();
    if (detail) positionDetail();
  }
  function paintStack() {
    quotaDisplay.apply(host, data.display, 'sidebar');
    for (const name of ['short','weekly']) {
      const button = stack.querySelector('.' + name); const value = data[name], remaining = percent(value);
      button.hidden = data.display?.[name] === false;
      button.querySelector('b').textContent = pct(remaining);
      button.dataset.level = level(remaining);
      button.toggleAttribute('data-depleted', remaining === 0);
      const fill = button.querySelector('.ring-fill');
      fill.style.visibility = remaining ? 'visible' : 'hidden';
      if (remaining && remaining < 100) fill.setAttribute('stroke-dasharray', remaining + ' 100');
      else fill.removeAttribute('stroke-dasharray');
      const reset = button.querySelector('.reset');
      if (name === 'weekly' && Number.isFinite(value?.resetsAt)) reset.replaceChildren(element('span','',shortDate(value.resetsAt,true)),element('span','',shortDate(value.resetsAt,false)));
      else reset.textContent = shortDate(value?.resetsAt, false);
      const label = name === 'short' ? t('5 小时额度','5-hour quota') : t('7 天额度','Weekly quota');
      button.setAttribute('aria-label', label + ' · ' + (remaining == null ? t('额度暂不可用','Quota unavailable') : pct(remaining)) +
        (Number.isFinite(value?.resetsAt) ? ' · ' + t('重置时间：','Resets: ') + date(value.resetsAt) : ''));
    }
    const credits = stack.querySelector('.credits'), resets = stack.querySelector('.resets');
    credits.hidden = data.display?.credits === false;
    credits.querySelector('span').textContent = t('点数','Pts');
    const balance = quotaDisplay.creditValue(data.credits), balanceText = credits.querySelector('b');
    balanceText.textContent = data.credits?.unlimited ? '∞' : number(balance, 0).replaceAll(',', '');
    balanceText.classList.toggle('long', balanceText.textContent.length > 2);
    credits.title = data.credits?.unlimited ? balanceText.textContent : full(balance);
    resets.hidden = data.display?.resets === false;
    credits.parentElement.hidden = credits.hidden && resets.hidden;
    resets.querySelector('span').textContent = t('重置','Reset'); resets.querySelector('b').textContent = number(data.resets?.count, 0);
    resets.title = full(data.resets?.count);
    credits.setAttribute('aria-label', t('Codex 点数详情','Codex credits')); resets.setAttribute('aria-label', t('重置卡详情','Saved resets'));
    const plan = stack.querySelector('.plan'); plan.title = quotaDisplay.planLabel(data.plan); plan.textContent = plan.title || '—';
    const gear = stack.querySelector('.gear'); gear.title = t('用量助手设置','Quota settings'); gear.setAttribute('aria-label', gear.title);
  }
  function layoutTurns() {
    turnLayer.hidden = false;
    const visible = new Set(), request = [];
    const now = Date.now();
    for (const row of document.querySelectorAll('[data-content-search-turn-key]')) {
      const id = row.getAttribute('data-content-search-turn-key')?.match(idPattern)?.[1]?.toLowerCase();
      if (!id || !row.closest('[data-turn-key]') || row.closest('[aria-hidden="true"],[inert]')) continue;
      const duration = [...row.querySelectorAll('button,summary,[role="button"]')].find(button =>
        /^(?:用时|耗时|worked for|thought for|spent)/i.test(button.textContent.trim()));
      if (!duration) continue;
      const box = duration.getBoundingClientRect(), line = duration.parentElement.getBoundingClientRect();
      if (!box.width || !box.height || box.top < 0 || box.bottom > innerHeight) continue;
      const hit = document.elementFromPoint(box.left + Math.min(box.width / 2, 24), box.top + box.height / 2);
      if (!duration.contains(hit)) continue;
      const result = turnValues.get(id);
      if (!result || now - result.at > 12000) request.push(id);
      if (result?.total == null && !result?.effort && !result?.model) continue;
      let badge = turnBadges.get(id);
      if (!badge) {
        badge = element('span', 'turn-badge');
        turnLayer.append(badge); turnBadges.set(id, badge);
      }
      const tokens = result.total == null ? '' : number(result.total) + ' Token';
      const effort = result.effort ? t('推理 ' + (effortLabels.get(result.effort) || result.effort), 'Reasoning ' + result.effort) : '';
      const labels = [tokens, result.model, effort].filter(Boolean);
      badge.textContent = labels.join(' · ');
      badge.title = [tokens && t('本轮用量 · ', 'This turn · ') + full(result.total) + ' Token',
        result.model && t('本轮模型 · ', 'Model · ') + result.model,
        effort && t('推理强度 · ', 'Reasoning effort · ') + result.effort].filter(Boolean).join('\n');
      badge.hidden = false;
      const left = Math.ceil(box.right + 8);
      const right = Math.min(line.right, innerWidth - 8);
      while (labels.length > 1 && left + badge.offsetWidth > right) {
        labels.pop();
        badge.textContent = labels.join(' · ');
      }
      if (left + badge.offsetWidth > right) { badge.hidden = true; visible.add(id); continue; }
      badge.style.left = left + 'px';
      badge.style.top = Math.round(box.top + (box.height - badge.offsetHeight) / 2) + 'px';
      visible.add(id);
    }
    for (const [id, badge] of turnBadges) if (!visible.has(id)) { badge.remove(); turnBadges.delete(id); }
    for (const [id, value] of turnValues) if (now - value.at > 120000) turnValues.delete(id);
    if (request.length && now - lastTurnRequest >= 750) {
      lastTurnRequest = now;
      ask('turns:' + [...new Set(request)].slice(0, 36).join(','));
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
  function over(event) {
    const row = event.target instanceof Element && event.target.closest(rowSelector);
    if (!data || !row || row.contains(event.relatedTarget)) return;
    const id = row.getAttribute('data-app-action-sidebar-thread-id')?.match(idPattern)?.[1]?.toLowerCase();
    clearTimeout(threadTimer); clearTimeout(hideTimer);
    threadTimer = setTimeout(() => { threadId = id; threadUsage = id ? undefined : null; openDetail('thread', row); if (id) ask('thread:' + id); }, 400);
  }
  function out(event) {
    const row = event.target instanceof Element && event.target.closest(rowSelector);
    if (row && !row.contains(event.relatedTarget)) closeLater();
  }
  const observer = new MutationObserver(schedule); observer.observe(document, {childList:true,subtree:true});
  addEventListener('resize', schedule); addEventListener('scroll', schedule, true); addEventListener('pointerover', over); addEventListener('pointerout', out);
  const timer = setInterval(layout, 1000);
  window[key] = {
    update(payload) { data = payload; lease = Date.now() + 12000; mount(); if (stack) paintStack(); layout(); if (detail && detail !== 'thread') paintDetail(); },
    setThreadUsage(id, usage) { if (detail === 'thread' && threadId === id) { threadUsage = usage; paintDetail(); } },
    setTurnUsage(values) { for (const [id, value] of Object.entries(values)) turnValues.set(id, { ...value, at: Date.now() }); schedule(); },
    status() { const r = stack?.getBoundingClientRect(); return {visible: !!stack && !stack.hidden, mode: stack?.className, bounds:r ? {x:r.x,y:r.y,width:r.width,height:r.height}:null}; },
    remove() { closeDetail(); observer.disconnect(); clearInterval(timer); cancelAnimationFrame(frame); removeEventListener('resize',schedule); removeEventListener('scroll',schedule,true); removeEventListener('pointerover',over); removeEventListener('pointerout',out); host?.remove(); delete window[key]; }
  };
  layout();
})();
