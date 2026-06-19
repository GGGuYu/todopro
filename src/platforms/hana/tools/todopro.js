// src/platforms/hana/tools/todopro.js
// HanaAgent 插件:TodoPro 工具定义(通过 Pi SDK registerTool 注册)。
// 模型调用此工具实现全量替换 todo 或表达三个明确出口。
// 复用共享 runTool 逻辑(与 Claude Code/Codex 的 Bash 调用走同一套核心)。
//
// 安装:由 init.js 拷贝到 ${HANA_HOME}/plugins/todopro/tools/todopro.js
// 由 extensions/index.js 调用此模块注册工具(P0-H1 接线)。

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
// P0-H1:由 extensions/index.js 调用此函数完成接线。
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
    // P0-H2:handler 复用共享 runTool 逻辑,支持 todos 维护 + action 三出口。
    // 与 Claude Code/Codex 的 Bash 调用走同一套核心(run-todopro-tool)。
    handler: async (args, context) => {
      try {
        const todoStore = require(resolveCore('todo-store'));
        const todoMd = require(resolveCore('todo-md-mirror'));
        const sessionState = require(resolveCore('session-state'));
        const { EXIT_ACTIONS, actionToSessionPatch } = require(resolveCore('run-todopro-tool'));
        const cwd = (context && context.cwd) || pi.cwd || process.cwd();

        // 路径 A:明确出口(action)
        if (args && args.action) {
          const action = args.action;
          if (!EXIT_ACTIONS.has(action)) {
            return { ok: false, error: 'invalid action: ' + action };
          }
          const patch = actionToSessionPatch(action);
          if (patch) {
            const existing = todoStore.read(cwd);
            if (!existing) return { ok: false, error: 'no active TodoPro session to ' + action };
            const { data } = todoStore.replace(cwd, existing.todos, patch);
            todoMd.generate(cwd, data);
          }
          sessionState.markTodoWritten(cwd);
          return {
            ok: true,
            action,
            note: action === 'pause' ? '会话已暂停,监护停止。再次用 {todos:[...]} 维护即恢复。'
                : action === 'abandon' ? '会话已放弃,运行时文件将在退出时清理。'
                : '本轮知情停顿,已放行;下轮继续监护。',
          };
        }

        // 路径 B:维护出口(todos 全量替换)
        const todos = args && args.todos;
        if (!Array.isArray(todos)) {
          return { ok: false, error: 'input must have {todos:[...]} or {action:"..."}' };
        }
        const { data, oldTodos, warning } = todoStore.replace(cwd, todos);
        todoMd.generate(cwd, data);
        sessionState.markTodoWritten(cwd);
        // P0-H3:若会话之前是 paused,维护调用(传新 todos)自动恢复成 active
        if (data.session.status === 'paused') {
          const { data: d2 } = todoStore.replace(cwd, todos, { status: 'active' });
          todoMd.generate(cwd, d2);
        }
        const result = {
          ok: true,
          oldTodos,
          todos: data.todos,
          session: data.session,
          note: 'todo.md 镜像已更新。继续干活;全部完成后会触发独立 review。',
        };
        if (warning) result.warning = warning;
        return result;
      } catch (e) {
        return { ok: false, error: e && e.message || String(e) };
      }
    },
  });
};
