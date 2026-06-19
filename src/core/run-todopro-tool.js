// src/core/run-todopro-tool.js
// 平台无关:TodoPro 工具入口的共享逻辑。
// 各平台适配层只需:读输入 → 调本模块 runTool → 拿结果 → 按平台格式输出。
// 仅用 Node 内置模块(零依赖)。

const fs = require('fs');
const todoStore = require('./todo-store');
const todoMd = require('./todo-md-mirror');
const sessionState = require('./session-state');

// 读输入:优先 stdin,其次 argv[2]。返回 todos 数组。
function readInput() {
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) return JSON.parse(stdin);
  } catch (e) { /* fall through */ }
  const arg = process.argv[2];
  if (arg) {
    try { return JSON.parse(arg); }
    catch (e) { throw new Error('invalid todos JSON: ' + e.message); }
  }
  throw new Error('no todos input (pass via stdin or argv)');
}

// runTool(dir?):全量替换 + MD 镜像 + 置推进标志。返回 { ok, oldTodos, todos, session, note }。
function runTool(dir) {
  const todos = readInput();
  if (!Array.isArray(todos)) throw new Error('todos must be an array');
  const { data, oldTodos } = todoStore.replace(dir, todos);
  todoMd.generate(dir, data);
  sessionState.markTodoWritten(dir);
  return {
    ok: true,
    oldTodos,
    todos: data.todos,
    session: data.session,
    note: 'todo.md 镜像已更新。继续干活;全部完成后会触发独立 review。',
  };
}

module.exports = { runTool, readInput };
