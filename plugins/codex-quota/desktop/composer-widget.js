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
  let shadow, shortText, weeklyText, shortBar, weeklyBar, dot;
  const now = () => Date.now();
  function mount() {
    if (host?.isConnected || !document.body) return;
    host = document.createElement('div');
    host.id = 'codex-quota-composer-v1';
    host.setAttribute('data-codex-quota-widget', '');
    host.style.cssText = 'position:fixed;display:none;z-index:2147483000;pointer-events:auto;box-sizing:border-box;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none}
      .strip{height:28px;display:flex;align-items:center;gap:9px;padding:3px 9px;border:1px solid light-dark(#dfe5e0,#ffffff20);border-radius:8px;background:light-dark(#f4f7f4,#252c27);color:light-dark(#35413a,#e0eae2);font-size:11px;white-space:nowrap;box-sizing:border-box;line-height:1.1}
      .window{display:grid;grid-template-columns:17px 32px;gap:2px 4px;align-items:baseline;min-width:53px}
      .name{opacity:.62;font-size:10px}.value{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}.track{height:2px;border-radius:2px;background:light-dark(#dce3dd,#ffffff15);grid-column:1/-1;overflow:hidden}.fill{height:100%;width:0;background:#56a66e;border-radius:2px}
      .dot{height:4px;width:4px;border-radius:50%;background:#62ab78;flex-shrink:0}.divider{height:12px;width:1px;background:light-dark(#dbe2dc,#ffffff20)}
      .stale .dot{background:#d5a464}.stale{opacity:.68}.mini .track{display:none}.mini{gap:5px;padding-inline:5px}.mini .window{grid-template-columns:auto auto;min-width:0;gap:3px}.mini .dot{display:none}
    </style><div class="strip" role="group"><span class="dot"></span><div class="window"><span class="name">5h</span><span class="value short">—</span><div class="track"><div class="fill short-fill"></div></div></div><span class="divider"></span><div class="window"><span class="name">7d</span><span class="value weekly">—</span><div class="track"><div class="fill weekly-fill"></div></div></div></div>`;
    shortText = shadow.querySelector('.short'); weeklyText = shadow.querySelector('.weekly');
    shortBar = shadow.querySelector('.short-fill'); weeklyBar = shadow.querySelector('.weekly-fill'); dot = shadow.querySelector('.dot');
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
    if (available < 104) { host.style.display = 'none'; reason = 'insufficient-space'; return; }
    const mini = available < 156;
    const width = mini ? 104 : 156;
    const strip = shadow.querySelector('.strip');
    strip.classList.toggle('mini', mini);
    const stale = !!payload.error || !Number.isFinite(payload.fetchedAt) || now() - payload.fetchedAt > 150000;
    strip.classList.toggle('stale', stale);
    const zh = payload.language !== 'en';
    const details = [zh ? 'Codex 剩余额度' : 'Codex remaining quota'];
    for (const [data, text, bar, name] of [[payload.short, shortText, shortBar, '5h'], [payload.weekly, weeklyText, weeklyBar, '7d']]) {
      const percent = data && Number.isFinite(data.remaining) ? Math.max(0, Math.min(100, data.remaining)) : null;
      text.textContent = percent == null ? '—' : Math.round(percent) + '%';
      bar.style.width = (percent ?? 0) + '%';
      bar.style.background = percent == null ? '#8b968e' : percent <= 10 ? '#d87777' : percent <= 30 ? '#c39452' : '#56a66e';
      const reset = Number.isFinite(data?.resetsAt) ? new Date(data.resetsAt).toLocaleString(zh ? 'zh-CN' : 'en-US') : '—';
      details.push(`${name}: ${text.textContent} · ${zh ? '重置' : 'resets'} ${reset}`);
    }
    if (stale) details.push(zh ? '刷新失败或数据已过期，显示上次数据' : 'Refresh failed or stale; showing cached data');
    if (payload.demo) details.push(zh ? '演示数据' : 'Demo data');
    const title = details.join('\n');
    host.title = title; strip.setAttribute('aria-label', title);
    const left = Math.round(rect.left - width - 8);
    const top = Math.max(2, Math.round(rect.top + rect.height / 2 - 14));
    host.style.left = left + 'px'; host.style.top = top + 'px'; host.style.width = width + 'px'; host.style.height = '28px';
    host.style.display = 'block'; reason = 'visible';
  }
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(layout); }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target !== host && !host?.contains(record.target))) schedule();
  });
  observer.observe(document, { childList: true, subtree: true });
  addEventListener('resize', schedule); addEventListener('scroll', schedule, true);
  const interval = setInterval(layout, 1000);
  window[key] = {
    update(data, enabled = true) { payload = data; leaseUntil = enabled ? now() + 12000 : 0; layout(); },
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
