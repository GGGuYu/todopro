#!/usr/bin/env node
// src/platforms/claude-code/todopro-tool.js
// TodoPro 工具入口(Claude Code 平台)。
//
// Claude Code 没有简单的"自定义工具"注册机制(MCP 太重)。
// 本工具通过 SKILL.md 引导模型用 Bash 调用此脚本,实现"全量替换 todo"语义。
//
// 用法(模型经 SKILL.md 引导调用):
//   echo '<todos JSON>' | node todopro-tool.js
//   或:node todopro-tool.js '<todos JSON>'
//
// 输入:todos 数组(JSON),每项 { id?, content, status, priority? }
// 输出(stdout JSON):{ ok: true, oldTodos: [...], todos: [...], session: {...} }
//   或 { ok: false, error: "..." }
//
// 内部:调核心 todo-store.replace(全量替换+校验+稳定id+updated_at回填),
//       生成 MD 镜像。PostToolUse 钩子(Bash matcher)会捕获本次调用置推进标志——
//       但 Bash matcher 无法区分"调 todopro-tool"和"普通 bash",
//       所以改用:本脚本内部直接调 sessionState.markTodoWritten(更可靠)。
//
// 仅用 Node 内置模块(零依赖)。

const fs = require('fs');
const todoStore = require('../../core/todo-store');
const todoMd = require('../../core/todo-md-mirror');
const sessionState = require('../../core/session-state');

function readInput() {
  // 优先 stdin
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) return JSON.parse(stdin);
  } catch (e) {
    // stdin 无内容或非 JSON,fall through 到参数
  }
  // 其次命令行参数
  const arg = process.argv[2];
  if (arg) {
    try {
      return JSON.parse(arg);
    } catch (e) {
      throw new Error('invalid todos JSON: ' + e.message);
    }
  }
  throw new Error('no todos input (pass via stdin or argv)');
}

function main() {
  const todos = readInput();
  if (!Array.isArray(todos)) {
    throw new Error('todos must be an array');
  }
  const { data, oldTodos } = todoStore.replace(null, todos);
  // 生成 MD 镜像
  todoMd.generate(null, data);
  // 置推进标志 + 归零 nudge(推进了)
  sessionState.markTodoWritten();

  process.stdout.write(JSON.stringify({
    ok: true,
    oldTodos,
    todos: data.todos,
    session: data.session,
    note: 'todo.md 镜像已更新。继续干活;全部完成后会触发独立 review。',
  }));
  process.exit(0);
}

try {
  main();
} catch (e) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: e && e.message || String(e),
  }));
  process.exit(0); // exit 0,错误通过 JSON 返回,不阻断
}
