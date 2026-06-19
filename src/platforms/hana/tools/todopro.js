// src/platforms/hana/tools/todopro.js
// HanaAgent 插件:TodoPro 工具定义(通过 Pi SDK registerTool 注册)。
// 模型调用此工具实现全量替换 todo。复用共享 runTool 逻辑。
//
// 安装:由 init.js 拷贝到 ${HANA_HOME}/plugins/todopro/tools/todopro.js
// 此文件 export 一个工厂函数,接收 pi,注册工具。

const path = require('path');

function resolveCore(name) {
  const candidates = [
    path.join(__dirname, '..', '..', 'core', name),
    path.join(__dirname, '..', '..', '..', '..', 'src', 'core', name),
  ];
  for (const p of candidates) {
    try { require.resolve(p); return p; } catch (e) { /* try next */ }
  }
  throw new Error('TodoPro core module not found: ' + name);
}

const { runTool } = require(resolveCore('run-todopro-tool'));

// 工具工厂:pi.registerTool 注册 TodoPro 工具
// Pi 的工具定义 schema 用 typebox(TSchema)。此处用简化的 JSON schema 描述。
module.exports = function registerTodoProTool(pi) {
  pi.registerTool({
    name: 'TodoPro',
    description: 'Enhanced todo tool (full-replace semantics) with loop-exit guard and completion review. Use for multi-step/multi-file tasks instead of a plain todo list. Send the COMPLETE todo list each call (overwrites). Status: pending|in_progress|completed|paused|abandoned. Keep stable ids when modifying items. At most one in_progress at a time.',
    // Pi 工具参数 schema(简化:todos 数组)。实际 Pi 用 typebox,此处用通用 JSON schema。
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Complete todo list (full-replace). Each: { id?, content, status, priority? }',
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
      },
      required: ['todos'],
    },
    // 工具执行 handler
    handler: async (args, context) => {
      try {
        // runTool 从 stdin/argv 读,但插件内直接传参更干净。这里临时把 args.todos 写到
        // 一个临时变量供 runTool 读——但 runTool 用 readInput() 读 stdin。
        // 为复用,直接调核心 todoStore + md + sessionState。
        const todoStore = require(resolveCore('todo-store'));
        const todoMd = require(resolveCore('todo-md-mirror'));
        const sessionState = require(resolveCore('session-state'));
        const cwd = (context && context.cwd) || pi.cwd || process.cwd();
        const { data, oldTodos } = todoStore.replace(cwd, args.todos);
        todoMd.generate(cwd, data);
        sessionState.markTodoWritten(cwd);
        return {
          ok: true,
          oldTodos,
          todos: data.todos,
          session: data.session,
          note: 'todo.md 镜像已更新。继续干活;全部完成后会触发独立 review。',
        };
      } catch (e) {
        return { ok: false, error: e && e.message || String(e) };
      }
    },
  });
};
