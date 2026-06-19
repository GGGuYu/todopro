#!/usr/bin/env node
// src/platforms/claude-code/todopro-tool.js
// TodoPro 工具入口(Claude Code)。共享 runTool 逻辑。
// 用法:echo '<todos JSON>' | node todopro-tool.js  或  node todopro-tool.js '<todos JSON>'
//   可选:第二个参数或 TODOPRO_DIR 环境变量指定 .todopro 目录(默认 process.cwd()/.todopro/)
//   P2-2:钩子用 payload.cwd,工具脚本用 process.cwd()。正常情况下两者一致(Claude Code 在项目目录运行)。
//   若不一致,用 TODOPRO_DIR 环境变量统一。
// 仅用 Node 内置模块(零依赖)。

const { setPlatform } = require('../../core/paths');
setPlatform('claude-code');
const { runTool } = require('../../core/run-todopro-tool');

try {
  const result = runTool();
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e && e.message || String(e) }));
  process.exit(0);
}
