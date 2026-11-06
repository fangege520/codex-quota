'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { DEFAULT_PORT, validPort } = require('./composer.cjs');
const { macAppBundle, isMacCodexApp } = require('./mac-app.cjs');
const script = name => path.join(__dirname, name).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');

function windowsApps() {
  const script = `
    $ErrorActionPreference="SilentlyContinue"
    [Console]::OutputEncoding=[Text.Encoding]::UTF8
    $session=(Get-Process -Id $PID).SessionId
    $items=@(Get-Process ChatGPT,Codex | Where-Object {
      $_.SessionId -eq $session -and $_.Path -and
        (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $_.Path) "resources/app.asar") -PathType Leaf)
    } | Select-Object -ExpandProperty Path -Unique)
    if($items.Count -eq 0){$items=@(Get-AppxPackage OpenAI.Codex | ForEach-Object { Join-Path $_.InstallLocation "app/ChatGPT.exe" })}
    ConvertTo-Json -Compress -InputObject @($items)
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  try { const value = JSON.parse(result.stdout.trim()); return Array.isArray(value) ? value : [value]; } catch { return []; }
}
function discoverDesktopApp(override) {
  if (override) {
    if (!fs.existsSync(override)) throw new Error('DESKTOP_APP_NOT_FOUND');
    if (process.platform === 'darwin') {
      const bundle = macAppBundle(override);
      if (!isMacCodexApp(bundle)) throw new Error('DESKTOP_APP_UNSUPPORTED');
      return bundle;
    }
    return override;
  }
  if (process.platform === 'win32') {
    const found = windowsApps().find(file => typeof file === 'string' && fs.existsSync(file));
    if (found) return found;
  } else if (process.platform === 'darwin') {
    for (const name of ['ChatGPT', 'Codex']) for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const bundle = path.join(base, `${name}.app`);
      if (isMacCodexApp(bundle)) return bundle;
    }
  }
  throw new Error('DESKTOP_APP_NOT_FOUND');
}
function isDesktopRunning(executable) {
  if (process.platform === 'win32') {
    const script = `
      $session=(Get-Process -Id $PID).SessionId
      if(Get-Process ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $session -and ($_.ProcessName -eq "ChatGPT" -or
          ($_.Path -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $_.Path) "resources/app.asar") -PathType Leaf)))
      }){"running"}
    `;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    // Treat detection failure as running; never silently launch a conflicting instance.
    return result.status !== 0 || result.stdout.includes('running');
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', script('stop-mac-app.js'), executable, 'status'], { encoding: 'utf8', timeout: 5000 });
    const status = result.stdout?.trim();
    if (result.status !== 0 || !['running', 'stopped', 'other'].includes(status)) throw new Error('DESKTOP_STATUS_FAILED');
    if (status === 'other') throw new Error('DESKTOP_OTHER_APP_RUNNING');
    return status === 'running';
  }
  return true;
}
async function stopDesktop(executable) {
  const run = promisify(execFile);
  try {
    if (process.platform === 'win32') {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script('stop-windows-app.ps1'), '-Executable', executable], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      await run('/usr/bin/osascript', ['-l', 'JavaScript', script('stop-mac-app.js'), executable, 'stop'], { timeout: 10000 });
    } else {
      throw new Error('UNSUPPORTED_PLATFORM');
    }
  } catch (error) {
    throw new Error(error.code === 1223 ? 'CODEX_RESTART_CANCELED' : 'CODEX_STOP_FAILED', { cause: error });
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!isDesktopRunning(executable)) return;
    await delay(250);
  }
  throw new Error('CODEX_STOP_FAILED');
}
async function launchDesktop({ executable, port = DEFAULT_PORT } = {}) {
  if (!validPort(port)) throw new Error('INVALID_CDP_PORT');
  const file = discoverDesktopApp(executable);
  if (isDesktopRunning(file)) throw new Error('CODEX_RESTART_REQUIRED');
  const flags = ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`];
  if (process.platform === 'win32' && /[\\/]WindowsApps[\\/]/i.test(file)) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script('activate-windows-app.ps1'), '-Executable', file, '-Port', String(port)], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (result.status !== 0) throw new Error(`DESKTOP_ACTIVATION_FAILED: ${(result.stderr || result.error?.message || '').trim().slice(0, 400)}`);
    let activation;
    try { activation = JSON.parse(result.stdout.trim()); } catch { throw new Error('DESKTOP_ACTIVATION_FAILED'); }
    if (!activation.ok || !Number.isInteger(activation.pid)) throw new Error('DESKTOP_ACTIVATION_FAILED');
    return { port, executable: file, pid: activation.pid };
  }
  if (process.platform === 'darwin') {
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/open', ['-a', file, '--args', ...flags], { timeout: 15000 }, error => {
        if (error) reject(new Error('DESKTOP_LAUNCH_FAILED', { cause: error }));
        else resolve();
      });
    });
    return { port, executable: file };
  }
  const child = spawn(file, flags, { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('DESKTOP_LAUNCH_FAILED'))); });
  child.unref(); return { port, executable: file };
}
function runtimeFile() {
  const base = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(base, 'codex-quota', 'runtime-status.json');
}
module.exports = { discoverDesktopApp, isDesktopRunning, launchDesktop, stopDesktop, runtimeFile };
