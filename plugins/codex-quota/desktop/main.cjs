'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, dialog, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexClient, discoverCodex } = require('../lib/codex.cjs');
const { normalizeQuota, clampBounds } = require('../lib/quota.cjs');

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
  codexPath: typeof saved.codexPath === 'string' ? saved.codexPath : ''
};
let win, tray, client, timer, saveTimer, quitting = false, refreshing = false, failures = 0;
const state = { quota: null, error: null, loading: true, settings, demo: smoke };
const choose = (zh, en) => settings.language === 'zh' ? zh : en;

function persist() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = settingsFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
  fs.renameSync(temp, settingsFile);
}
function snapshot() { return JSON.parse(JSON.stringify(state)); }
function publish() {
  if (win && !win.isDestroyed()) win.webContents.send('quota:changed', snapshot());
  updateTray();
}
function position() {
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter(d => d.id !== primary.id)].map(d => d.workArea);
  return clampBounds(settings.position, displays, 336, settings.collapsed ? 78 : 254);
}
function fitWindow() {
  const [x, y] = win.getPosition();
  settings.position = { x, y };
  win.setBounds(position());
}
function collapse() {
  settings.collapsed = !settings.collapsed;
  fitWindow(); persist(); publish();
}
function show() { win.show(); if (process.platform === 'darwin') app.dock?.hide(); }
function toggle() { win.isVisible() ? win.hide() : show(); }
function quit() { quitting = true; app.quit(); }

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
    { label: choose('显示 / 隐藏', 'Show / hide'), click: toggle },
    { label: choose('立即刷新', 'Refresh now'), enabled: !refreshing && !smoke, click: refresh },
    { label: choose('折叠成小条', 'Compact mode'), type: 'checkbox', checked: settings.collapsed, click: collapse },
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
  if (!tray) return;
  const q = state.quota;
  const label = `5h ${q?.short ? Math.round(q.short.remaining) + '%' : '—'} · 7d ${q?.weekly ? Math.round(q.weekly.remaining) + '%' : '—'}`;
  tray.setToolTip(`Codex Quota · ${label}${state.error ? choose(' · 更新失败', ' · update failed') : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate(menuItems()));
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
  await evaluate("document.querySelector('#collapse').click()"); await settle();
  assert.equal(settings.collapsed, true); assert.equal(win.getBounds().height, 78);
  checks.push('collapse control changes native window size');
  fs.writeFileSync(path.join(out, 'compact.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('#compact-expand').click()"); await settle();
  assert.equal(settings.collapsed, false); assert.equal(win.getBounds().height, 254);
  checks.push('expand control restores window');
  win.showInactive(); await evaluate("document.querySelector('#hide').click()"); await settle();
  assert.equal(win.isVisible(), false); show(); assert.equal(win.isVisible(), true);
  checks.push('hide to tray and restore');
  assert.equal(Menu.buildFromTemplate(menuItems()).items.length, 14);
  checks.push('native tray menu constructs');
  settings.language = 'en'; publish(); await settle();
  assert.equal(await evaluate("document.querySelector('#short-title').textContent"), '5 hours');
  checks.push('English language');
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
    else if (argv.includes('--hide')) win.hide();
    else if (argv.includes('--toggle')) toggle();
    else show();
  });
  app.whenReady().then(async () => {
    if (process.argv.includes('--quit') || process.argv.includes('--hide')) { quit(); return; }
    if (!settings.language) settings.language = app.getLocale().startsWith('zh') ? 'zh' : 'en';
    if (smoke) {
      settings.language = 'zh'; settings.collapsed = false; settings.topmost = true;
      state.quota = normalizeQuota({ rateLimits: { planType: 'plus', primary: { usedPercent: 36, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 12000 }, secondary: { usedPercent: 72, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 172800 } } });
      state.loading = false;
    }
    win = new BrowserWindow({
      ...position(), frame: false, transparent: true, resizable: false,
      alwaysOnTop: settings.topmost, skipTaskbar: true, show: false,
      hasShadow: false, fullscreenable: false, maximizable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.setOpacity(settings.opacity);
    if (settings.topmost) win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); app.dock?.hide(); }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    win.on('moved', () => {
      const [x, y] = win.getPosition(); settings.position = { x, y };
      clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300);
    });
    screen.on('display-removed', () => { win.setBounds(position()); persist(); });
    screen.on('display-metrics-changed', () => { win.setBounds(position()); });
    ipcMain.handle('quota:state', () => snapshot());
    ipcMain.on('quota:action', (event, action) => {
      if (event.sender !== win.webContents) return;
      if (action === 'refresh') refresh();
      else if (action === 'collapse') collapse();
      else if (action === 'hide') win.hide();
      else if (action === 'menu') Menu.buildFromTemplate(menuItems()).popup({ window: win });
    });
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png')).resize({ width: process.platform === 'darwin' ? 18 : 24, height: process.platform === 'darwin' ? 18 : 24 });
    if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
    tray = new Tray(trayIcon);
    tray.on('double-click', show); tray.on('click', () => { if (process.platform === 'win32') toggle(); });
    updateTray();
    const shortcut = globalShortcut.register('CommandOrControl+Shift+Q', toggle);
    state.shortcutAvailable = shortcut;
    powerMonitor.on('resume', () => refresh());
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (smoke) await smokeTest();
    else { if (!process.argv.includes('--background')) show(); refresh(); }
  }).catch(error => {
    if (smoke) { fs.writeFileSync(path.join(process.env.CODEX_QUOTA_TEST_DIR, 'failure.txt'), error.stack); process.exitCode = 1; }
    else dialog.showErrorBox('Codex Quota', choose('启动失败，请重新安装悬浮窗。', 'Could not start. Please reinstall the overlay.'));
    quitting = true; app.exit(1);
  });
  app.on('before-quit', () => {
    quitting = true; clearTimeout(timer); clearTimeout(saveTimer); client?.close(); globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', () => {});
  app.on('activate', () => { if (win) show(); });
}
