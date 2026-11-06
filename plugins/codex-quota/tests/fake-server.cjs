const { createInterface } = require('node:readline');
createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (!('id' in msg)) return;
  if (process.argv.includes('--exit')) { process.exit(3); return; }
  let result = {};
  if (msg.method === 'account/read') result = { account: { type: process.argv.includes('--api-key') ? 'apiKey' : 'chatgpt', planType: 'prolite' } };
  if (msg.method === 'account/rateLimits/read') result = { rateLimits: { primary: { usedPercent: 17, windowDurationMins: 300 } } };
  const output = JSON.stringify(process.argv.includes('--error') ? { id: msg.id, error: { message: 'PRIVATE-SERVER-DETAILS' } } : { id: msg.id, result }) + '\n';
  // Exercise newline framing across fragmented reads and unsolicited notifications.
  process.stdout.write('{"method":"unrelated/event"}\n');
  process.stdout.write(output.slice(0, 5));
  setTimeout(() => process.stdout.write(output.slice(5)), 5);
});
