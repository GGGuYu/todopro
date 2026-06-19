// src/platforms/claude-code/util.js
// Claude Code 适配层共享工具:读 stdin JSON、组装输出、归一化事件。
// 仅用 Node 内置模块(零依赖)。

const fs = require('fs');

// 从 stdin 读取 Claude Code hook 的 JSON payload
function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

// 组装 Stop/SubagentStop 的输出:allow / block + 注入
//   block: bool       是否阻断
//   injectText: string|null  注入的 additionalContext
//   reason: string    block 时的 reason(给用户看)
function stopOutput({ block, injectText, reason }) {
  const out = {};
  if (block) {
    out.decision = 'block';
    out.reason = reason || 'blocked by TodoPro guard';
  }
  if (injectText) {
    out.hookSpecificOutput = {
      hookEventName: 'Stop',
      additionalContext: injectText,
    };
  }
  return out;
}

// 组装 PostToolUse 的输出:allow(可注入 additionalContext)
// 输出 JSON 并以 exit 0 退出(Claude Code 仅在 exit 0 时处理 JSON)
function emit(obj) {
  if (obj && Object.keys(obj).length > 0) {
    process.stdout.write(JSON.stringify(obj));
  }
  process.exit(0);
}

module.exports = {
  readStdin,
  stopOutput,
  emit,
};
