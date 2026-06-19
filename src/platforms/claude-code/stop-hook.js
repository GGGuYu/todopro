#!/usr/bin/env node
// src/platforms/claude-code/stop-hook.js
// Claude Code Stop 钩子:Agent 准备退出循环时触发。
// 读 payload → 调共享 runStop → 反归一化为 Claude Code 输出(block+additionalContext)。
// 仅用 Node 内置模块(零依赖)。

const { readStdin, stopOutput, emit } = require('./util');
const { runStop } = require('../../core/run-stop');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  const decision = runStop(dir);
  emit(stopOutput({
    block: decision.action === 'block',
    injectText: decision.injectText,
    reason: decision.reason,
  }));
}

try { main(); }
catch (e) {
  process.stderr.write('TodoPro stop-hook error: ' + (e && e.message || e) + '\n');
  emit({});
}
