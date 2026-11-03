'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { DEFAULT_PORT, validPort } = require('./composer.cjs');

function windowsApps() {
  const script = '$ErrorActionPreference="SilentlyContinue"; $items=@(Get-Process ChatGPT,Codex | Where-Object { $_.Path -and ($_.ProcessName -eq "ChatGPT" -or $_.Path -match "WindowsApps.*\\\\app\\\\Codex.exe$") } | Select-Object -ExpandProperty Path -Unique); if($items.Count -eq 0){$items=@(Get-AppxPackage OpenAI.Codex | ForEach-Object { Join-Path $_.InstallLocation "app\\ChatGPT.exe" })}; ConvertTo-Json -Compress -InputObject @($items)';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  try { const value = JSON.parse(result.stdout.trim()); return Array.isArray(value) ? value : [value]; } catch { return []; }
}
function discoverDesktopApp(override) {
  if (override) {
    if (!fs.existsSync(override)) throw new Error('DESKTOP_APP_NOT_FOUND');
    return override;
  }
  if (process.platform === 'win32') {
    const found = windowsApps().find(file => typeof file === 'string' && fs.existsSync(file));
    if (found) return found;
  } else if (process.platform === 'darwin') {
    for (const name of ['ChatGPT', 'Codex']) for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const bundle = path.join(base, `${name}.app`);
      if (fs.existsSync(bundle)) return bundle;
    }
  }
  throw new Error('DESKTOP_APP_NOT_FOUND');
}
function isDesktopRunning() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'if(Get-Process ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq "ChatGPT" -or $_.Path -match "WindowsApps.*\\\\app\\\\Codex.exe$" }){"running"}'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    // Treat detection failure as running; never silently launch a conflicting instance.
    return result.status !== 0 || result.stdout.includes('running');
  }
  if (process.platform === 'darwin') return spawnSync('/usr/bin/pgrep', ['-x', 'ChatGPT|Codex'], { windowsHide: true, timeout: 3000 }).status !== 1;
  return true;
}
async function launchDesktop({ executable, port = DEFAULT_PORT } = {}) {
  if (!validPort(port)) throw new Error('INVALID_CDP_PORT');
  if (isDesktopRunning()) throw new Error('CODEX_RESTART_REQUIRED');
  const file = discoverDesktopApp(executable);
  const flags = ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`];
  const mac = process.platform === 'darwin';
  const child = spawn(mac ? '/usr/bin/open' : file, mac ? ['-a', file, '--args', ...flags] : flags, { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('DESKTOP_LAUNCH_FAILED'))); });
  child.unref(); return { port, executable: file };
}
function runtimeFile() {
  const base = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(base, 'codex-quota', 'runtime-status.json');
}
module.exports = { discoverDesktopApp, isDesktopRunning, launchDesktop, runtimeFile };
