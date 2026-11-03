'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// Bounds are DIPs here. Native physical rectangles are converted by Electron.
function findFreeBounds(bar, occupied, width = 178, height = 32, preferred) {
  if (!bar || bar.height < 16 || bar.height > 100 || bar.width < width || bar.width < bar.height * 3) return null;
  const left = bar.x + 8, right = bar.x + bar.width - 8;
  const blocks = occupied.filter(r => r.y < bar.y + bar.height && r.y + r.height > bar.y && r.width > 0)
    .map(r => [Math.max(left, r.x - 8), Math.min(right, r.x + r.width + 8)])
    .filter(r => r[1] > left && r[0] < right).sort((a, b) => a[0] - b[0]);
  let start = left; const spaces = [];
  for (const [a, b] of blocks) { if (a - start >= width) spaces.push([start, a - width]); start = Math.max(start, b); }
  if (right - start >= width) spaces.push([start, right - width]);
  if (!spaces.length) return null;
  // Prefer a gap near the app buttons, away from notification-area utilities.
  const desired = Number.isFinite(preferred) ? preferred : left;
  const candidates = spaces.map(([a, b]) => Math.max(a, Math.min(b, desired)));
  const x = candidates.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0];
  return { x: Math.round(x), y: Math.round(bar.y + (bar.height - Math.min(height, bar.height - 4)) / 2), width, height: Math.min(height, bar.height - 4) };
}
function popoverBounds(anchor, area, width, height) {
  const x = Math.max(area.x, Math.min(area.x + area.width - width, anchor.x + anchor.width / 2 - width / 2));
  const below = anchor.y + anchor.height + 5;
  const y = below + height <= area.y + area.height ? below : anchor.y - height - 5;
  return { x: Math.round(x), y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height };
}
class TaskbarWatcher extends EventEmitter {
  start() {
    this.wanted = true;
    if (this.child) return;
    const script = path.join(__dirname, 'read-windows-taskbar.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ExcludeProcessId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { this.child?.kill(); this.emit('unavailable'); return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/^\uFEFF/, '').trim(); buffer = buffer.slice(end + 1);
        try { const data = JSON.parse(line); if (Array.isArray(data.bars)) { this.last = Date.now(); this.emit('layout', data); } } catch {}
      }
    });
    this.child.on('error', () => this.emit('unavailable'));
    this.child.on('close', () => { clearInterval(this.timer); this.child = null; this.emit('unavailable'); if (this.wanted) this.retry = setTimeout(() => this.start(), 5000); });
    this.last = Date.now();
    this.timer = setInterval(() => { if (Date.now() - this.last > 12000) { this.child?.kill(); this.emit('unavailable'); } }, 3000);
  }
  stop() { this.wanted = false; clearTimeout(this.retry); clearInterval(this.timer); this.child?.kill(); this.child = null; }
}
module.exports = { findFreeBounds, popoverBounds, TaskbarWatcher };
