#!/usr/bin/env node
// src/platforms/codex/post-tool-use.js
// Codex PostToolUse 钩子。共享 runPostToolUse 逻辑。
// 仅用 Node 内置模块(零依赖)。

const { readStdin, postToolUseEmit } = require('./util');
const { setPlatform } = require('../../core/paths');
setPlatform('codex');
const { runPostToolUse } = require('../../core/run-post-tool-use');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  runPostToolUse(dir, payload.tool_name, payload.tool_input || {});
  postToolUseEmit();
}

try { main(); }
catch (e) {
  process.stderr.write('TodoPro codex post-tool-use error: ' + (e && e.message || e) + '\n');
  process.exit(0);
}
