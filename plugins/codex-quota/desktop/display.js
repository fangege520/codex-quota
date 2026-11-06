'use strict';

const quotaDisplay = (() => {
  const regions = ['sidebar', 'composer', 'bar', 'floating'];
  const sizes = [0.8, 0.9, 1, 1.15, 1.3];
  const colors = {
    green: { main: '#00C896', end: '#36E7C0', surface: '#ECFFF8', ink: '#007A5A', zh: '翡翠薄荷', en: 'Jade mint' },
    blue: { main: '#3478FF', end: '#22C7F2', surface: '#EEF6FF', ink: '#2454C6', zh: '电光海蓝', en: 'Electric blue' },
    violet: { main: '#8854FF', end: '#C477FF', surface: '#F5F0FF', ink: '#6932C2', zh: '鲜亮鸢紫', en: 'Bright violet' },
    rose: { main: '#F535AA', end: '#FF79C9', surface: '#FFF0F8', ink: '#BC1679', zh: '电气玫粉', en: 'Electric rose' },
    amber: { main: '#FF8A1F', end: '#FFC247', surface: '#FFF6E9', ink: '#A95000', zh: '日光蜜橙', en: 'Sunlit orange' },
    lime: { main: '#91D500', end: '#C5EF42', surface: '#F6FFE8', ink: '#497500', zh: '青柠绿光', en: 'Lime glow' }
  };
  const step = value => Number.isInteger(value) && value >= 0 && value < sizes.length ? value : 2;
  const hasColor = value => typeof value === 'string' && Object.hasOwn(colors, value);
  const colorKey = (value, fallback) => value === 'teal' ? 'green' : hasColor(value) ? value : fallback;
  function normalize(value) {
    return {
      sidebar: value?.sidebar !== false,
      short: typeof value?.short === 'boolean' ? value.short : value?.quota !== false,
      weekly: typeof value?.weekly === 'boolean' ? value.weekly : value?.quota !== false,
      credits: value?.credits !== false,
      resets: value?.resets !== false,
      accent: colorKey(value?.accent, 'green'),
      regions: Object.fromEntries(regions.map(region => {
        const style = value?.regions?.[region];
        return [region, { font: step(style?.font), ring: step(style?.ring), color: colorKey(style?.color, 'auto') }];
      }))
    };
  }
  function textColor(color) {
    if (!hasColor(color)) return '';
    const { ink, end } = colors[color];
    return `light-dark(${ink}, color-mix(in srgb, ${end} 78%, white))`;
  }
  function apply(target, display, region) {
    const style = display?.regions?.[region];
    const key = colorKey(display?.accent, 'green');
    const { main, end, surface } = colors[key];
    target.style.setProperty('--display-main', main);
    target.style.setProperty('--display-end', end);
    target.style.setProperty('--display-card', `light-dark(${surface}, color-mix(in srgb, ${main} 10%, #24262a))`);
    target.style.setProperty('--display-accent', textColor(key));
    target.style.setProperty('--display-ink', textColor(style?.color));
    target.style.setProperty('--font-scale', sizes[step(style?.font)]);
    target.style.setProperty('--ring-scale', sizes[step(style?.ring)]);
  }
  function full(value, language) {
    return Number.isFinite(value) ? value.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') : '—';
  }
  function compact(value, language, precision = 1) {
    if (!Number.isFinite(value)) return '—';
    const units = language === 'en' ? [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
      : [[1e12, '万亿'], [1e8, '亿'], [1e4, '万'], [1e3, '千']];
    const unit = units.find(([divisor]) => {
      const scaled = Math.abs(value) / divisor;
      return scaled >= 1 && (precision > 0 || scaled >= 10 || Number.isInteger(scaled));
    });
    return unit ? '≈' + Number((value / unit[0]).toFixed(precision)) + unit[1] : full(value, language);
  }
  function creditValue(credits) {
    const balance = credits?.balance;
    if (typeof balance !== 'string' && typeof balance !== 'number' || balance === '') return null;
    const value = Math.trunc(Number(balance));
    return Number.isFinite(value) ? value : null;
  }
  const percent = value => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : null;
  const tone = value => value == null ? 'light-dark(#67717b, #a8adb4)' : value <= 20 ? 'light-dark(#c23242, #f47c85)'
    : value <= 50 ? 'light-dark(#946400, #f1c75b)' : 'var(--display-main)';
  function progressColors(target, value) {
    target.style.setProperty('--tone', tone(value));
    target.style.setProperty('--tone-end', value > 50 ? 'var(--display-end)' : tone(value));
  }
  function colorScheme(node, preference) {
    if (preference === 'light' || preference === 'dark') return preference;
    const marker = node?.closest('[data-theme="light"],[data-theme="dark"],.light,.dark');
    if (marker) return marker.dataset.theme === 'light' || marker.dataset.theme === 'dark' ? marker.dataset.theme : marker.classList.contains('dark') ? 'dark' : 'light';
    const schemes = node ? getComputedStyle(node).colorScheme.split(' ') : [];
    if (schemes.includes('dark') !== schemes.includes('light')) return schemes.includes('dark') ? 'dark' : 'light';
    return 'light dark';
  }
  return { regions, sizes, colors, normalize, apply, full, compact, creditValue, percent, progressColors, colorScheme };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = quotaDisplay;
