'use strict';
let current;
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
function paint(state) {
  current = state;
  const zh = state.settings.language === 'zh';
  const t = (cn, en) => zh ? cn : en;
  const now = Date.now();
  quotaDisplay.apply(document.body, state.settings.display, 'floating');
  const showShort = state.settings.display?.short !== false, showWeekly = state.settings.display?.weekly !== false;
  const showResets = state.settings.display?.resets !== false;
  $('window-hint').hidden = !showShort && !showWeekly;
  $('compact-divider').hidden = !showShort || !showWeekly;
  const resetCount = state.quota?.resets?.count;
  for (const id of ['saved-resets', 'compact-resets']) {
    $(id).hidden = !showResets;
    text(id, t('重置卡 ', 'Resets ') + quotaDisplay.compact(resetCount, state.settings.language));
    $(id).title = t('重置卡 ', 'Saved resets ') + quotaDisplay.full(resetCount, state.settings.language);
  }
  const stale = !!state.error || !!state.quota && now - state.quota.fetchedAt > Math.max(120000, state.settings.interval * 2500);
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  document.body.classList.toggle('collapsed', state.settings.collapsed);
  document.body.classList.toggle('warning', stale);
  text('remaining-title', t('剩余额度', 'REMAINING QUOTA'));
  text('window-hint', t('用量窗口', 'USAGE WINDOWS'));
  text('live-tag', stale ? t('缓存', 'CACHED') : state.demo ? 'DEMO' : 'LIVE');
  text('short-title', t('5 小时', '5 hours'));
  text('weekly-title', t('7 天', '7 days'));
  text('plan', state.demo ? t('演示', 'DEMO') : quotaDisplay.planLabel(state.quota?.plan) || 'CODEX');
  for (const [id, value] of [['short', state.quota?.short], ['weekly', state.quota?.weekly]]) {
    const visible = state.settings.display?.[id] !== false;
    $(`${id}-ring`).closest('.quota-row').hidden = !visible;
    $(`compact-${id}`).closest('.compact-quota').hidden = !visible;
    const remaining = quotaDisplay.percent(value?.remaining);
    const percent = remaining == null ? '—' : `${remaining}%`;
    text(`${id}-percent`, percent); text(`compact-${id}`, percent);
    $(`${id}-ring`).style.setProperty('--remaining', remaining ?? 0);
    $(`${id}-ring`).classList.toggle('depleted', remaining === 0);
    quotaDisplay.progressColors($(`${id}-ring`).closest('.quota-row'), remaining);
    const bar = $(`${id}-bar`);
    bar.value = value?.remaining || 0;
    let reset = t('暂无数据', 'Unavailable');
    if (value?.resetsAt) {
      const diff = value.resetsAt - now;
      if (diff <= 0) reset = t('已到重置时间，等待服务器更新', 'Reset time reached; awaiting server update');
      else {
        const date = new Date(value.resetsAt);
        if (id === 'short') {
          const minutes = Math.ceil(diff / 60000);
          reset = t(`约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后重置`, `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`);
        } else reset = t(`${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 重置`, `Resets ${date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
      }
    }
    text(`${id}-reset`, reset);
  }
  const errors = {
    CODEX_NOT_FOUND: t('未找到 Codex，可在设置中选择程序', 'Codex not found; choose it in settings'),
    CODEX_PATH_INVALID: t('Codex 路径失效，请重新选择', 'Codex path invalid; choose it again'),
    CHATGPT_LOGIN_REQUIRED: t('请先用 ChatGPT 账户登录 Codex CLI', 'Sign into Codex CLI with ChatGPT first'),
    QUOTA_UNAVAILABLE: t('账户未返回可用额度', 'Account quota unavailable'),
    CODEX_TIMEOUT: t('刷新超时，将自动重试', 'Refresh timed out; retrying'),
    CONNECTION_FAILED: t('刷新失败，将自动重试', 'Refresh failed; retrying')
  };
  let status = state.loading ? t('正在刷新…', 'Refreshing…') : t('等待首次同步', 'Waiting for first sync');
  if (!state.loading && state.quota) {
    const age = Math.max(0, Math.floor((now - state.quota.fetchedAt) / 1000));
    status = age < 10 ? t('刚刚同步', 'Just synced') : t(`${age} 秒前同步`, `Synced ${age}s ago`);
  }
  if (state.demo) status = t('演示数据 · 预览', 'Demo data · preview');
  if (state.error) status = (errors[state.error] || errors.CONNECTION_FAILED) + (state.quota ? t(' · 显示上次数据', ' · cached data') : '');
  else if (stale) status = t('数据已过期，等待同步', 'Stale data; waiting for sync');
  text('status-text', status);
  $('status-text').title = status;
  $('compact-status').title = status;
  $('refresh').disabled = state.loading;
  $('hide').title = t('隐藏到托盘 · Ctrl/⌘+Shift+Q 恢复', 'Hide to tray · Ctrl/⌘+Shift+Q to restore');
}
for (const [id, action] of [['menu', 'menu'], ['collapse', 'collapse'], ['compact-expand', 'collapse'], ['hide', 'hide'], ['compact-hide', 'hide'], ['refresh', 'refresh']]) $(id).addEventListener('click', () => window.quota.action(action));
window.quota.subscribe(paint);
window.quota.read().then(paint);
setInterval(() => { if (current) paint(current); }, 1000);
