'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { ComposerBridge, CdpConnection, listTargets } = require('../lib/composer.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = path.resolve(__dirname, '..', 'test-results', 'composer');
fs.mkdirSync(out, { recursive: true });
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function until(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const result = await test(); if (result) return result; } catch {} await pause(150); }
  throw new Error(`Timed out: ${label}`);
}
async function main() {
  const port = await freePort();
  const env = { ...process.env, CODEX_QUOTA_FIXTURE_DIR: out }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(__dirname, '..', 'tests', 'fixtures', 'composer-app.cjs'), '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.resume();
  const timeout = setTimeout(() => { child.kill(); console.error('Composer integration timed out'); process.exitCode = 1; }, 75000);
  let inspector, bridge;
  const checks = [];
  try {
    const target = await until(async () => (await listTargets(port)).find(t => t.url.includes('codex-quota-fixture.html')), 'fixture launch');
    inspector = new CdpConnection(target.webSocketDebuggerUrl, port); await inspector.open();
    const evaluate = async expression => {
      const result = await inspector.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('Fixture evaluation failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text).slice(0, 800));
      return result.result?.value;
    };
    await until(async () => (await evaluate("document.readyState === 'complete' && !!document.querySelector('#prompt')")) === true, 'fixture DOM readiness');
    const original = await evaluate("document.querySelector('#prompt').textContent");
    bridge = new ComposerBridge({ port, targetFilter: t => t.type === 'page' && t.url.includes('codex-quota-fixture.html') });
    let settingsOpened = 0; bridge.on('settings', () => settingsOpened++);
    const state = { demo: true, settings: { language: 'zh' }, quota: { fetchedAt: Date.now(), short: { remaining: 86, resetsAt: Date.now() + 12000000 }, weekly: { remaining: 26, resetsAt: Date.now() + 170000000 } } };
    bridge.update(state); bridge.start();
    await until(() => bridge.status.visible === 1, 'CDP widget injection');
    assert.equal(bridge.status.targets, 1); checks.push('only the intended workspace target receives the strip');
    const values = await evaluate("[...document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelectorAll('.value')].map(n=>n.textContent)");
    assert.deepEqual(values, ['86%', '26%']); checks.push('real CDP evaluates the owned widget and displays live payload');
    await evaluate("window.__codexQuotaOpenSettingsV1('arbitrary-command')"); await pause(100);
    assert.equal(settingsOpened, 0);
    await evaluate("document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelector('.settings').click()");
    await until(() => settingsOpened === 1, 'settings button binding');
    checks.push('settings button reaches the companion through a single whitelisted action');
    const layout = await evaluate("(()=>{const strip=document.querySelector('#codex-quota-composer-v1').getBoundingClientRect(),anchor=document.querySelector('[data-codex-intelligence-trigger]').getBoundingClientRect(),left=document.querySelector('#permissions').getBoundingClientRect();return {left:strip.left,right:strip.right,modelLeft:anchor.left,permissionRight:left.right}})()");
    assert(layout.right < layout.modelLeft); assert(layout.left > layout.permissionRight); checks.push('strip fits in empty space left of model picker without covering controls');
    assert.equal(await evaluate("document.querySelector('#prompt').textContent"), original);
    await evaluate("document.querySelector('#send').click()"); assert.equal(await evaluate('window.sentCount'), 1);
    checks.push('editor content and native send action remain functional');
    const screenshot = await inspector.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 'composer-preview.png'), Buffer.from(screenshot.data, 'base64'));
    // A second install and repeated heartbeats must not create duplicate widgets.
    state.quota.short.remaining = 71; state.quota.weekly.remaining = 0; bridge.update(state);
    await until(async () => (await evaluate("document.querySelector('#codex-quota-composer-v1')?.shadowRoot.querySelector('.weekly').textContent")) === '0%', 'quota refresh');
    assert.equal(await evaluate("document.querySelectorAll('#codex-quota-composer-v1').length"), 1);
    checks.push('refresh preserves zero quota and avoids duplicate widgets');
    const previousY = await evaluate('window.__codexQuotaComposerV1.status().bounds.y');
    await evaluate("(()=>{const f=document.querySelector('.footer');const next=f.cloneNode(true);next.style.transform='translateY(8px)';f.replaceWith(next)})()");
    await until(async () => (await evaluate('window.__codexQuotaComposerV1.status().bounds.y')) === previousY + 8, 'footer rerender');
    assert.equal(await evaluate("document.querySelector('#prompt').textContent"), original); checks.push('composer rerender reanchors the strip without editing the prompt');
    await inspector.call('Emulation.setDeviceMetricsOverride', { width: 600, height: 370, deviceScaleFactor: 1, mobile: false });
    await until(async () => (await evaluate("document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelector('.strip').classList.contains('settings-only') && window.__codexQuotaComposerV1.status().visible")) === true, 'settings-only fallback');
    await evaluate("document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelector('.settings').click()");
    await until(() => settingsOpened === 2, 'settings-only button binding');
    checks.push('narrow composer retains a usable settings-only button');
    await inspector.call('Emulation.setDeviceMetricsOverride', { width: 480, height: 370, deviceScaleFactor: 1, mobile: false });
    await until(async () => (await evaluate('window.__codexQuotaComposerV1.status().reason')) === 'insufficient-space', 'narrow window fallback');
    checks.push('narrow windows hide the strip instead of overlapping native controls');
    await inspector.call('Emulation.clearDeviceMetricsOverride');
    await until(async () => (await evaluate('window.__codexQuotaComposerV1.status().visible')) === true, 'restore width');
    await inspector.call('Page.reload');
    await until(async () => (await evaluate('window.__codexQuotaComposerV1?.status().visible')) === true, 'page reload');
    assert.equal(await evaluate("document.querySelectorAll('#codex-quota-composer-v1').length"), 1); checks.push('page reload restores a single widget');
    await pause(600); // Keep this independent click outside the spam guard.
    assert.equal(await evaluate('typeof window.__codexQuotaOpenSettingsV1'), 'function');
    await evaluate("document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelector('.settings').click()");
    await until(() => settingsOpened === 3, 'settings binding after reload');
    state.error = 'CONNECTION_FAILED'; bridge.update(state);
    await until(async () => (await evaluate("document.querySelector('#codex-quota-composer-v1')?.shadowRoot.querySelector('.strip').classList.contains('stale')")) === true, 'stale flag');
    checks.push('failed quota refresh is visibly marked as cached data');
    await bridge.stop();
    assert.equal(await evaluate("document.querySelector('#codex-quota-composer-v1') === null && !window.__codexQuotaComposerV1"), true);
    await inspector.call('Page.reload'); await pause(500);
    assert.equal(await evaluate("document.querySelector('#codex-quota-composer-v1') === null && !window.__codexQuotaComposerV1"), true);
    checks.push('disable removes UI, observers and reload registration');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, checks }, null, 2));
    console.log(JSON.stringify({ platform: process.platform, checks }, null, 2));
    await evaluate('window.fixture.quit()').catch(() => {});
  } finally {
    await bridge?.stop(); inspector?.close(); clearTimeout(timeout);
    if (child.exitCode == null) child.kill();
  }
}
main().catch(error => { fs.writeFileSync(path.join(out, 'failure.txt'), error.stack); console.error(error.message); process.exitCode = 1; });
