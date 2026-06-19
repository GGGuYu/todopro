// src/platforms/hana/extensions/index.js
// HanaAgent full-access 插件:TodoPro 适配层。
// 通过 Pi SDK extension 事件接入,复用同一份平台无关核心逻辑。
//
// 安装:由 init.js 拷贝到 ${HANA_HOME}/plugins/todopro/extensions/index.js
// 需在 Hana 设置开启"允许全权插件"。
//
// Pi 事件 ↔ 我们的钩子映射:
//   turn_end    ↔ Stop         (一轮结束,检测是否该阻断/续跑)
//   tool_result ↔ PostToolUse  (TodoPro 工具→置推进;编辑类→记 touched-files)
//   agent_end   ↔ SubagentStop (子 agent 结束→置 subagent_fired)
//
// 注入续跑:Pi 的 turn_end 不能"阻止停止",但可用 api.sendUserMessage(content, {deliverAs:"followUp"})
//   主动发一条消息触发新 turn——等价于 Claude Code 的 block+additionalContext。
//
// 核心脚本路径:require 时用绝对路径指向 TodoPro 仓库的 src/core/。
//   实际部署时核心脚本随插件一起放置(或软链),此处假设核心脚本在插件目录的 ../../../../src/core/。
//   若路径不对,init.js 应调整。为稳健,用 try 多路径查找。

const path = require('path');

// 解析核心模块路径:优先插件内 bundled,其次 TodoPro 仓库源(开发态)
// 部署后:extensions/index.js 的 __dirname = plugins/todopro/extensions/
//   .. → plugins/todopro/,core → plugins/todopro/core/ ✓
function resolveCore(name) {
  const candidates = [
    path.join(__dirname, '..', 'core', name),                     // 插件内 bundled(部署态)
    path.join(__dirname, '..', '..', '..', '..', 'src', 'core', name), // TodoPro 仓库源(开发态)
  ];
  for (const p of candidates) {
    try { require.resolve(p); return p; } catch (e) { /* try next */ }
  }
  throw new Error('TodoPro core module not found: ' + name + ' (checked: ' + candidates.join(', ') + ')');
}

const todoStore = require(resolveCore('todo-store'));
const sessionState = require(resolveCore('session-state'));
const { runStop } = require(resolveCore('run-stop'));
const { runPostToolUse } = require(resolveCore('run-post-tool-use'));

// Hana 上 TodoPro 工具入口路径(用于替换提示词占位)
// Hana 是插件内 registerTool 的真工具,不是脚本;但提示词占位仍需一个可调用入口。
// Hana 上模型直接调 TodoPro 工具(非 Bash),占位替换为工具名提示。
const TODO_TOOL_HINT = 'TodoPro 工具(直接调用,参数 {todos:[...]} 或 {action:"..."}）';

// P0-H1:加载并注册 TodoPro 工具(tools/todopro.js)。
// 早期版本只在 extensions 里注册事件,没调 registerTool,导致模型看不到工具(死代码)。
const registerTodoProTool = require('../tools/todopro.js');

// ExtensionFactory:Pi 加载插件时调用,参数为 ExtensionAPI
module.exports = function (pi) {
  const cwd = pi.cwd || process.cwd();

  // P0-H1:注册 TodoPro 工具(模型才能看到并调用)
  registerTodoProTool(pi);

  // ─── turn_end ↔ Stop ───
  pi.on('turn_end', (event, context) => {
    try {
      const decision = runStop(cwd, TODO_TOOL_HINT);
      // 阻断+续跑:发一条 user message 触发新 turn(等价 block+additionalContext)
      if (decision.action === 'block' && decision.injectText) {
        pi.sendUserMessage(decision.injectText, { deliverAs: 'followUp' });
      }
      // 放行时的提示(交还用户/review完成)不续跑,可选写日志
    } catch (e) {
      // 钩子失败降级:不阻断
      context.ui && context.ui.error && context.ui.error('TodoPro turn_end error: ' + (e.message || e));
    }
  });

  // ─── tool_result ↔ PostToolUse ───
  pi.on('tool_result', (event, context) => {
    try {
      const toolName = event.toolName || (event.tool && event.tool.name);
      const toolInput = event.args || (event.tool && event.tool.input) || {};
      runPostToolUse(cwd, toolName, toolInput);
    } catch (e) {
      // 降级
    }
  });

  // ─── agent_end ↔ SubagentStop(子 agent 结束)───
  // @depends-on-pi-agentType:以下判断依赖 context.agentType 字段区分主/子 agent。
  //   Pi 文档的 agent_end event 结构是否有此字段尚未实机验证(AGENTS.md 已知限制 6)。
  //   若 Pi 不提供 agentType,Hana 上 SubagentStop 永不触发,review 子 agent 无法启动,
  //   review 永远完不成,最后熔断兜底。需实机验证后调整此分支。
  // 注意:agent_end 在主 agent 结束时也触发。Pi 无单独的"子 agent 结束"事件。
  // 此处为骨架,实际需根据 Pi 版本的事件字段调整。
  pi.on('agent_end', (event, context) => {
    try {
      // 仅当确实是子 agent 结束时才置标志(避免主 agent 结束误置)
      // Pi 的 agent_end event.messages 可判断,但更可靠的是看是否有 agentType
      if (context && context.agentType) {
        sessionState.markSubagentFired(cwd);
      }
    } catch (e) {
      // 降级
    }
  });
};
