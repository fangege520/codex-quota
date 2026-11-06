'use strict';
const bar = document.getElementById('bar');
function paint(state) {
  quotaDisplay.apply(document.body, state.settings.display, 'bar');
  document.documentElement.style.colorScheme = state.systemDark ? 'dark' : 'light';
  const stale = !!state.error || !!state.quota && Date.now() - state.quota.fetchedAt > Math.max(120000, state.settings.interval * 2500);
  document.body.classList.toggle('stale', stale);
  const showShort = state.settings.display?.short !== false, showWeekly = state.settings.display?.weekly !== false;
  bar.classList.toggle('single', showShort !== showWeekly);
  const language = state.settings.language;
  const details = ['Codex'];
  for (const id of ['short', 'weekly']) {
    const value = quotaDisplay.percent(state.quota?.[id]?.remaining);
    const label = document.getElementById(id);
    label.textContent = value == null ? '—' : `${value}%`;
    const item = label.closest('.item');
    item.hidden = state.settings.display?.[id] === false;
    item.style.setProperty('--remaining', (value ?? 0) + '%');
    quotaDisplay.progressColors(item, value);
    item.classList.toggle('depleted', value === 0);
    if (!item.hidden) details.push((id === 'short' ? '5h ' : '7d ') + label.textContent);
  }
  if (stale) details.push(language === 'en' ? 'Cached' : '缓存');
  bar.title = details.join(' · ');
  bar.setAttribute('aria-label', bar.title);
}
bar.addEventListener('click', () => window.quota.action('details'));
bar.addEventListener('mouseenter', () => window.quota.action('preview'));
bar.addEventListener('mouseleave', () => window.quota.action('leave'));
bar.addEventListener('contextmenu', event => { event.preventDefault(); window.quota.action('menu'); });
window.quota.subscribe(paint);window.quota.read().then(paint);
