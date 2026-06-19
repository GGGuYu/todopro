// src/core/run-post-tool-use.js
// 平台无关:PostToolUse 钩子共享逻辑。
// 推进检测:模型用 Bash 调 todopro-tool.js 时,从命令内容识别(不再靠工具名 matcher)。
// 文件记录:编辑类工具 → 记 touched-files。
// 仅用 Node 内置模块(零依赖)。

const { isEditTool } = require('./touched-files');
const sessionState = require('./session-state');
const touchedFiles = require('./touched-files');

// 判断一个工具调用是否为"调用 TodoPro"(推进)。
// 两类:
//   1. 工具名直接叫 TodoPro(Hana 平台 registerTool 注册的真工具)
//   2. shell/bash 命令里用 node 调用 todopro-tool.js(Claude Code/Codex 上模型经 shell 调脚本)
//      不同平台命令字段名不同(command / cmd / args),尽力提取。
// P1-H4 修复:正则收紧为 node\s+\S*todopro-tool\.js(要求 node 调用,不是字面出现)。
//   避免 grep -r todopro-tool.js 之类的命令被误判为推进。
function isTodoProCall(toolName, toolInput) {
  if (toolName && /^todopro$/i.test(toolName)) return true;
  if (toolName && /^(bash|shell)$/i.test(toolName) && toolInput) {
    const cmd = toolInput.command || toolInput.cmd ||
      (typeof toolInput.args === 'string' ? toolInput.args : '') ||
      (Array.isArray(toolInput.args) ? toolInput.args.join(' ') : '');
    // 要求 node 命令调用 todopro-tool.js(中间可有路径/参数),不是 grep/cat 等字面包含
    if (typeof cmd === 'string' && /node\s+\S*todopro-tool\.js/.test(cmd)) return true;
  }
  return false;
}

function runPostToolUse(dir, toolName, toolInput) {
  // 1. TodoPro 调用 → 置推进标志,归零 nudge
  if (isTodoProCall(toolName, toolInput)) {
    sessionState.markTodoWritten(dir);
    return;
  }
  // 2. 编辑类工具 → 记 touched-files(内部判断活跃会话)
  if (isEditTool(toolName)) {
    touchedFiles.record(dir, toolName, toolInput);
  }
}

module.exports = { runPostToolUse, isTodoProCall };
