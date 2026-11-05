'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, dialog, powerMonitor, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexClient, discoverCodex } = require('../lib/codex.cjs');
const { normalizeQuota, clampBounds } = require('../lib/quota.cjs');
const { ComposerBridge, DEFAULT_PORT, validPort } = require('../lib/composer.cjs');
const { discoverDesktopApp, launchDesktop } = require('../lib/desktop-app.cjs');
const { findFreeBounds, popoverBounds, TaskbarWatcher } = require('../lib/system-bar.cjs');
const { UsageIndex } = require('../lib/usage.cjs');
const OFFICIAL_USAGE = 'https://chatgpt.com/settings/usage';
const usage = new UsageIndex();
const threadEstimates = new Map();
const PANEL_WIDTH = 380, PANEL_HEIGHT = 324;
if (process.platform === 'win32') app.commandLine.appendSwitch('force-renderer-accessibility');

const smoke = process.argv.includes('--smoke-test');
if (smoke && !process.env.CODEX_QUOTA_TEST_DIR) throw new Error('Smoke test needs an isolated output directory');
app.setName('Codex Quota');
app.setPath('userData', smoke ? path.join(process.env.CODEX_QUOTA_TEST_DIR, 'profile') : path.join(app.getPath('appData'), 'codex-quota'));
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let saved = {};
try { saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
const settings = {
  collapsed: saved.collapsed === true,
  topmost: saved.topmost !== false,
  opacity: [0.65, 0.8, 1].includes(saved.opacity) ? saved.opacity : 1,
  interval: [30, 60, 120].includes(saved.interval) ? saved.interval : 60,
  language: ['zh', 'en'].includes(saved.language) ? saved.language : null,
  position: saved.position,
  codexPath: typeof saved.codexPath === 'string' ? saved.codexPath : '',
  composerEnabled: saved.composerEnabled === true,
  composerPort: validPort(saved.composerPort) ? saved.composerPort : DEFAULT_PORT,
  desktopAppPath: typeof saved.desktopAppPath === 'string' && fs.existsSync(saved.desktopAppPath) ? saved.desktopAppPath : '',
  systemBarEnabled: saved.systemBarEnabled !== false,
  floatingEnabled: saved.floatingEnabled === true,
  theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'system'
};
nativeTheme.themeSource = settings.theme;
if (process.argv.includes('--system-bar-on')) settings.systemBarEnabled = true;
if (process.argv.includes('--system-bar-off')) settings.systemBarEnabled = false;
if (process.argv.includes('--composer-on')) settings.composerEnabled = true;
if (process.argv.includes('--composer-off')) settings.composerEnabled = false;
let win, tray, client, timer, saveTimer, quitting = false, refreshing = false, failures = 0;
let bridge, cleanupComplete = false, cleanupInFlight = false;
let taskbarWatcher, popover = false, hoverOnly = false, popupCloseTimer;
let settingsWindow, launchingDesktop = false;
const barWindows = new Map();
const state = { quota: null, error: null, loading: true, settings, demo: smoke };
const choose = (zh, en) => settings.language === 'zh' ? zh : en;

function persist() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = settingsFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
  fs.renameSync(temp, settingsFile);
}
function snapshot() { const result = JSON.parse(JSON.stringify(state)); if (popover) result.settings.collapsed = false; return result; }
function barSnapshot(item) { return { ...snapshot(), systemBarCompact: !!item.compact, systemBarTiny: !!item.tiny }; }
function settingsSnapshot() {
  return { language: settings.language, quota: state.quota, composer: settings.composerEnabled, bar: settings.systemBarEnabled, floating: settings.floatingEnabled, theme: settings.theme, sidebarVisible: state.composer?.sidebarVisible || 0, mac: process.platform === 'darwin' };
}
function publish() {
  state.systemDark = settings.theme === 'dark' || settings.theme === 'system' && (nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors);
  bridge?.update(state);
  if (win && !win.isDestroyed()) win.webContents.send('quota:changed', snapshot());
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('quota:settings-changed', settingsSnapshot());
  for (const item of barWindows.values()) if (!item.win.isDestroyed()) item.win.webContents.send('quota:changed', barSnapshot(item));
  if (!smoke) {
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(settingsFile), 'runtime-status.json'), JSON.stringify({ pid: process.pid, windowVisible: !!win?.isVisible(), settingsVisible: !!settingsWindow?.isVisible(), systemBar: { enabled: settings.systemBarEnabled, visible: process.platform === 'darwin' ? !!tray && settings.systemBarEnabled : [...barWindows.values()].filter(item => item.win.isVisible()).length, reason: state.systemBarReason || null }, composer: state.composer || { phase: 'disabled' }, updatedAt: Date.now() }));
    } catch {}
  }
  updateTray();
}
function startBridge() {
  if (smoke || bridge) return;
  bridge = new ComposerBridge({ port: settings.composerPort, threadUsage: readThreadUsage });
  bridge.on('status', status => { state.composer = status; publish(); });
  bridge.on('settings', () => openSettings().catch(() => {}));
  bridge.on('official', openOfficialUsage);
  bridge.update(state); bridge.start();
}
async function readThreadUsage(id) {
  await usage.refresh();
  const local = usage.get(id);
  if (local) return local;
  const cached = threadEstimates.get(id);
  if (cached && Date.now() - cached.at < 60000) return cached.value;
  let value = null;
  try { if (client) value = await client.readThreadUsage(id); } catch {}
  if (threadEstimates.size >= 200) threadEstimates.delete(threadEstimates.keys().next().value);
  threadEstimates.set(id, { at: Date.now(), value }); return value;
}
function setComposer(enabled) { settings.composerEnabled = enabled; persist(); publish(); }
function openOfficialUsage() { shell.openExternal(OFFICIAL_USAGE).catch(() => {}); }
function composerStatusText() {
  const status = state.composer;
  if (status?.sidebarVisible) return choose('左栏用量已连接', 'Sidebar quota connected');
  if (status?.visible) return choose(`已在 ${status.visible} 个窗口显示额度条`, `Quota strip visible in ${status.visible} window(s)`);
  if (status?.phase === 'connected') return choose('已连接，等待输入框或足够的显示空间', 'Connected; waiting for a composer with enough space');
  return choose(`等待本机调试连接（端口 ${settings.composerPort}）`, `Waiting for local debugging connection (port ${settings.composerPort})`);
}
async function launchCodex() {
  if (launchingDesktop) return;
  launchingDesktop = true;
  try {
    startBridge();
    if (await bridge?.focus()) return;
    // Re-resolve Store installs after every app update. A saved path is only
    // used for a still-existing custom install.
    const custom = settings.desktopAppPath && !/[\\/]WindowsApps[\\/]/i.test(settings.desktopAppPath) && fs.existsSync(settings.desktopAppPath) ? settings.desktopAppPath : undefined;
    await launchDesktop({ executable: process.env.CODEX_QUOTA_APP_PATH || custom, port: settings.composerPort });
  } catch (error) {
    const restart = error.message === 'CODEX_RESTART_REQUIRED';
    await dialog.showMessageBox(settingsWindow || win, { type: 'info', title: 'Codex Quota', message: restart ? choose('当前 Codex 由普通图标启动', 'Codex was opened normally') : choose('未能启动 Codex', 'Could not launch Codex'),
      detail: restart ? choose('请在任务完成后完全退出 Codex，再打开「Codex（用量助手）」快捷方式。之后使用该入口，左栏会自动连接。', 'Quit Codex after your tasks finish, then use the Codex with Quota shortcut. This shortcut connects the sidebar automatically.') : choose('请确认 Codex 已安装；可以设置 CODEX_QUOTA_APP_PATH 后重新启动额度助手。', 'Check that Codex is installed. You can set CODEX_QUOTA_APP_PATH and restart the helper.') });
  } finally { launchingDesktop = false; }
}
function position() {
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter(d => d.id !== primary.id)].map(d => d.workArea);
  return clampBounds(settings.position, displays, settings.collapsed ? 336 : PANEL_WIDTH, settings.collapsed ? 78 : PANEL_HEIGHT);
}
function fitWindow() {
  const [x, y] = win.getPosition();
  settings.position = { x, y };
  win.setBounds(position());
}
function collapse() {
  popover = false; hoverOnly = false;
  settings.collapsed = !settings.collapsed;
  fitWindow(); persist(); publish();
}
function show() { popover = false; hoverOnly = false; clearTimeout(popupCloseTimer); win.setBounds(position()); win.setAlwaysOnTop(settings.topmost, 'floating'); win.setOpacity(settings.opacity); publish(); win.show(); publish(); if (process.platform === 'darwin') app.dock?.hide(); }
function hide() { clearTimeout(popupCloseTimer); popover = false; hoverOnly = false; win.hide(); publish(); }
function setFloating(enabled) { settings.floatingEnabled = enabled; persist(); if (enabled) show(); else hide(); }
function toggle() { win.isVisible() ? hide() : show(); }
function quit() { quitting = true; app.quit(); }
function openPopover(anchor, preview = false) {
  if (preview && win.isVisible() && !popover) return;
  clearTimeout(popupCloseTimer); popover = true; hoverOnly = preview;
  const area = screen.getDisplayMatching(anchor).workArea;
  win.setBounds(popoverBounds(anchor, area, PANEL_WIDTH, PANEL_HEIGHT));
  win.setAlwaysOnTop(true, 'pop-up-menu'); win.setOpacity(1); publish();
  if (preview) win.showInactive(); else { win.show(); win.focus(); }
  publish();
}
function togglePopover(anchor) { if (win.isVisible() && popover && !hoverOnly) hide(); else openPopover(anchor); }
async function openSettings() {
  if (quitting) return;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(740, area.width - 16), height = Math.min(580, area.height - 16);
  const bounds = { width, height, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2) };
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    const window = new BrowserWindow({ ...bounds, show: false, frame: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, resizable: false, webPreferences: { preload: path.join(__dirname, 'settings-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    settingsWindow = window; secureContents(window);
    window.on('closed', () => { if (settingsWindow === window) settingsWindow = null; if (!quitting) publish(); });
    await window.loadFile(path.join(__dirname, 'settings.html'));
  }
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.setBounds(bounds); settingsWindow.showInactive(); settingsWindow.focus(); publish();
  return settingsWindow;
}
function closePreviewLater() {
  clearTimeout(popupCloseTimer);
  popupCloseTimer = setTimeout(() => {
    if (!popover || !hoverOnly) return;
    const p = screen.getCursorScreenPoint();
    const contains = r => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
    if (contains(win.getBounds()) || [...barWindows.values()].some(item => item.win.isVisible() && contains(item.win.getBounds()))) closePreviewLater();
    else hide();
  }, 550);
}
function secureContents(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
}
async function updateTaskbars(data) {
  if (!settings.systemBarEnabled || quitting) return;
  const active = new Set();
  for (const bar of data.bars) {
    active.add(bar.handle);
    let item = barWindows.get(bar.handle);
    const rect = screen.screenToDipRect(null, bar.bounds);
    const occupied = bar.occupied.map(r => screen.screenToDipRect(null, r));
    const area = screen.getDisplayMatching(rect).bounds;
    const fg = screen.screenToDipRect(null, data.foreground);
    const fullscreen = fg.width >= area.width && fg.height >= area.height && fg.x <= area.x && fg.y <= area.y;
    const onScreen = rect.x >= area.x - 2 && rect.y >= area.y - 2 && rect.x + rect.width <= area.x + area.width + 2 && rect.y + rect.height <= area.y + area.height + 2;
    const bounds = bar.visible && bar.accurate && onScreen && !fullscreen && (findFreeBounds(rect, occupied, 178, 36, item?.preferred) || findFreeBounds(rect, occupied, 80, 36, item?.preferred) || findFreeBounds(rect, occupied, 48, 36, item?.preferred));
    if (!bounds) { item?.win.hide(); continue; }
    if (!item) {
      const window = new BrowserWindow({ ...bounds, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      secureContents(window); window.setAlwaysOnTop(true, 'pop-up-menu');
      item = { win: window, compact: bounds.width < 178, tiny: bounds.width < 80 }; barWindows.set(bar.handle, item);
      window.on('closed', () => { if (barWindows.get(bar.handle) === item) barWindows.delete(bar.handle); });
      await window.loadFile(path.join(__dirname, 'bar.html'));
    }
    if (!settings.systemBarEnabled || quitting || item.win.isDestroyed()) continue;
    item.win.setBounds(bounds);
    const actual = item.win.getBounds();
    const overlaps = occupied.some(r => actual.x < r.x + r.width && actual.x + actual.width > r.x && actual.y < r.y + r.height && actual.y + actual.height > r.y);
    if (actual.y < rect.y || actual.y + actual.height > rect.y + rect.height || overlaps) { item.win.hide(); continue; }
    item.compact = bounds.width < 178;
    item.tiny = bounds.width < 80;
    item.protected = occupied; item.lane = rect;
    item.win.webContents.send('quota:changed', barSnapshot(item)); item.win.showInactive();
  }
  for (const [key, item] of barWindows) if (!active.has(key)) { item.win.destroy(); barWindows.delete(key); }
  state.systemBarReason = [...barWindows.values()].some(item => item.win.isVisible()) ? 'visible' : 'no-safe-taskbar-space';
  publish();
}
function setSystemBar(enabled) {
  settings.systemBarEnabled = enabled; persist();
  if (smoke) { publish(); return; }
  if (process.platform === 'win32') {
    if (!enabled) { taskbarWatcher?.stop(); taskbarWatcher = null; for (const item of [...barWindows.values()]) item.win.destroy(); barWindows.clear(); }
    else if (!taskbarWatcher) {
      taskbarWatcher = new TaskbarWatcher();
      taskbarWatcher.on('layout', data => updateTaskbars(data).catch(() => { state.systemBarReason = 'layout-unavailable'; }));
      taskbarWatcher.on('unavailable', () => { for (const item of barWindows.values()) item.win.hide(); state.systemBarReason = 'taskbar-unavailable'; publish(); });
      taskbarWatcher.start();
    }
  }
  publish();
}
// Local diagnostics capture only this companion's owned UI, never other apps.
async function savePreviews() {
  const dir = path.join(app.getPath('userData'), 'previews');
  fs.mkdirSync(dir, { recursive: true });
  const items = [...barWindows.values()];
  const metadata = { checkedAt: Date.now(), panelVisible: win.isVisible(), bars: items.map(item => ({ bounds: item.win.getBounds(), visible: item.win.isVisible(), lane: item.lane, protected: item.protected })) };
  // Write geometry first. A hidden compositor surface may not deliver a frame;
  // diagnostics must neither expose nor resize a hidden user window.
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
  let index = 0;
  for (const item of items) {
    if (item.win.isVisible()) fs.writeFileSync(path.join(dir, `taskbar-${index++}.png`), (await item.win.webContents.capturePage()).toPNG());
  }
  if (win.isVisible()) fs.writeFileSync(path.join(dir, 'panel.png'), (await win.webContents.capturePage()).toPNG());
}

async function refresh() {
  if (refreshing || quitting || smoke) return;
  clearTimeout(timer); refreshing = true; state.loading = true; publish();
  try {
    if (!client) client = new CodexClient(discoverCodex(settings.codexPath));
    state.quota = normalizeQuota(await client.readQuota());
    state.error = null; failures = 0;
  } catch (error) {
    const known = ['CODEX_NOT_FOUND', 'CODEX_PATH_INVALID', 'CHATGPT_LOGIN_REQUIRED', 'QUOTA_UNAVAILABLE', 'CODEX_TIMEOUT'];
    state.error = known.includes(error.message) ? error.message : 'CONNECTION_FAILED';
    failures++;
    client?.close(); client = null;
  } finally {
    refreshing = false; state.loading = false; publish();
    if (!quitting) timer = setTimeout(refresh, Math.min(300, settings.interval * Math.max(1, failures)) * 1000);
  }
}

function menuItems() {
  return [
    { label: choose('用量助手设置…', 'Quota settings…'), click: () => openSettings().catch(() => {}) },
    { label: choose('显示 / 隐藏', 'Show / hide'), click: toggle },
    { label: choose('立即刷新', 'Refresh now'), enabled: !refreshing && !smoke, click: refresh },
    { label: choose('折叠成小条', 'Compact mode'), type: 'checkbox', checked: settings.collapsed, click: collapse },
    { label: process.platform === 'darwin' ? choose('菜单栏显示额度', 'Show quota in menu bar') : choose('任务栏显示额度', 'Show quota in taskbar'), type: 'checkbox', checked: settings.systemBarEnabled, click: item => setSystemBar(item.checked) },
    { label: choose('外观', 'Appearance'), submenu: [['system', '跟随系统', 'System'], ['light', '浅色', 'Light'], ['dark', '深色', 'Dark']].map(([value, zh, en]) => ({ label: choose(zh, en), type: 'radio', checked: settings.theme === value, click: () => { settings.theme = value; nativeTheme.themeSource = value; persist(); publish(); } })) },
    { label: choose('输入框额度条（实验）', 'Composer quota strip (experimental)'), type: 'checkbox', checked: settings.composerEnabled, click: item => setComposer(item.checked) },
    { label: composerStatusText(), click: () => dialog.showMessageBox(win, { type: 'info', title: 'Codex Quota', message: composerStatusText(), detail: choose('通过本机 CDP 添加独立额度条；不会读取或修改输入内容。没有足够空间时自动隐藏。关闭实验模式即可移除。', 'Adds a separate strip through local CDP. It does not read or modify editor content. Hidden automatically when space is insufficient; disable this mode to remove it.') }) },
    { label: choose('启动 Codex（用量助手）', 'Launch Codex with Quota'), enabled: !smoke, click: launchCodex },
    { label: choose('始终置顶', 'Always on top'), type: 'checkbox', checked: settings.topmost, click: item => {
      settings.topmost = item.checked; win.setAlwaysOnTop(item.checked, 'floating'); persist(); publish();
    } },
    { type: 'separator' },
    { label: choose('透明度', 'Opacity'), submenu: [1, 0.8, 0.65].map(value => ({
      label: `${Math.round(value * 100)}%`, type: 'radio', checked: settings.opacity === value,
      click: () => { settings.opacity = value; win.setOpacity(value); persist(); publish(); }
    })) },
    { label: choose('刷新间隔', 'Refresh interval'), submenu: [30, 60, 120].map(value => ({
      label: choose(`${value} 秒`, `${value} seconds`), type: 'radio', checked: settings.interval === value,
      click: () => { settings.interval = value; persist(); publish(); refresh(); }
    })) },
    { label: '语言 / Language', submenu: [{ label: '中文', id: 'zh' }, { label: 'English', id: 'en' }].map(item => ({
      label: item.label, type: 'radio', checked: settings.language === item.id,
      click: () => { settings.language = item.id; persist(); publish(); }
    })) },
    { label: choose('登录时启动', 'Launch at login'), type: 'checkbox', enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--background'] }) },
    { label: choose('选择 Codex 程序…', 'Choose Codex executable…'), click: async () => {
      const result = await dialog.showOpenDialog(win, {
        title: choose('选择 codex 可执行文件', 'Select the codex executable'), properties: ['openFile'],
        ...(process.platform === 'win32' ? { filters: [{ name: 'Codex', extensions: ['exe'] }] } : {})
      });
      if (result.canceled || !result.filePaths[0]) return;
      settings.codexPath = result.filePaths[0]; client?.close(); client = null; persist(); refresh();
    } },
    { label: choose('恢复默认位置', 'Reset position'), click: () => { settings.position = null; win.setBounds(position()); persist(); } },
    { type: 'separator' },
    { label: choose('快捷键：Ctrl/⌘ + Shift + Q', 'Shortcut: Ctrl/⌘ + Shift + Q'), enabled: false },
    { label: choose('退出额度悬浮窗', 'Quit Codex Quota'), click: quit }
  ];
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const q = state.quota;
  const label = `5h ${q?.short ? Math.round(q.short.remaining) + '%' : '—'} · 7d ${q?.weekly ? Math.round(q.weekly.remaining) + '%' : '—'}`;
  tray.setToolTip(`Codex Quota · ${label}${state.error ? choose(' · 更新失败', ' · update failed') : ''}`);
  if (process.platform === 'darwin') tray.setTitle(settings.systemBarEnabled ? `5h ${q?.short ? Math.round(q.short.remaining) + '%' : '—'}  7d ${q?.weekly ? Math.round(q.weekly.remaining) + '%' : '—'}${state.error ? ' •' : ''}` : '', { fontType: 'monospacedDigit' });
}

async function smokeTest() {
  const out = process.env.CODEX_QUOTA_TEST_DIR;
  const checks = [];
  const evaluate = code => win.webContents.executeJavaScript(code);
  const settle = () => new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(win.isAlwaysOnTop(), true); checks.push('always-on-top');
  await settle();
  assert.equal(await evaluate("document.querySelector('#short-percent').textContent"), '64%');
  assert.equal(await evaluate("document.querySelector('#weekly-percent').textContent"), '28%');
  checks.push('renderer receives normalized quota through isolated preload');
  fs.writeFileSync(path.join(out, 'expanded.png'), (await win.webContents.capturePage()).toPNG());
  nativeTheme.themeSource = 'light'; await settle();
  fs.writeFileSync(path.join(out, 'light.png'), (await win.webContents.capturePage()).toPNG());
  const lightInk = await evaluate("getComputedStyle(document.body).color");
  nativeTheme.themeSource = 'dark'; await settle();
  assert.notEqual(await evaluate("getComputedStyle(document.body).color"), lightInk);
  fs.writeFileSync(path.join(out, 'dark.png'), (await win.webContents.capturePage()).toPNG());
  checks.push('native light and dark appearance both render');
  nativeTheme.themeSource = settings.theme;
  await evaluate("document.querySelector('#collapse').click()"); await settle();
  assert.equal(settings.collapsed, true); assert.equal(win.getBounds().height, 78);
  checks.push('collapse control changes native window size');
  fs.writeFileSync(path.join(out, 'compact.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('#compact-expand').click()"); await settle();
  assert.equal(settings.collapsed, false); assert.equal(win.getBounds().height, PANEL_HEIGHT);
  checks.push('expand control restores window');
  win.showInactive(); await evaluate("document.querySelector('#hide').click()"); await settle();
  assert.equal(win.isVisible(), false); show(); assert.equal(win.isVisible(), true);
  checks.push('hide to tray and restore');
  assert.ok(Menu.buildFromTemplate(menuItems()).items.some(item => item.label === '任务栏显示额度' || item.label === '菜单栏显示额度'));
  checks.push('native tray menu constructs');
  if (process.platform === 'darwin') { assert.match(tray.getTitle(), /5h 64%.*7d 28%/); checks.push('macOS menu bar title contains both remaining quotas'); }
  settings.language = 'en'; publish(); await settle();
  assert.equal(await evaluate("document.querySelector('#short-title').textContent"), '5 hours');
  checks.push('English language');
  const fixtureBar = new BrowserWindow({ width: 178, height: 32, show: false, frame: false, transparent: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  barWindows.set('fixture', { win: fixtureBar });
  await fixtureBar.loadFile(path.join(__dirname, 'bar.html')); publish(); await settle();
  assert.equal(await fixtureBar.webContents.executeJavaScript("document.querySelector('#short').textContent"), '64%');
  assert.equal(await fixtureBar.webContents.executeJavaScript("document.querySelector('#weekly').textContent"), '28%');
  fs.writeFileSync(path.join(out, 'taskbar.png'), (await fixtureBar.webContents.capturePage()).toPNG());
  fixtureBar.setSize(80, 36); barWindows.get('fixture').compact = true; publish(); await settle();
  assert.equal(await fixtureBar.webContents.executeJavaScript("document.body.classList.contains('compact')"), true);
  fs.writeFileSync(path.join(out, 'taskbar-compact.png'), (await fixtureBar.webContents.capturePage()).toPNG());
  checks.push('narrow taskbar renders stacked quotas without covering system widgets');
  fixtureBar.setSize(48, 36); barWindows.get('fixture').tiny = true; state.quota.short.remaining = 100; publish(); await settle();
  assert.equal(await fixtureBar.webContents.executeJavaScript("document.querySelector('#short').textContent"), '100%');
  assert.equal(await fixtureBar.webContents.executeJavaScript("document.querySelector('#bar').scrollWidth <= document.querySelector('#bar').clientWidth"), true);
  fs.writeFileSync(path.join(out, 'taskbar-tiny.png'), (await fixtureBar.webContents.capturePage()).toPNG());
  state.quota.short.remaining = 64; publish(); await settle();
  checks.push('smallest taskbar style fits full and zero quota without horizontal overflow');
  await fixtureBar.webContents.executeJavaScript("document.querySelector('#bar').click()"); await settle();
  assert.equal(popover, true); assert.equal(win.getBounds().height, PANEL_HEIGHT);
  checks.push('taskbar quota rings and click-to-open details');
  await fixtureBar.webContents.executeJavaScript("document.querySelector('#bar').click()"); await settle();
  assert.equal(popover, false);
  checks.push('clicking the taskbar quota again closes details');
  hide(); fixtureBar.destroy(); barWindows.delete('fixture');
  settings.language = 'zh'; publish();
  const config = await openSettings(); await settle();
  assert.equal(config.isVisible(), true, JSON.stringify({bounds:config.getBounds(), minimized:config.isMinimized()})); assert.equal(win.isVisible(), false);
  const readConfig = code => config.webContents.executeJavaScript(code);
  assert.equal(await readConfig("document.querySelectorAll('#chart .column').length"), 24);
  await readConfig("document.querySelector('[data-period=week]').click()");
  assert.equal(await readConfig("document.querySelectorAll('#chart .column').length"), 7);
  await readConfig("document.querySelector('[data-period=month]').click()");
  assert.equal(await readConfig("document.querySelectorAll('#chart .column').length"), 31);
  await readConfig("document.querySelector('[data-setting=composer]').click()"); await settle();
  assert.equal(settings.composerEnabled, true);
  await readConfig("document.querySelector('[data-period=today]').click()"); await settle();
  fs.writeFileSync(path.join(out, 'settings.png'), (await config.webContents.capturePage()).toPNG());
  config.close();
  settings.language = 'en'; publish();
  checks.push('centered settings works independently of overlays, with period charts and saved switches');
  state.error = 'CONNECTION_FAILED'; publish(); await settle();
  assert.match(await evaluate("document.querySelector('#status-text').textContent"), /failed/i);
  checks.push('failed refresh explicitly marks cached data');
  state.quota = null; publish(); await settle();
  assert.equal(await evaluate("document.querySelector('#short-percent').textContent"), '—');
  checks.push('missing data never shown as 100%');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, checks }, null, 2));
  quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (!win) return;
    if (argv.includes('--quit')) quit();
    else if (argv.includes('--composer-on')) setComposer(true);
    else if (argv.includes('--composer-off')) setComposer(false);
    else if (argv.includes('--launch-codex')) launchCodex();
    else if (argv.includes('--settings')) openSettings().catch(() => {});
    else if (argv.includes('--system-bar-on')) setSystemBar(true);
    else if (argv.includes('--system-bar-off')) setSystemBar(false);
    else if (argv.includes('--save-previews')) savePreviews().catch(() => {});
    else if (argv.includes('--hide')) hide();
    else if (argv.includes('--toggle')) toggle();
    else show();
  });
  app.whenReady().then(async () => {
    if (process.argv.includes('--quit') || process.argv.includes('--hide')) { quit(); return; }
    if (!settings.language) settings.language = app.getLocale().startsWith('zh') ? 'zh' : 'en';
    if (process.env.CODEX_QUOTA_APP_PATH) settings.desktopAppPath = process.env.CODEX_QUOTA_APP_PATH;
    if (smoke) {
      settings.language = 'zh'; settings.collapsed = false; settings.topmost = true;
      settings.composerEnabled = false; settings.systemBarEnabled = true; settings.floatingEnabled = false;
      state.quota = normalizeQuota({ rateLimits: { planType: 'plus', credits:{balance:'120.5'}, primary: { usedPercent: 36, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 12000 }, secondary: { usedPercent: 72, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 172800 } }, rateLimitResetCredits:{availableCount:2,credits:[]} });
      state.loading = false;
    }
    win = new BrowserWindow({
      ...position(), frame: false, transparent: true, resizable: false,
      alwaysOnTop: settings.topmost, skipTaskbar: true, show: false,
      hasShadow: false, fullscreenable: false, maximizable: false,
      ...(process.platform === 'darwin' ? { vibrancy: 'popover', visualEffectState: 'active' } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.setOpacity(settings.opacity);
    if (settings.topmost) win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); app.dock?.hide(); }
    secureContents(win);
    win.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
    win.on('blur', () => {
      if (popover && !hoverOnly && ![...barWindows.values()].some(item => item.win === BrowserWindow.getFocusedWindow())) hide();
    });
    win.on('moved', () => {
      if (popover) return;
      const [x, y] = win.getPosition(); settings.position = { x, y };
      clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300);
    });
    screen.on('display-removed', () => { win.setBounds(position()); persist(); });
    screen.on('display-metrics-changed', () => { win.setBounds(position()); });
    ipcMain.handle('quota:state', event => { const item = [...barWindows.values()].find(item => item.win.webContents === event.sender); return item ? barSnapshot(item) : snapshot(); });
    ipcMain.handle('quota:settings-state', event => event.sender === settingsWindow?.webContents ? settingsSnapshot() : null);
    ipcMain.handle('quota:settings-usage', async event => {
      if (event.sender !== settingsWindow?.webContents) return null;
      if (smoke) return { sessions: 5, ...Object.fromEntries([['today',24],['week',7],['month',31]].map(([key,n]) => [key, Array.from({length:n},(_,i)=>({label:key==='today'?String(i).padStart(2,'0')+':00':String(i+1),tokens: i % 5 === 0 ? 0 : ((i*73+9)%105)*12000}))])) };
      await usage.refresh(); return usage.chart();
    });
    ipcMain.on('quota:settings-action', (event, key, value) => {
      if (event.sender !== settingsWindow?.webContents) return;
      if (key === 'close') settingsWindow.close();
      else if (key === 'official') openOfficialUsage();
      else if (key === 'launch' && !smoke) launchCodex();
      else if (key === 'theme' && ['system','light','dark'].includes(value)) { settings.theme = value; nativeTheme.themeSource = value; persist(); publish(); }
      else if (typeof value === 'boolean') {
        if (key === 'composer') setComposer(value);
        else if (key === 'bar') setSystemBar(value);
        else if (key === 'floating') setFloating(value);
      }
    });
    ipcMain.on('quota:action', (event, action) => {
      const barItem = [...barWindows.values()].find(item => item.win.webContents === event.sender);
      if (barItem) {
        if (action === 'details') togglePopover(barItem.win.getBounds());
        else if (action === 'preview') openPopover(barItem.win.getBounds(), true);
        else if (action === 'leave') closePreviewLater();
        else if (action === 'menu') Menu.buildFromTemplate(menuItems()).popup();
        return;
      }
      if (event.sender !== win.webContents) return;
      if (action === 'refresh') refresh();
      else if (action === 'collapse') collapse();
      else if (action === 'hide') hide();
      else if (action === 'menu') openSettings().catch(() => {});
    });
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png')).resize({ width: process.platform === 'darwin' ? 18 : 24, height: process.platform === 'darwin' ? 18 : 24 });
    if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
    tray = new Tray(trayIcon);
    tray.on('click', (_event, bounds) => togglePopover(bounds || tray.getBounds()));
    tray.on('right-click', () => Menu.buildFromTemplate(menuItems()).popup());
    updateTray();
    const shortcut = globalShortcut.register('CommandOrControl+Shift+Q', toggle);
    state.shortcutAvailable = shortcut;
    powerMonitor.on('resume', () => refresh());
    nativeTheme.on('updated', publish);
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (smoke) await smokeTest();
    else {
      if (process.argv.includes('--show') || settings.floatingEnabled) show();
      setSystemBar(settings.systemBarEnabled);
      refresh();
      startBridge();
      if (process.argv.includes('--settings')) await openSettings();
      if (process.argv.includes('--launch-codex')) await launchCodex();
    }
  }).catch(error => {
    if (smoke) { fs.writeFileSync(path.join(process.env.CODEX_QUOTA_TEST_DIR, 'failure.txt'), error.stack); process.exitCode = 1; }
    else dialog.showErrorBox('Codex Quota', choose('启动失败，请重新安装悬浮窗。', 'Could not start. Please reinstall the overlay.'));
    quitting = true; app.exit(1);
  });
  app.on('before-quit', event => {
    quitting = true; clearTimeout(timer); clearTimeout(saveTimer); clearTimeout(popupCloseTimer); taskbarWatcher?.stop(); client?.close(); globalShortcut.unregisterAll();
    if (bridge && !cleanupComplete) {
      event.preventDefault();
      if (!cleanupInFlight) { cleanupInFlight = true; bridge.stop().finally(() => { cleanupComplete = true; app.quit(); }); }
    }
  });
  app.on('will-quit', () => { if (!smoke) { try { fs.rmSync(path.join(path.dirname(settingsFile), 'runtime-status.json'), { force: true }); } catch {} } });
  app.on('window-all-closed', () => {});
  app.on('activate', () => { if (win) show(); });
}
