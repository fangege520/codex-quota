const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
if (!process.env.CODEX_QUOTA_FIXTURE_DIR) throw new Error('Fixture needs an isolated profile');
if (typeof WebSocket !== 'function') throw new Error('Electron main needs the built-in WebSocket API');
app.setPath('userData', path.join(process.env.CODEX_QUOTA_FIXTURE_DIR, 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 370, show: false, webPreferences: { preload: path.join(__dirname, 'composer-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  ipcMain.on('fixture:quit', () => app.quit());
  await window.loadFile(path.join(__dirname, 'codex-quota-fixture.html'));
  const unrelated = new BrowserWindow({ show: false, width: 400, height: 200 });
  await unrelated.loadURL('data:text/html,<html><body>Unrelated test page</body></html>');
});
