const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');

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
