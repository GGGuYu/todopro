#!/usr/bin/env node
// src/platforms/codex/todopro-tool.js
// TodoPro 工具入口(Codex)。与 Claude Code 入口相同(共享 runTool)。
// Codex 上模型经 SKILL.md 引导用 shell 调用此脚本。
// 用法:echo '<todos JSON>' | node todopro-tool.js  或  node todopro-tool.js '<todos JSON>'
// 仅用 Node 内置模块(零依赖)。

const { setPlatform } = require('../../core/paths');
setPlatform('codex');
const { runTool } = require('../../core/run-todopro-tool');

try {
  const result = runTool();
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e && e.message || String(e) }));
  process.exit(0);
}
