#!/usr/bin/env node
// src/platforms/codex/stop-hook.js
// Codex Stop 钩子。共享 runStop 逻辑,I/O 用 Codex 格式(exit 2 + stderr 续跑)。
// 仅用 Node 内置模块(零依赖)。

const { readStdin, stopEmit } = require('./util');
const { runStop } = require('../../core/run-stop');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  const decision = runStop(dir);
  stopEmit({
    block: decision.action === 'block',
    injectText: decision.injectText,
    reason: decision.reason,
  });
}

try { main(); }
catch (e) {
  process.stderr.write('TodoPro codex stop-hook error: ' + (e && e.message || e) + '\n');
  process.exit(0);
}
