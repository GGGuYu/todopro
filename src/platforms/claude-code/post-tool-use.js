#!/usr/bin/env node
// src/platforms/claude-code/post-tool-use.js
// Claude Code PostToolUse 钩子。共享 runPostToolUse 逻辑。
// 仅用 Node 内置模块(零依赖)。

const { readStdin, emit } = require('./util');
const { setPlatform } = require('../../core/paths');
setPlatform('claude-code');
const { runPostToolUse } = require('../../core/run-post-tool-use');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  runPostToolUse(dir, payload.tool_name, payload.tool_input || {});
  emit({});
}

try { main(); }
catch (e) {
  process.stderr.write('TodoPro post-tool-use error: ' + (e && e.message || e) + '\n');
  emit({});
}
