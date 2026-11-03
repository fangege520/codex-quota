const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validPort, isWorkspaceTarget, validSocket, displayPayload, listTargets } = require('../lib/composer.cjs');
test('CDP connection is restricted to a local page websocket and valid port', () => {
  assert.equal(validPort(9339), true); assert.equal(validPort(80), false); assert.equal(validPort('9339'), false);
  assert.equal(validSocket('ws://127.0.0.1:9339/devtools/page/ABC', 9339), true);
  for (const url of ['ws://192.168.1.1:9339/devtools/page/ABC', 'ws://example.com:9339/devtools/page/ABC', 'wss://127.0.0.1:9339/devtools/page/ABC', 'ws://127.0.0.1:9338/devtools/page/ABC', 'ws://127.0.0.1:9339/devtools/browser/ABC']) assert.equal(validSocket(url, 9339), false);
});
test('only native workspace pages are eligible, excluding web tabs and pets', () => {
  assert.equal(isWorkspaceTarget({ type: 'page', url: 'app://app/index.html' }), true);
  assert.equal(isWorkspaceTarget({ type: 'page', url: 'app://-/codex/thread/example' }), true);
  assert.equal(isWorkspaceTarget({ type: 'page', url: 'app://fs/Users/test/file.html' }), false);
  assert.equal(isWorkspaceTarget({ type: 'page', url: 'file:///Applications/ChatGPT.app/Contents/Resources/webview/index.html' }), true);
  for (const target of [{ type: 'worker', url: 'app://app/index.html' }, { type: 'page', url: 'https://chatgpt.com/' }, { type: 'page', url: 'app://app/avatar-overlay' }, { type: 'page', url: 'app://app/detached-window.html' }, { type: 'page', url: 'file:///tmp/arbitrary.html' }]) assert.equal(isWorkspaceTarget(target), false);
});
test('renderer payload contains only whitelisted display data', () => {
  const value = displayPayload({ quota: { short: { remaining: 71, resetsAt: 1234, token: 'secret' }, weekly: { remaining: 0 }, fetchedAt: 100, accountId: 'private' }, error: 'PRIVATE SERVER ERROR', settings: { language: 'en', codexPath: '/private' }, email: 'private' });
  assert.deepEqual(value, { short: { remaining: 71, resetsAt: 1234 }, weekly: { remaining: 0, resetsAt: null }, fetchedAt: 100, error: true, language: 'en', demo: false });
  assert.equal(displayPayload({ quota: { short: { remaining: null } } }).short, null);
});
test('invalid port is rejected before any connection attempt', async () => { await assert.rejects(listTargets(65536), /INVALID_CDP_PORT/); });
