/* Owned overlays for quota and thread usage; only reads native geometry/IDs. */
(function installQuotaRail() {
  'use strict';
  const key = '__codexQuotaRailV1';
  const allowed = location.protocol === 'app:' && ['-', 'app'].includes(location.hostname) && !/avatar|composition|detached-window|pet-overlay/i.test(location.href) ||
    location.protocol === 'file:' && /\/(?:webview\/index\.html|codex-quota-fixture\.html)$/.test(location.pathname.replaceAll('\\', '/'));
  if (window !== window.top || !allowed || window[key]) return;
  const rowSelector = '[data-app-action-sidebar-thread-id]';
  const idPattern = /^(?:(?:local|thread)[:/|])?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
  let host, root, stack, panel, data, lease, frame, hideTimer, threadTimer, anchor, detail, threadId, threadUsage;
  const ask = action => { if (typeof window.__codexQuotaActionV2 === 'function') window.__codexQuotaActionV2(action); };
  const zh = () => data?.language !== 'en';
  const t = (cn, en) => zh() ? cn : en;
  const number = value => Number.isFinite(value) ? value.toLocaleString(zh() ? 'zh-CN' : 'en-US') : '—';
  const pct = window => window ? Math.round(window.remaining) + '%' : '—';
  const date = value => Number.isFinite(value) ? new Date(value).toLocaleString(zh() ? 'zh-CN' : 'en-US', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
  const shortDate = (value, weekly) => Number.isFinite(value) ? new Date(value).toLocaleString(zh() ? 'zh-CN' : 'en-GB', weekly ? {month:'2-digit',day:'2-digit'} : {hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
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
    style.textContent = [
      ':host{color-scheme:light dark;font:12px system-ui,sans-serif;--ink:light-dark(#203a34,#e3f2eb);--muted:light-dark(#59716a,#a1b6ab);--base:light-dark(#f3f8f5,#202d28);--card:light-dark(#fff,#263830);--line:light-dark(#dce8e1,#ffffff20);--tone:light-dark(#149776,#62d5ad);--week:light-dark(#587ad2,#a0b4ff)}',
      '*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--tone);outline-offset:1px}',
      '.stack,.panel{position:fixed;pointer-events:auto;color:var(--ink);border:1px solid var(--line);background:var(--base);border-radius:11px}.stack{display:grid;grid-template-rows:31px 31px 23px 21px;gap:3px;padding:3px;width:46px}.stack[hidden],.panel[hidden]{display:none}',
      '.limit,.mini,.gear{border:0;border-radius:6px;background:var(--card);min-width:0;padding:2px;line-height:1.1}.limit:hover,.mini:hover,.gear:hover{outline:1px solid var(--tone)}.limit{display:grid;grid-template-rows:11px 2px 9px;gap:2px;font-size:9px}.metrics{display:flex;justify-content:space-between;gap:1px}.metrics b{font-size:9px;font-variant-numeric:tabular-nums}.track{height:2px;border-radius:3px;background:var(--line);overflow:hidden}.track i{display:block;height:100%;background:var(--tone)}.weekly .track i{background:var(--week)}.reset{font-size:8px;color:var(--muted)}',
      '.pair{display:grid;grid-template-columns:1fr 1fr;gap:2px;min-width:0}.mini{display:grid;place-content:center;gap:1px;font-size:8px;color:var(--muted);white-space:nowrap}.mini b{font-size:8px;color:var(--ink);max-width:20px;overflow:hidden;text-overflow:ellipsis}.plan{display:grid;place-items:center;color:var(--tone);font-size:8px;font-weight:700;overflow:hidden}.gear{font-size:13px;color:var(--muted)}',
      '.stack.compact{grid-template-rows:24px 24px 20px 17px;gap:2px}.compact .limit{grid-template-rows:10px 2px 8px;gap:1px}.stack.gear-only{grid-template-rows:21px;padding:3px;display:block}.gear-only>.limit,.gear-only>.pair:not(.end),.gear-only .plan{display:none}.gear-only .end{display:block}.gear-only .gear{width:100%;height:21px}',
      '.panel{width:258px;max-height:min(410px,80vh);overflow:auto;padding:14px;box-shadow:0 12px 36px #0003;line-height:1.5}.panel h3{margin:0 0 8px;font-size:14px}.panel p{margin:6px 0;color:var(--muted);font-size:11px}.panel .big{font-size:25px;font-weight:720;color:var(--tone)}.panel .track{height:5px}.panel .item{padding:7px 0;border-bottom:1px solid var(--line)}.panel .official{width:100%;margin-top:10px;border:1px solid var(--line);border-radius:7px;background:var(--card);padding:6px}.panel .official:hover{border-color:var(--tone)}',
      '.stale{opacity:.68}',
      '.stack{grid-template-rows:31px 37px 23px 21px;overflow:hidden}.limit.weekly{grid-template-rows:11px 2px 14px}.weekly .reset{display:grid;font-size:7px;line-height:7px}.stack.compact{grid-template-rows:26px 32px 20px 17px}.compact .limit.weekly{grid-template-rows:10px 2px 14px}.stack.gear-only{display:block}.stack[hidden]{display:none}.panel{max-width:calc(100vw - 16px)}'
    ].join('\n');
    stack = element('div', 'stack'); stack.hidden = true; stack.setAttribute('aria-label', 'Codex Quota');
    for (const name of ['short', 'weekly']) {
      const button = element('button', 'limit ' + name); button.type = 'button';
      const metrics = element('span', 'metrics'); metrics.append(element('span', '', name === 'short' ? '5h' : '7d'), element('b', '', '—'));
      const track = element('span', 'track'); track.append(element('i'));
      button.append(metrics, track, element('span', 'reset', '—')); stack.append(button); bindDetail(button, name);
    }
    const extra = element('div', 'pair');
    for (const name of ['credits','resets']) {
      const button = element('button', 'mini ' + name); button.type = 'button';
      button.append(element('span'), element('b', '', '—')); extra.append(button); bindDetail(button, name);
      button.addEventListener('click', openUsage);
    }
    const end = element('div', 'pair end'); const gear = element('button', 'gear', '⚙︎'); gear.type = 'button';
    gear.addEventListener('click', () => { closeDetail(); ask('settings'); });
    end.append(element('span', 'plan', '—'), gear);
    panel = element('div', 'panel'); panel.hidden = true;
    panel.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    panel.addEventListener('pointerleave', closeLater);
    stack.append(extra, end); root.append(style, stack, panel); document.body.append(host);
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
      const value = data[detail]; panel.append(element('div', 'big', pct(value)));
      const track = element('div', 'track'); const fill = element('i'); fill.style.width = (value?.remaining ?? 0) + '%'; track.append(fill);
      panel.append(track, element('p', '', t('重置时间：','Resets: ') + date(value?.resetsAt)));
    } else if (detail === 'credits') {
      panel.append(element('div', 'big', data.credits?.unlimited ? t('不限','Unlimited') : data.credits?.balance ?? '—'), element('p', '', t('独立点数余额，点击额度图标查看官方详情。','Separate credit balance. Click the quota icon for official details.')));
    } else if (detail === 'resets') {
      panel.append(element('p', '', data.resets ? t('剩余 ', 'Available: ') + data.resets.count + t(' 张','') : t('重置卡数据暂不可用','Reset data unavailable')));
      data.resets?.cards.forEach((card, i) => panel.append(element('div', 'item', t('重置卡 ', 'Reset ') + (i + 1) + ' · ' + t('到期 ', 'Expires ') + date(card.expiresAt))));
      const button = element('button', 'official', t('前往官方页面使用','Open official usage page')); button.type = 'button';
      button.addEventListener('click', () => { closeDetail(); ask('official'); }); panel.append(button);
    } else {
      if (!threadUsage) panel.append(element('p', '', threadUsage === undefined ? t('读取本机记录…','Reading local history…') : t('没有此会话的本机统计','No local stats for this chat')));
      else {
        panel.append(element('div', 'big', number(threadUsage.total)));
        for (const [k, label] of [['input',t('输入','Input')],['cached',t('其中缓存','Cached input')],['output',t('输出','Output')],['reasoning',t('其中推理','Reasoning output')]]) panel.append(element('div', 'item', label + ' · ' + number(threadUsage[k])));
        if (threadUsage.estimated) panel.append(element('p', '', t('服务端估算','Account estimate')));
      }
    }
    if (detail !== 'thread' && data.error) panel.append(element('p', '', t('显示上次同步的数据','Showing last synced data')));
    panel.hidden = false;
    const rect = anchor.getBoundingClientRect();
    panel.style.left = Math.max(6, Math.min(rect.right + 9, innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.top = Math.max(6, Math.min(rect.top, innerHeight - panel.offsetHeight - 8)) + 'px';
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
    if (!data || Date.now() > lease) { stack.hidden = true; closeDetail(); return; }
    const nav = [...document.querySelectorAll('[data-app-navigation-rail]')].find(node => {
      const r = node.getBoundingClientRect(); return r.width >= 32 && r.width <= 100 && r.height >= 100 && r.left < 100 && r.right > 0 && !node.closest('[aria-hidden="true"],[inert]') && getComputedStyle(node).visibility !== 'hidden';
    });
    if (!nav) { stack.hidden = true; if (detail !== 'thread') closeDetail(); return; }
    const lane = nav.getBoundingClientRect();
    const controls = [...nav.querySelectorAll('button,a,[role="button"],[role="menuitem"]'), ...document.querySelectorAll('[data-orbit-profile-trigger]')];
    const obstacles = controls.map(node => node.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0 && r.left < lane.right && r.right > lane.left);
    let mode, y;
    const sizes = lane.width >= 42 ? [['full',131],['compact',111],['gear-only',30]] : [['gear-only',30]];
    for (const [name,height] of sizes) { y = findSlot(lane, obstacles, height); if (y !== null) { mode = name; break; } }
    if (y === null) { stack.hidden = true; if (detail !== 'thread') closeDetail(); return; }
    stack.className = 'stack ' + mode + (data.error ? ' stale' : '');
    stack.style.width = Math.min(46, lane.width - 4) + 'px';
    stack.style.left = Math.max(1, lane.left + (lane.width - Math.min(46, lane.width - 4)) / 2) + 'px';
    stack.style.top = y + 'px'; stack.hidden = false;
    for (const name of ['short','weekly']) {
      const button = stack.querySelector('.' + name); const value = data[name];
      button.querySelector('b').textContent = pct(value);
      button.querySelector('i').style.width = (value?.remaining ?? 0) + '%';
      const reset = button.querySelector('.reset');
      if (name === 'weekly' && Number.isFinite(value?.resetsAt)) reset.replaceChildren(element('span','',shortDate(value.resetsAt,true)),element('span','',shortDate(value.resetsAt,false)));
      else reset.textContent = shortDate(value?.resetsAt, false);
      button.setAttribute('aria-label', (name === 'short' ? '5h ' : '7d ') + pct(value) + ' · ' + date(value?.resetsAt));
    }
    const credits = stack.querySelector('.credits'), resets = stack.querySelector('.resets');
    credits.querySelector('span').textContent = t('点数','Pts');
    const balance = Number(data.credits?.balance);
    credits.querySelector('b').textContent = data.credits?.unlimited ? '∞' : data.credits?.balance != null ? new Intl.NumberFormat('en', {notation:'compact',maximumFractionDigits:Math.abs(balance) >= 1000 || Math.abs(balance) < 10 ? 1 : 0}).format(balance) : '—';
    resets.querySelector('span').textContent = t('重置','Reset'); resets.querySelector('b').textContent = data.resets?.count ?? '—';
    credits.setAttribute('aria-label', t('Codex 点数详情','Codex credits')); resets.setAttribute('aria-label', t('重置卡详情','Saved resets'));
    const plan = stack.querySelector('.plan'); plan.textContent = data.plan ? data.plan.replace(/^./, c => c.toUpperCase()) : '—'; plan.title = data.plan || '';
    const gear = stack.querySelector('.gear'); gear.title = t('用量助手设置','Quota settings'); gear.setAttribute('aria-label', gear.title);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
  function over(event) {
    const row = event.target instanceof Element && event.target.closest(rowSelector);
    if (!data || !row || row.contains(event.relatedTarget)) return;
    const id = row.getAttribute('data-app-action-sidebar-thread-id')?.match(idPattern)?.[1]?.toLowerCase();
    clearTimeout(threadTimer); clearTimeout(hideTimer);
    threadTimer = setTimeout(() => { threadId = id; threadUsage = id ? undefined : null; openDetail('thread', row); if (id) ask('thread:' + id); }, 320);
  }
  function out(event) {
    const row = event.target instanceof Element && event.target.closest(rowSelector);
    if (row && !row.contains(event.relatedTarget)) closeLater();
  }
  const observer = new MutationObserver(schedule); observer.observe(document, {childList:true,subtree:true});
  addEventListener('resize', schedule); addEventListener('pointerover', over); addEventListener('pointerout', out);
  const timer = setInterval(layout, 1000);
  window[key] = {
    update(payload) { data = payload; lease = Date.now() + 12000; layout(); if (detail && detail !== 'thread') paintDetail(); },
    setThreadUsage(id, usage) { if (detail === 'thread' && threadId === id) { threadUsage = usage; paintDetail(); } },
    status() { const r = stack?.getBoundingClientRect(); return {visible: !!stack && !stack.hidden, mode: stack?.className, bounds:r ? {x:r.x,y:r.y,width:r.width,height:r.height}:null}; },
    remove() { closeDetail(); observer.disconnect(); clearInterval(timer); cancelAnimationFrame(frame); removeEventListener('resize',schedule); removeEventListener('pointerover',over); removeEventListener('pointerout',out); host?.remove(); delete window[key]; }
  };
  layout();
})();
