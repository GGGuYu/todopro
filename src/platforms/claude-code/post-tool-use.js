#!/usr/bin/env node
// src/platforms/claude-code/post-tool-use.js
// Claude Code PostToolUse 钩子:工具执行后触发。
// 两个职责(由 settings.json 配两条 matcher):
//   - TodoPro 工具调用后:置 wrote_todo_this_round,归零 nudge_count(推进了)
//   - 编辑类工具调用后:记 touched-files(仅活跃会话)
// 仅用 Node 内置模块(零依赖)。
//
// 用法:settings.json 的 hooks.PostToolUse 配两条,
//   matcher 分别为 "TodoPro" 和 "Write|Edit|MultiEdit|NotebookEdit"(编辑类)。

const { readStdin, emit, isTodoProTool } = require('./util');
const { isEditTool } = require('../../core/touched-files');
const sessionState = require('../../core/session-state');
const touchedFiles = require('../../core/touched-files');

function main() {
  const payload = readStdin();
  const dir = payload.cwd || process.cwd();
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input || {};

  // 1. TodoPro 工具调用 → 置推进标志,归零 nudge
  if (isTodoProTool(toolName)) {
    sessionState.markTodoWritten(dir);
    emit({});
    return;
  }

  // 2. 编辑类工具调用 → 记 touched-files(仅活跃会话,内部判断)
  if (isEditTool(toolName)) {
    // touchedFiles.record 内部会判断是否活跃会话、是否编辑类
    touchedFiles.record(dir, toolName, toolInput);
  }

  emit({});
}

try {
  main();
} catch (e) {
  process.stderr.write('TodoPro post-tool-use error: ' + (e && e.message || e) + '\n');
  emit({});
}
