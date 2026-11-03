const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareRuntime } = require('../lib/runtime.cjs');

test('persistent runtime still launches after plugin cache dependencies are removed', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-quota-runtime-test-'));
  const source = path.join(temp, 'plugin-cache');
  const base = path.join(temp, 'application-data');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  try {
    write(path.join(source, 'package.json'), '{"version":"0.2.2"}');
    write(path.join(source, 'package-lock.json'), '{}');
    for (const dir of ['desktop', 'lib', 'assets']) write(path.join(source, dir, 'fixture.txt'), dir);
    const binary = process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron';
    write(path.join(source, 'node_modules/electron/dist', binary), 'test binary');
    write(path.join(source, 'node_modules/electron/index.js'), "module.exports=require('node:path').join(__dirname,'dist'," + JSON.stringify(binary) + ');');
    const first = prepareRuntime(source, base);
    assert.ok(first.app.startsWith(base + path.sep));
    assert.equal(fs.readFileSync(first.electron, 'utf8'), 'test binary');
    fs.rmSync(path.join(source, 'node_modules'), { recursive: true });
    const second = prepareRuntime(source, base);
    assert.deepEqual(second, first);
    assert.equal(fs.readFileSync(path.join(second.app, 'desktop/fixture.txt'), 'utf8'), 'desktop');
    write(path.join(source, 'package.json'), '{"version":"../outside"}');
    assert.throws(() => prepareRuntime(source, base), /INVALID_RUNTIME_VERSION/);
  } finally {
    if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('codex-quota-runtime-test-')) throw Error('Invalid test cleanup path');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
