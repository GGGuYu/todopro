// src/platforms/codex/util.js
// Codex 适配层共享工具。
// 仅用 Node 内置模块(零依赖)。
//
// Codex hooks I/O(已核实 openai/codex codex-rs/hooks/src/):
//   输入(stdin JSON): { hook_event_name, cwd, session_id, turn_id, tool_name?, tool_input?, ... }
//   Stop/SubagentStop 阻断+续跑:exit 2,把 continuation prompt 写到 stderr。
//     Codex 把 stderr 内容作为 continuation_fragments 注入回对话(等价于 Claude Code 的 additionalContext)。
//   放行:exit 0(可选输出 JSON,如 system_message 给用户看)。
//   PostToolUse 注入:exit 2 + stderr(作为 feedback),或 JSON decision:"block"+reason。

const fs = require('fs');

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

// Stop 钩子输出:阻断则 exit 2 + stderr(continuation prompt);放行则 exit 0。
// Codex 把 stderr 作为续跑提示注入对话。
function stopEmit({ block, injectText, reason }) {
  if (block && injectText) {
    // 阻断 + 注入续跑提示:exit 2,提示词到 stderr
    process.stderr.write(injectText);
    process.exit(2);
  }
  if (block) {
    // 阻断但无注入文本(不应发生,兜底)
    process.stderr.write(reason || 'blocked by TodoPro guard');
    process.exit(2);
  }
  // 放行。若有注入文本(如熔断提示、review 完成确认),用 system_message 给用户看,
  // 但 Codex 的放行不续跑——所以放行时的提示更适合写 stderr(用户可见但不续跑)?
  // 实际:Codex exit 0 时不注入对话。放行提示对模型不可见。
  // 我们的"交还用户""review 完成"提示本质是给用户看的,写 stderr 即可。
  if (injectText) {
    process.stderr.write(injectText);
  }
  process.exit(0);
}

// PostToolUse 输出:Codex 上 PostToolUse 主要用于副作用(置标志/记文件),不需注入。
function postToolUseEmit() {
  process.exit(0);
}

function isTodoProTool(toolName) {
  if (!toolName) return false;
  // Codex 的 todo 工具叫 update_plan(内置);我们的工具仍叫 TodoPro。
  return /^todopro$/i.test(toolName);
}

module.exports = { readStdin, stopEmit, postToolUseEmit, isTodoProTool };
