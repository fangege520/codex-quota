'use strict';
const bar = document.getElementById('bar');
function paint(state) {
  document.body.classList.toggle('compact', !!state.systemBarCompact);
  document.body.classList.toggle('tiny', !!state.systemBarTiny);
  document.body.classList.toggle('dark', state.systemDark);
  const stale = !!state.error || !!state.quota && Date.now() - state.quota.fetchedAt > Math.max(120000, state.settings.interval * 2500);
  document.body.classList.toggle('stale', stale);
  document.getElementById('cached').hidden = !stale;
  for (const id of ['short', 'weekly']) {
    const value = state.quota?.[id]?.remaining;
    document.getElementById(id).textContent = Number.isFinite(value) ? `${Math.round(value)}%` : '—';
    document.getElementById(id + '-ring').style.setProperty('--remaining', Number.isFinite(value) ? value : 0);
  }
  bar.title = `Codex · 5h ${document.getElementById('short').textContent} · 7d ${document.getElementById('weekly').textContent}${stale ? ' · cached / 缓存' : ''}`;
  bar.setAttribute('aria-label', bar.title);
}
bar.addEventListener('click', () => window.quota.action('details'));
bar.addEventListener('mouseenter', () => window.quota.action('preview'));
bar.addEventListener('mouseleave', () => window.quota.action('leave'));
bar.addEventListener('contextmenu', event => { event.preventDefault(); window.quota.action('menu'); });
window.quota.subscribe(paint);window.quota.read().then(paint);
