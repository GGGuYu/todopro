#!/usr/bin/env node
// src/platforms/claude-code/subagent-stop.js
// Claude Code SubagentStop 钩子:子 agent 结束时触发。
// 职责:置 subagent_fired_this_round(供 Stop 钩子判断 review 是否真起过子 agent)。
// 仅用 Node 内置模块(零依赖)。
//
// spec: completion-review(子 agent 糊弄兜底)
// design: 决策 7(review 轮若无子 agent 调用则算 rv_nudge)

const { readStdin, emit } = require('./util');
const { setPlatform } = require('../../core/paths');
setPlatform('claude-code');
const sessionState = require('../../core/session-state');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  sessionState.markSubagentFired(dir);
  emit({});
}

try {
  main();
} catch (e) {
  process.stderr.write('TodoPro subagent-stop error: ' + (e && e.message || e) + '\n');
  emit({});
}
