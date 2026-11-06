/* Runtime UI for the opt-in CDP integration. No account or conversation reads. */
(function installCodexQuotaWidget() {
  'use strict';
  const key = '__codexQuotaComposerV1';
  if (window !== window.top) return false;
  const allowed = location.protocol === 'app:' && ['-', 'app'].includes(location.hostname) && !/avatar|composition|detached-window|pet-overlay/i.test(location.href) ||
    location.protocol === 'file:' && /(?:\/webview\/index\.html|\/codex-quota-fixture\.html)$/.test(location.pathname.replaceAll('\\', '/'));
  if (!allowed) return false;
  if (window[key]) return true;

  let payload = null, leaseUntil = 0, frame = 0, disposed = false, host = null, reason = 'waiting-data';
  let shadow, strip;
  const now = () => Date.now();
  function mount() {
    if (host?.isConnected || !document.body) return;
    host = document.createElement('div');
    host.id = 'codex-quota-composer-v1';
    host.setAttribute('data-codex-quota-widget', '');
    host.style.cssText = 'position:fixed;display:none;z-index:2147483000;pointer-events:auto;box-sizing:border-box;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host { color-scheme: light dark; font-family: system-ui, "Segoe UI", sans-serif; user-select: none; }
      [hidden] { display: none !important; }
      .strip {
        --surface: var(--display-card, light-dark(#f8faf9, #26282a));
        --line: light-dark(#d5ded8, #ffffff24);
        --muted: light-dark(#566763, #afb8b6);
        display: flex;
        align-items: center;
        gap: 9px;
        width: max-content;
        height: 100%;
        padding: 3px 11px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--surface);
        color: var(--display-ink, light-dark(#202a26, #f2f5f3));
        box-shadow: 0 1px 2px #0001;
        font-size: calc(12px * var(--font-scale));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        box-sizing: border-box;
        line-height: 1;
      }
      .window { display: flex; align-items: center; gap: 6px; }
      .name { color: var(--display-ink, var(--muted)); }
      .value { color: var(--display-ink, var(--display-accent)); font-weight: 750; }
      .ring {
        width: calc(17px * var(--ring-scale));
        aspect-ratio: 1;
        flex: none;
        box-sizing: border-box;
        border-radius: 50%;
        background: radial-gradient(closest-side, var(--surface) calc(100% - 2px), transparent calc(100% - 1.75px)),
          conic-gradient(var(--tone), var(--tone-end) var(--remaining), var(--track, var(--line)) 0);
      }
      .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--display-accent); flex: none; }
      .divider { height: 13px; border-left: 1px solid var(--line); }
      .metric { color: var(--display-ink, var(--muted)); font-size: .88em; }
      .metric b { color: var(--display-ink, light-dark(#202a26, #f2f5f3)); }
      .stale .dot { background: light-dark(#946400, #f1c75b); }
      .mini { gap: 5px; padding-inline: 6px; }
      .mini .window { gap: 3px; }
      .mini .ring { width: calc(13px * var(--ring-scale)); }
      .mini .dot { width: 4px; height: 4px; }
    </style><div class="strip" role="group">
      <span class="dot" aria-hidden="true"></span>
      <span class="window"><span class="ring short-ring" aria-hidden="true"></span><span class="name">5h</span><b class="value short">—</b></span>
      <span class="divider quota-divider" aria-hidden="true"></span>
      <span class="window"><span class="ring weekly-ring" aria-hidden="true"></span><span class="name">7d</span><b class="value weekly">—</b></span>
      <span class="divider credits-divider" aria-hidden="true"></span><span class="metric credits"><span class="credits-label"></span> <b>—</b></span>
      <span class="divider reset-divider" aria-hidden="true"></span><span class="metric resets"><span class="reset-label"></span> <b>—</b></span>
    </div>`;
    strip = shadow.querySelector('.strip');
    // Add a separate owned node; never move React nodes or write into the editor.
    document.body.append(host);
  }
  function visible(node) {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(node).visibility !== 'hidden';
  }
  function anchors() {
    return [...document.querySelectorAll('[data-codex-intelligence-trigger], [data-composer-navigation-target="reasoning"], [data-composer-navigation-target="model"]')]
      .filter(node => visible(node) && !node.closest('[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]') && node.closest('[data-composer-footer-responsive], [data-composer-layout], [data-composer-footer-layout], [data-codex-composer-root]'))
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  }
  function layout() {
    frame = 0;
    if (disposed) return;
    mount();
    if (!host) return;
    if (!payload || now() > leaseUntil) { host.style.display = 'none'; reason = payload ? 'companion-disconnected' : 'waiting-data'; return; }
    const anchor = anchors()[0];
    if (!anchor) { host.style.display = 'none'; reason = 'composer-not-found'; return; }
    const footer = anchor.closest('[data-composer-footer-responsive], [data-composer-layout], [data-composer-footer-layout], [data-codex-composer-root]');
    const rect = anchor.getBoundingClientRect();
    const parentRect = footer.getBoundingClientRect();
    let leftEdge = Math.max(8, parentRect.left + 5);
    for (const item of footer.querySelectorAll('button,[role="button"],[role="combobox"],[data-composer-navigation-target]')) {
      if (item === anchor || item.contains(anchor) || anchor.contains(item) || !visible(item)) continue;
      const r = item.getBoundingClientRect();
      if (r.right <= rect.left + 1 && r.bottom > rect.top && r.top < rect.bottom) leftEdge = Math.max(leftEdge, r.right + 8);
    }
    const available = rect.left - leftEdge - 8;
    if (['short', 'weekly', 'credits', 'resets'].every(key => payload.display?.[key] === false)) {
      host.style.display = 'none'; reason = 'content-hidden'; return;
    }
    host.style.colorScheme = quotaDisplay.colorScheme(anchor, payload.theme);
    host.style.height = '28px';
    host.style.display = 'block';
    strip.classList.remove('mini');
    let width = Math.ceil(strip.getBoundingClientRect().width);
    if (width > available) {
      strip.classList.add('mini');
      width = Math.ceil(strip.getBoundingClientRect().width);
    }
    if (width > available) { host.style.display = 'none'; reason = 'insufficient-space'; return; }
    const left = Math.floor(rect.left - width - 8);
    const top = Math.max(2, Math.round(rect.top + rect.height / 2 - 14));
    host.style.left = left + 'px'; host.style.top = top + 'px'; host.style.width = width + 'px';
    reason = 'visible';
  }
  function paint() {
    if (!strip) return;
    quotaDisplay.apply(host, payload.display, 'composer');
    const stale = !!payload.error || !Number.isFinite(payload.fetchedAt) || now() - payload.fetchedAt > 150000;
    strip.classList.toggle('stale', stale);
    const zh = payload.language !== 'en';
    const details = [zh ? 'Codex 剩余额度' : 'Codex remaining quota'];
    const showShort = payload.display?.short !== false, showWeekly = payload.display?.weekly !== false;
    const showQuota = showShort || showWeekly, showCredits = payload.display?.credits !== false, showResets = payload.display?.resets !== false;
    for (const [key, name] of [['short', '5h'], ['weekly', '7d']]) {
      const data = payload[key], text = shadow.querySelector('.' + key), ring = shadow.querySelector('.' + key + '-ring');
      const percent = quotaDisplay.percent(data?.remaining);
      const visible = payload.display?.[key] !== false;
      text.closest('.window').hidden = !visible;
      text.textContent = percent == null ? '—' : Math.round(percent) + '%';
      ring.style.setProperty('--remaining', (percent ?? 0) + '%');
      quotaDisplay.progressColors(ring, percent);
      ring.style.setProperty('--track', percent === 0 ? 'color-mix(in srgb, var(--tone) 45%, var(--line))' : 'var(--line)');
      const reset = Number.isFinite(data?.resetsAt) ? new Date(data.resetsAt).toLocaleString(zh ? 'zh-CN' : 'en-US') : '—';
      if (visible) details.push(`${name}: ${text.textContent} · ${zh ? '重置' : 'resets'} ${reset}`);
    }
    shadow.querySelector('.quota-divider').hidden = !showShort || !showWeekly;
    shadow.querySelector('.credits-divider').hidden = !showQuota || !showCredits;
    shadow.querySelector('.reset-divider').hidden = !(showQuota || showCredits) || !showResets;
    const credit = quotaDisplay.creditValue(payload.credits);
    const exactCredit = payload.credits?.unlimited ? '∞' : quotaDisplay.full(credit, payload.language);
    shadow.querySelector('.credits').hidden = !showCredits;
    shadow.querySelector('.credits-label').textContent = zh ? '点数' : 'Credits';
    shadow.querySelector('.credits b').textContent = payload.credits?.unlimited ? '∞' : quotaDisplay.compact(credit, payload.language, 0);
    if (showCredits) details.push((zh ? '点数 ' : 'Credits ') + exactCredit);
    shadow.querySelector('.resets').hidden = !showResets;
    shadow.querySelector('.reset-label').textContent = zh ? '重置卡' : 'Resets';
    shadow.querySelector('.resets b').textContent = quotaDisplay.compact(payload.resetCount, payload.language);
    if (showResets) details.push((zh ? '重置卡 ' : 'Saved resets ') + quotaDisplay.full(payload.resetCount, payload.language));
    if (stale) details.push(zh ? '刷新失败或数据已过期，显示上次数据' : 'Refresh failed or stale; showing cached data');
    if (payload.demo) details.push(zh ? '演示数据' : 'Demo data');
    const title = details.join('\n');
    host.title = title; strip.setAttribute('aria-label', title);
  }
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(layout); }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target !== host && !host?.contains(record.target))) schedule();
  });
  observer.observe(document, { childList: true, subtree: true });
  addEventListener('resize', schedule); addEventListener('scroll', schedule, true);
  const interval = setInterval(layout, 1000);
  window[key] = {
    update(data, enabled = true) { payload = data; leaseUntil = enabled ? now() + 12000 : 0; mount(); paint(); layout(); },
    status() {
      const bounds = host?.getBoundingClientRect();
      return { mounted: !!host?.isConnected, visible: reason === 'visible', reason,
        bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null };
    },
    remove() {
      disposed = true; clearInterval(interval); if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); removeEventListener('resize', schedule); removeEventListener('scroll', schedule, true);
      host?.remove(); delete window[key];
    }
  };
  layout();
  return true;
})();
