// src/core/run-todopro-tool.js
// 平台无关:TodoPro 工具入口的共享逻辑。
// 各平台适配层只需:读输入 → 调本模块 runTool → 拿结果 → 按平台格式输出。
// 仅用 Node 内置模块(零依赖)。
//
// 输入格式(JSON,经 stdin 或 argv):
//   维护出口(全量替换 todo):
//     { "todos": [ {id?, content, status, priority?}, ... ] }
//   三个明确出口:
//     { "action": "pause" }            // 暂停整个会话(长期,停止监护)
//     { "action": "abandon" }          // 放弃本次需求
//     { "action": "acknowledge_stall" } // 知情停顿(短期,下轮继续监护)
//
// 这四种都是"推进"(写操作),置 wrote_todo_this_round,放行本轮。
// pause/abandon 还会改 session.status,让后续 Stop 钩子走对应分支。

const fs = require('fs');
const todoStore = require('./todo-store');
const todoMd = require('./todo-md-mirror');
const sessionState = require('./session-state');

// 合法的明确出口 action(对应四选一的后三个;第一个"维护"走 todos 路径)
const EXIT_ACTIONS = new Set(['pause', 'abandon', 'acknowledge_stall']);

// action → session.status 映射
// acknowledge_stall 不改 session.status(它只是"本轮知情不推进",会话仍 active),
// 靠置 wrote_todo_this_round 放行本轮即可。pause/abandon 改 session.status。
function actionToSessionPatch(action) {
  if (action === 'pause') return { status: 'paused' };
  if (action === 'abandon') return { status: 'abandoned' };
  // acknowledge_stall:不改 session.status,靠推进标志放行
  return null;
}

// 读输入:优先 stdin,其次 argv[2]。返回解析后的对象。
function readInput() {
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) return JSON.parse(stdin);
  } catch (e) { /* fall through */ }
  const arg = process.argv[2];
  if (arg) {
    try { return JSON.parse(arg); }
    catch (e) { throw new Error('invalid JSON: ' + e.message); }
  }
  throw new Error('no input (pass via stdin or argv)');
}

// runTool(dir?, inputOverride?):处理一次 TodoPro 调用。
// inputOverride:可选,Hana 等直接传参的平台用它跳过 stdin/argv 读取。
//   Claude Code/Codex(经 Bash 调脚本)不传,走 readInput() 读 stdin。
//   Hana(registerTool handler)直接传 args 对象,避免 readInput 卡在 stdin。
// 返回 { ok, ... }。
function runTool(dir, inputOverride) {
  const input = (inputOverride !== undefined) ? inputOverride : readInput();

  // 路径 A:明确出口(action)
  if (input && typeof input === 'object' && input.action) {
    const action = input.action;
    if (!EXIT_ACTIONS.has(action)) {
      throw new Error('invalid action: ' + action + ' (allowed: ' + Array.from(EXIT_ACTIONS).join(', ') + ')');
    }
    // P2-H7:所有 action 都要求现存会话(含 acknowledge_stall)。
    // 无会话时调 action 没意义,且避免凭空创建 session-state.json 垃圾文件。
    const existing = todoStore.read(dir);
    if (!existing) {
      throw new Error('no active TodoPro session to ' + action);
    }
    const patch = actionToSessionPatch(action);
    if (patch) {
      // pause/abandon:改 session.status
      const { data } = todoStore.replace(dir, existing.todos, patch);
      todoMd.generate(dir, data);
    }
    // 所有 action(含 acknowledge_stall)都置推进标志 → 放行本轮
    sessionState.markTodoWritten(dir);
    return {
      ok: true,
      action,
      session: todoStore.read(dir) && todoStore.read(dir).session,
      note: action === 'pause' ? '会话已暂停,监护停止直到恢复。'
          : action === 'abandon' ? '会话已放弃,运行时文件将在退出时清理。'
          : '本轮知情停顿,已放行;下轮继续监护。',
    };
  }

  // 路径 B:维护出口(todos 全量替换)
  const todos = input && input.todos !== undefined ? input.todos : input;
  if (!Array.isArray(todos)) {
    throw new Error('input must be {todos:[...]} or {action:"pause|abandon|acknowledge_stall"} or a todos array');
  }
  const { data, oldTodos, warning } = todoStore.replace(dir, todos);
  todoMd.generate(dir, data);
  sessionState.markTodoWritten(dir);
  const result = {
    ok: true,
    oldTodos,
    todos: data.todos,
    session: data.session,
    note: 'todo.md 镜像已更新。继续干活;全部完成后会触发独立 review。',
  };
  if (warning) result.warning = warning;  // P1-4:静默删除提示
  return result;
}

module.exports = { runTool, readInput, EXIT_ACTIONS, actionToSessionPatch };
