// src/core/run-post-tool-use.js
// 平台无关:PostToolUse 钩子共享逻辑。
// TodoPro 工具 → 置推进标志;编辑类工具 → 记 touched-files。
// 仅用 Node 内置模块(零依赖)。

const { isEditTool } = require('./touched-files');
const sessionState = require('./session-state');
const touchedFiles = require('./touched-files');

function runPostToolUse(dir, toolName, toolInput) {
  // 1. TodoPro 工具 → 置推进标志,归零 nudge
  if (/^todopro$/i.test(toolName)) {
    sessionState.markTodoWritten(dir);
    return;
  }
  // 2. 编辑类工具 → 记 touched-files(内部判断活跃会话)
  if (isEditTool(toolName)) {
    touchedFiles.record(dir, toolName, toolInput);
  }
}

module.exports = { runPostToolUse };
