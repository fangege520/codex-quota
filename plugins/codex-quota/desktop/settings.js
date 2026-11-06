'use strict';
const $ = id => document.getElementById(id);
let period = 'today', activity, current, region = 'sidebar';
const displayKeys = ['sidebar', 'short', 'weekly', 'credits', 'resets'];
const zh = () => current?.language !== 'en';
const t = (cn,en) => zh() ? cn : en;
const full = n => quotaDisplay.full(n, current?.language);
const compact = n => quotaDisplay.compact(n, current?.language);
function node(tag, text, css) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (css) el.className = css; return el; }
function resetLabel(w) { return w?.resetsAt ? new Date(w.resetsAt).toLocaleString(zh() ? 'zh-CN' : 'en-GB', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : '—'; }
function paint(state) {
  const languageChanged = current?.language !== state.language;
  current = state;
  for (const [id, cn, en] of [['title','用量助手','Quota settings'],['account-title','当前额度','Current quota'],['official','官方用量详情 ↗','Official usage ↗'],['activity-title','Token 用量','Token activity'],['activity-source','本机 Codex 记录 · 按系统时区汇总','Local Codex records · system time zone'],['display-title','显示设置','Display'],['label-composer','编辑框额度','Composer strip'],['label-bar',state.mac?'菜单栏额度':'任务栏额度',state.mac?'Menu bar':'Taskbar'],['label-floating','桌面悬浮框','Floating panel'],['launch','启动 Codex（用量助手）','Launch Codex with Quota']]) $(id).textContent = t(cn,en);
  for (const [id, cn, en] of [
    ['label-sidebar', '左侧栏', 'Sidebar'], ['content-title', '各区域显示的内容', 'Content across regions'],
    ['label-short', '5 小时额度', '5-hour quota'], ['label-weekly', '7 天额度', '7-day quota'],
    ['label-credits', 'Codex 点数', 'Codex credits'], ['label-resets', '重置卡数量', 'Saved reset count'],
    ['accent-title', '主题色', 'Accent color'], ['region-title', '区域样式', 'Region style'],
    ['font-label', '字号', 'Text size'], ['ring-label', '圆环大小', 'Ring size'], ['color-label', '字色', 'Text color'],
    ['preview-label', '预览', 'Preview'], ['preview-credits-label', '点数', 'Credits'], ['preview-reset-label', '重置卡', 'Resets'],
    ['preferences-title', '通用设置', 'General settings'], ['label-language', '语言', 'Language'], ['label-interval', '刷新间隔', 'Refresh interval'],
    ['label-compact', '折叠悬浮框', 'Compact floating panel'], ['label-topmost', '悬浮框始终置顶', 'Keep floating panel on top'],
    ['label-opacity', '悬浮框透明度', 'Floating panel opacity'], ['label-launch-at-login', '登录时启动', 'Launch at login'],
    ['refresh', '立即刷新', 'Refresh now'], ['reset-position', '恢复默认位置', 'Reset position'], ['choose-executable', '选择 Codex 程序', 'Choose Codex executable']
  ]) $(id).textContent = t(cn, en);
  quotaDisplay.apply(document.body, state.display);
  $('plan').textContent = quotaDisplay.planLabel(state.quota?.plan) || '—';
  const q = state.quota;
  const credit = quotaDisplay.creditValue(q?.credits);
  const rows = [];
  for (const [key, label] of [['short', t('5 小时', '5 hours')], ['weekly', t('7 天', '7 days')]]) {
    const value = quotaDisplay.percent(q?.[key]?.remaining);
    if (state.display[key]) rows.push([label, value == null ? '—' : value + '%', resetLabel(q?.[key])]);
  }
  if (state.display.credits) rows.push([t('Codex 点数','Codex credits'),q?.credits?.unlimited ? '∞' : quotaDisplay.compact(credit, state.language, 0),t('余额','Balance'),q?.credits?.unlimited ? '∞' : full(credit)]);
  if (state.display.resets) rows.push([t('重置卡','Saved resets'),compact(q?.resets?.count),t('可用张数','Available'),full(q?.resets?.count)]);
  $('summary').hidden = !rows.length;
  $('summary').replaceChildren(...rows.map(([title,value,detail,exact])=>{const el=node('div',undefined,'metric'); const val=node('strong',value); val.title=exact ?? String(value); el.append(node('span',title),val,node('small',detail)); return el;}));
  for (const button of document.querySelectorAll('[data-setting]')) {
    const key = button.dataset.setting;
    button.setAttribute('aria-checked', String(!!(displayKeys.includes(key) ? state.display[key] : state[key])));
  }
  $('theme').value = state.theme;
  $('connection').textContent = state.connection;
  for (const [key,cn,en] of [['today','今日','Today'],['week','这周','Week'],['month','本月','Month']]) document.querySelector('[data-period='+key+']').textContent=t(cn,en);
  for (const [i,cn,en] of [[0,'跟随系统','System'],[1,'浅色','Light'],[2,'深色','Dark']]) $('theme').options[i].text=t(cn,en);
  const barReasons = {
    visible: t('任务栏额度已显示', 'Taskbar widget is visible'),
    'no-safe-taskbar-space': t('任务栏暂无足够空位，腾出空间后会自动显示', 'The taskbar widget appears when space is available'),
    fullscreen: t('退出全屏后将显示任务栏额度', 'Taskbar quota appears outside full screen'),
    'taskbar-hidden': t('系统任务栏隐藏时会同步隐藏额度', 'Quota follows taskbar visibility'),
    'taskbar-unavailable': t('暂时无法读取系统任务栏，正在重试', 'Taskbar unavailable. Retrying.'),
    'layout-unavailable': t('暂时无法读取任务栏布局，正在重试', 'Taskbar layout unavailable. Retrying.'),
    'content-hidden': t('5 小时和 7 天额度都已关闭', 'Both quota periods are hidden')
  };
  $('bar-status').textContent = state.bar && !state.mac ? barReasons[state.barReason] || t('正在查找任务栏空位', 'Checking taskbar space') : '';
  $('content-note').textContent = t(
    `点数在左侧栏和编辑框显示。${state.mac ? '菜单栏' : '任务栏'}只显示已开启的额度周期。`,
    `Credits appear in the sidebar and composer. The ${state.mac ? 'menu bar' : 'taskbar'} shows the enabled quota periods.`
  );
  for (const key of ['language', 'opacity', 'interval']) $(key).value = state[key];
  for (const option of $('interval').options) option.textContent = option.value + t(' 秒', ' seconds');
  document.querySelector('[data-setting="launchAtLogin"]').disabled = !state.canLaunchAtLogin;
  $('login-note').textContent = state.canLaunchAtLogin ? '' : t('登录时启动适用于正式安装版。', 'Launch at login is available in the packaged app.');
  $('refresh').disabled = !state.canRefresh;
  $('toggle-floating').textContent = state.floatingVisible ? t('隐藏悬浮框', 'Hide floating panel') : t('显示悬浮框', 'Show floating panel');
  $('executable-note').textContent = state.codexExecutable || (state.mac
    ? t('自动查找支持 Codex 的 ChatGPT 应用，也可以手动选择。', 'Quota finds the ChatGPT app that includes Codex, or you can choose it manually.')
    : t('Codex 程序由用量助手自动查找。', 'Quota finds the Codex executable automatically.'));
  $('shortcut-note').textContent = state.shortcutAvailable ? t('显示或隐藏悬浮框 · ', 'Toggle floating panel · ') + (state.mac ? '⌘' : 'Ctrl') + '+Shift+Q' : '';
  if (languageChanged) buildAppearance();
  paintAppearance();
  if (activity && languageChanged) paintChart();
}
function buildAppearance() {
  const labels = { sidebar: t('左侧栏', 'Sidebar'), composer: t('编辑框', 'Composer'), bar: current.mac ? t('菜单栏', 'Menu bar') : t('任务栏', 'Taskbar'), floating: t('悬浮框', 'Floating panel') };
  $('region').replaceChildren(...quotaDisplay.regions.map(key => new Option(labels[key], key)));
  $('region').value = region;
  $('region-color').replaceChildren(new Option(t('默认', 'Default'), 'auto'));
  $('swatches').replaceChildren();
  for (const [key, { main, zh: cn, en }] of Object.entries(quotaDisplay.colors)) {
    const label = t(cn, en);
    $('region-color').append(new Option(label, key));
    const button = node('button', '', 'swatch');
    button.type = 'button'; button.dataset.color = key;
    button.title = label; button.setAttribute('aria-label', label);
    button.style.setProperty('--swatch', main);
    button.onclick = () => changeDisplay('accent', key);
    $('swatches').append(button);
  }
}
function paintAppearance() {
  const display = current.display, style = display.regions[region];
  for (const button of $('swatches').children) button.setAttribute('aria-pressed', String(button.dataset.color === display.accent));
  for (const field of ['font', 'ring']) {
    $('region-' + field).value = style[field];
    $('region-' + field).setAttribute('aria-valuetext', Math.round(quotaDisplay.sizes[style[field]] * 100) + '%');
    $(field + '-value').textContent = Math.round(quotaDisplay.sizes[style[field]] * 100) + '%';
  }
  $('region-color').value = style.color;
  quotaDisplay.apply($('style-preview'), display, region);
  $('style-preview').dataset.region = region;
  $('ring-label').textContent = region === 'bar' ? t('进度条粗细', 'Bar thickness') : t('圆环大小', 'Ring size');
  for (const node of $('style-preview').querySelectorAll('[data-preview]')) {
    const key = node.dataset.preview;
    node.hidden = !display[key] || (key === 'resets' && region === 'bar') || (key === 'credits' && !['sidebar', 'composer'].includes(region));
  }
  const native = region === 'bar' && current.mac;
  for (const field of ['font', 'ring', 'color']) $('region-' + field).disabled = native;
  $('region-note').textContent = region !== 'bar' ? '' : native
    ? t('macOS 菜单栏的字号和字色由系统控制。', 'macOS controls the native menu bar styling.')
    : t('任务栏会根据可用空间自动调整卡片大小。', 'The taskbar card adjusts to the available space.');
}
function paintChart() {
  const rows = activity?.[period]; if (!rows?.length) return;
  const total = rows.reduce((sum,row)=>sum+row.tokens,0);
  $('total').textContent = activity.sessions ? compact(total)+' Token' : '—';
  $('total').title = activity.sessions ? full(total) + ' Token' : '';
  $('hover-value').textContent = activity.sessions ? (period==='today'?t('按小时','Hourly'):t('按天','Daily')) : t('暂无本机用量记录','No local usage records');
  const max = Math.max(1,...rows.map(row=>row.tokens));
  const axis = node('div',undefined,'axis'); axis.append(node('span',compact(max)),node('span',compact(Math.round(max/2))),node('span','0'));
  const plot = node('div',undefined,'plot'); plot.style.setProperty('--columns',rows.length);
  rows.forEach((row,i)=>{
    const label = row.label+' · '+compact(row.tokens)+' Token';
    const exact = row.label+' · '+full(row.tokens)+' Token';
    const button = node('button',undefined,'column'+(row.tokens===0?' zero':'')); button.type='button'; button.title=exact; button.setAttribute('aria-label',exact);
    button.style.setProperty('--fraction',row.tokens/max); button.append(node('span',undefined,'fill'),node('small',period==='week'||i%(period==='today'?6:5)===0?row.label:''));
    for(const event of ['mouseenter','focus','click'])button.addEventListener(event,()=>{$('hover-value').textContent=label;});
    plot.append(button);
  });
  $('chart').replaceChildren(axis,plot);
}
const send = (k,v) => window.quotaSettings.change(k,v);
const changeDisplay = (key, value) => send('display:' + key, value);
for (const button of document.querySelectorAll('[data-setting]')) button.onclick = () => {
  const key = button.dataset.setting, value = button.getAttribute('aria-checked') !== 'true';
  if (displayKeys.includes(key)) changeDisplay(key, value);
  else send(key, value);
};
$('region').onchange = () => { region = $('region').value; paintAppearance(); };
for (const field of ['font', 'ring', 'color']) $('region-' + field).oninput = event => {
  const value = field === 'color' ? event.target.value : Number(event.target.value);
  current.display.regions[region][field] = value;
  paintAppearance();
  changeDisplay('region', [region, field, value]);
};
for (const button of document.querySelectorAll('[data-period]')) button.onclick = () => { period=button.dataset.period; for(const tab of document.querySelectorAll('[data-period]'))tab.setAttribute('aria-pressed',String(tab===button)); paintChart(); };
$('theme').onchange=()=>send('theme',$('theme').value);
for (const key of ['language', 'opacity', 'interval']) $(key).onchange = () => send(key, key === 'language' ? $(key).value : Number($(key).value));
for(const key of ['close','official','launch','refresh','toggle-floating','reset-position','choose-executable']) $(key).onclick=()=>send(key);
addEventListener('keydown',event=>{if(event.key==='Escape')send('close');});
async function refreshChart(){ try{activity=await window.quotaSettings.usage();paintChart();}catch{$('hover-value').textContent=t('读取记录失败','Could not read local records');} }
window.quotaSettings.subscribe(paint);window.quotaSettings.read().then(paint);refreshChart();setInterval(refreshChart,30000);
