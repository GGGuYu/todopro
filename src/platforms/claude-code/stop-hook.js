#!/usr/bin/env node
// src/platforms/claude-code/stop-hook.js
// Claude Code Stop 钩子:Agent 准备退出循环时触发。
// 读 .todopro 状态 → 归一化事件 → decide-stop → 反归一化为 Claude Code 输出。
// 仅用 Node 内置模块(零依赖)。
//
// spec: loop-exit-guard / completion-review / session-cleanup
// design: 决策 7(Stop 决策表)
//
// 用法:在 .claude/settings.json 的 hooks.Stop 配置,command 指向此脚本。
// Claude Code 通过 stdin 传 JSON payload(含 cwd、session_id 等)。

const path = require('path');
const { readStdin, stopOutput, emit } = require('./util');
const todoStore = require('../../core/todo-store');
const sessionState = require('../../core/session-state');
const decideStop = require('../../core/decide-stop');
const cleanup = require('../../core/cleanup');

function main() {
  const payload = readStdin();
  // 用 payload 的 cwd(若没有则用 process.cwd())
  const dir = payload.cwd || process.cwd();

  // 1. 无活跃会话 → 立即放行(小任务零开销:只读一次文件)
  const data = todoStore.read(dir);
  if (!data) {
    emit({});
    return;
  }

  // 会话状态(从 todo.json 的 session 字段)
  const sessionStatus = (data.session && data.session.status) || 'active';
  // paused / abandoned / completed 视为非活跃监护
  if (sessionStatus !== 'active') {
    // abandoned 时清理;paused 不清理
    if (sessionStatus === 'abandoned') {
      cleanup.run(dir);
      sessionState.resetRoundFlags(dir);
    }
    emit({});
    return;
  }

  // 2. 归一化事件
  const st = sessionState.read(dir) || sessionState.DEFAULT_STATE;
  const event = {
    hasSession: true,
    sessionStatus,
    todos: data.todos || [],
    roundWroteTodo: !!st.wrote_todo_this_round,
    roundSubagentFired: !!st.subagent_fired_this_round,
  };

  // 3. 决策
  const decision = decideStop.decide(event, dir);

  // 4. 执行副作用(bump 计数 / mark review done / cleanup / reset flags)
  //    顺序:先 reset flags(可能写 session-state.json),再 cleanup(删 session-state.json)。
  //    若 cleanup 后再 reset 会把文件写回来。
  if (decision.bumpNudge) sessionState.bumpNudge(dir);
  if (decision.bumpReviewNudge) sessionState.bumpReviewNudge(dir);
  if (decision.markReviewDone) sessionState.markReviewDone(dir);
  if (decision.resetRoundFlags) sessionState.resetRoundFlags(dir);
  if (decision.doCleanup) cleanup.run(dir);

  // 5. 反归一化为 Claude Code 输出
  emit(stopOutput({
    block: decision.action === 'block',
    injectText: decision.injectText,
    reason: decision.reason,
  }));
}

try {
  main();
} catch (e) {
  // 任何异常都不阻断 Agent(钩子失败应降级为放行,不卡死用户)
  process.stderr.write('TodoPro stop-hook error: ' + (e && e.message || e) + '\n');
  emit({});
}
