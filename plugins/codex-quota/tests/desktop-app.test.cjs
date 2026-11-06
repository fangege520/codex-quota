const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test('Windows Store launcher uses package activation and reports activation failure', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const calls = [];
  let fail = false;
  mock.method(fs, 'existsSync', () => true);
  mock.method(childProcess, 'spawnSync', (file, args, options) => {
    calls.push({ file, args, options });
    return args.includes('-File')
      ? fail ? { status: 1, stderr: 'Activation denied' } : { status: 0, stdout: '{"ok":true,"pid":1234}' }
      : { status: 0, stdout: '' };
  });
  const modulePath = require.resolve('../lib/desktop-app.cjs');
  delete require.cache[modulePath];
  try {
    const { launchDesktop } = require(modulePath);
    const executable = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_example\\app\\ChatGPT.exe';
    assert.deepEqual(await launchDesktop({ executable, port: 9339 }), { executable, port: 9339, pid: 1234 });
    const activation = calls.find(call => call.args.includes('-File'));
    assert.equal(activation.file, 'powershell.exe');
    assert.equal(activation.args[activation.args.indexOf('-Executable') + 1], executable);
    assert.equal(activation.args[activation.args.indexOf('-Port') + 1], '9339');
    assert.equal(activation.options.windowsHide, true);
    fail = true;
    await assert.rejects(launchDesktop({ executable }), /DESKTOP_ACTIVATION_FAILED: Activation denied/);
    await assert.rejects(launchDesktop({ executable, port: 80 }), /INVALID_CDP_PORT/);
  } finally {
    mock.restoreAll();
    Object.defineProperty(process, 'platform', platform);
    delete require.cache[modulePath];
  }
});

test('macOS AppKit can report desktop bundle status', { skip: process.platform !== 'darwin' }, () => {
  const script = path.join(__dirname, '..', 'lib', 'stop-mac-app.js');
  const result = childProcess.execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', script, '/Applications/Codex Quota Test.app', 'status'], { encoding: 'utf8', timeout: 5000 });
  assert.match(result.trim(), /^(?:stopped|other)$/);
});

test('macOS uses the selected ChatGPT bundle for both quota and desktop launch', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const app = path.resolve('Apps With Spaces', 'ChatGPT.app');
  const classic = path.resolve('Apps With Spaces', 'ChatGPT Classic.app');
  const guiExecutable = path.join(app, 'Contents', 'MacOS', 'ChatGPT');
  const resources = path.join(app, 'Contents', 'Resources');
  const codex = path.join(resources, 'codex');
  const archive = path.join(resources, 'app.asar');
  const exists = fs.existsSync;
  const access = fs.accessSync;
  const stat = fs.statSync;
  const calls = [];
  let status = 'stopped', openFails = false;
  mock.method(fs, 'existsSync', file => [app, classic, guiExecutable, archive].includes(file) || exists(file));
  mock.method(fs, 'accessSync', (file, mode) => { if (file !== codex) access(file, mode); });
  mock.method(fs, 'statSync', file => file === codex ? { isFile: () => true } : stat(file));
  mock.method(childProcess, 'spawnSync', (file, args) => {
    calls.push({ file, args });
    return { status: 0, stdout: status + '\n' };
  });
  mock.method(childProcess, 'execFile', (file, args, _options, callback) => {
    calls.push({ file, args });
    callback(openFails ? new Error('Launch Services error') : null, '', '');
  });
  const modulePath = require.resolve('../lib/desktop-app.cjs');
  delete require.cache[modulePath];
  try {
    const { discoverDesktopApp, launchDesktop } = require(modulePath);
    const { discoverCodex } = require('../lib/codex.cjs');
    assert.equal(discoverCodex(app), codex);
    assert.equal(discoverCodex(guiExecutable), codex);
    assert.equal(discoverDesktopApp(guiExecutable), app);
    assert.throws(() => discoverCodex(classic), /CODEX_MAC_APP_UNSUPPORTED/);
    assert.throws(() => discoverDesktopApp(classic), /DESKTOP_APP_UNSUPPORTED/);
    assert.deepEqual(await launchDesktop({ executable: app }), { executable: app, port: 9339 });
    assert.deepEqual(calls.find(call => call.file === '/usr/bin/open')?.args,
      ['-a', app, '--args', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9339']);
    openFails = true;
    await assert.rejects(launchDesktop({ executable: app }), /DESKTOP_LAUNCH_FAILED/);
    status = 'running';
    await assert.rejects(launchDesktop({ executable: app }), /CODEX_RESTART_REQUIRED/);
    status = 'other';
    await assert.rejects(launchDesktop({ executable: app }), /DESKTOP_OTHER_APP_RUNNING/);
  } finally {
    mock.restoreAll();
    Object.defineProperty(process, 'platform', platform);
    delete require.cache[modulePath];
  }
});
