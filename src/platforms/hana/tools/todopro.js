// src/platforms/hana/tools/todopro.js
// HanaAgent 插件:TodoPro 工具定义(通过 Pi SDK registerTool 注册)。
// 模型调用此工具实现全量替换 todo 或表达三个明确出口。
//
// P0-H1:由 extensions/index.js 调用此函数完成接线。
// N1 修复:handler 不再平行实现逻辑,改一行委托共享 runTool(决策只有一份)。
//   早期 handler 自己重写了 replace/generate/markTodoWritten/action 分支,与 runTool 漂移
//   (产生了 paused 死代码 N2)。现在只做 I/O 翻译:args → runTool 输入,runTool 输出 → 返回。

const path = require('path');

function resolveCore(name) {
  const candidates = [
    path.join(__dirname, '..', 'core', name),                     // 插件内 bundled(部署态)
    path.join(__dirname, '..', '..', '..', '..', 'src', 'core', name), // TodoPro 仓库源(开发态)
  ];
  for (const p of candidates) {
    try { require.resolve(p); return p; } catch (e) { /* try next */ }
  }
  throw new Error('TodoPro core module not found: ' + name);
}

// 工具工厂:接收 pi,注册 TodoPro 工具。
module.exports = function registerTodoProTool(pi) {
  pi.registerTool({
    name: 'TodoPro',
    description: 'Enhanced todo tool (full-replace semantics) with loop-exit guard and completion review. Use for multi-step/multi-file tasks instead of a plain todo list. Two call modes: (1) maintain — send {"todos":[...]} full list (overwrites); (2) exit action — send {"action":"pause"|"abandon"|"acknowledge_stall"}. Status per todo: pending|in_progress|completed|paused|abandoned. Keep stable ids when modifying. At most one in_progress at a time.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Complete todo list (full-replace). Each: { id?, content, status, priority? }. Use this for maintain exit.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'stable id (t1, t2...). Omit for new items.' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'paused', 'abandoned'] },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['content', 'status'],
          },
        },
        action: {
          type: 'string',
          enum: ['pause', 'abandon', 'acknowledge_stall'],
          description: 'Exit action (use instead of todos). pause=suspend session, abandon=withdraw requirement, acknowledge_stall=knowingly skip this turn (guard resumes next).',
        },
      },
      // todos 和 action 二选一,都不 required(由 handler 校验)
      required: [],
    },
    // N1 修复:handler 一行委托共享 runTool,只做 I/O 翻译。
    // args 可能是 {todos:[...]} 或 {action:"..."} 或 {todos:[...], action:undefined}。
    // runTool 接受 inputOverride 跳过 stdin 读取。
    handler: async (args, context) => {
      try {
        const { runTool } = require(resolveCore('run-todopro-tool'));
        const cwd = (context && context.cwd) || pi.cwd || process.cwd();
        // 委托共享逻辑(Hana handler 不再平行实现,避免漂移)
        return runTool(cwd, args);
      } catch (e) {
        return { ok: false, error: e && e.message || String(e) };
      }
    },
  });
};
