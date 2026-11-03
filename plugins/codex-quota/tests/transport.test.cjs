const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { CodexClient, discoverCodex } = require('../lib/codex.cjs');
const fixture = path.join(__dirname, 'fake-server.cjs');

test('reads real child process RPC with fragmented stdout and initialized handshake', async () => {
  const client = new CodexClient(process.execPath, [fixture]);
  try { const q = await client.readQuota(); assert.equal(q.rateLimits.primary.usedPercent, 17); }
  finally { client.close(); }
  assert.equal(client.child, null); assert.equal(client.pending.size, 0);
});
test('API key login cannot be shown as ChatGPT subscription quota', async () => {
  const client = new CodexClient(process.execPath, [fixture, '--api-key']);
  try { await assert.rejects(client.readQuota(), /CHATGPT_LOGIN_REQUIRED/); }
  finally { client.close(); }
});
test('raw server error details never escape the RPC wrapper', async () => {
  const client = new CodexClient(process.execPath, [fixture, '--error']);
  try { await assert.rejects(client.readQuota(), error => error.message === 'CODEX_REQUEST_FAILED'); }
  finally { client.close(); }
});
test('server exit rejects pending work and can be closed without hanging', async () => {
  const client = new CodexClient(process.execPath, [fixture, '--exit']);
  try { await assert.rejects(client.readQuota(), /CODEX_DISCONNECTED/); }
  finally { client.close(); }
  assert.equal(client.pending.size, 0);
});
test('invalid explicit binary produces an actionable discovery error', () => {
  assert.throws(() => discoverCodex(path.join(__dirname, 'does-not-exist')), /CODEX_PATH_INVALID/);
});
