#!/usr/bin/env node
// src/platforms/codex/subagent-stop.js
// Codex SubagentStop 钩子。置 subagent_fired_this_round。
// 仅用 Node 内置模块(零依赖)。

const { readStdin } = require('./util');
const { setPlatform } = require('../../core/paths');
setPlatform('codex');
const sessionState = require('../../core/session-state');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  sessionState.markSubagentFired(dir);
  process.exit(0);
}

try { main(); }
catch (e) {
  process.stderr.write('TodoPro codex subagent-stop error: ' + (e && e.message || e) + '\n');
  process.exit(0);
}
