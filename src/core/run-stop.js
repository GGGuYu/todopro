// src/core/run-stop.js
// 平台无关:Stop 钩子的共享执行逻辑。
// 各平台适配层只需:读平台 payload → 调本模块 runStop → 拿 decision → 按平台格式输出。
// 这样三平台的 Stop 逻辑只写一份,避免重复。
// 仅用 Node 内置模块(零依赖)。
//
// 返回 decision 对象(同 decide-stop 的输出),适配层据此反归一化。

const todoStore = require('./todo-store');
const sessionState = require('./session-state');
const decideStop = require('./decide-stop');
const cleanup = require('./cleanup');

// runStop(dir, toolPath?):读状态 → 归一化事件 → decide-stop → 执行副作用 → 返回 decision
// toolPath:可选,本平台 todopro-tool.js 的实际路径,用于替换提示词里的 <todopro-tool> 占位。
//           适配层传入,使提示词给模型可用的命令(不写死平台路径)。
function runStop(dir, toolPath) {
  const data = todoStore.read(dir);
  if (!data) {
    return { action: 'allow', injectText: null, reason: 'no-active-session', _noop: true };
  }

  const sessionStatus = (data.session && data.session.status) || 'active';
  if (sessionStatus !== 'active') {
    // abandoned → 清理;paused → 不清理
    if (sessionStatus === 'abandoned') {
      sessionState.resetRoundFlags(dir);
      cleanup.run(dir);
    }
    return { action: 'allow', injectText: null, reason: 'session-' + sessionStatus, _noop: true };
  }

  const st = sessionState.read(dir) || sessionState.DEFAULT_STATE;
  const event = {
    hasSession: true,
    sessionStatus,
    todos: data.todos || [],
    roundWroteTodo: !!st.wrote_todo_this_round,
    roundSubagentFired: !!st.subagent_fired_this_round,
  };

  const decision = decideStop.decide(event, dir);

  // 替换提示词里的 <todopro-tool> 占位为实际脚本路径
  if (decision.injectText && toolPath) {
    decision.injectText = decision.injectText.replace(/<todopro-tool>/g, toolPath);
  }

  // 执行副作用(顺序:先 reset flags 再 cleanup,避免 cleanup 后又写回)
  if (decision.bumpNudge) sessionState.bumpNudge(dir);
  if (decision.bumpReviewNudge) sessionState.bumpReviewNudge(dir);
  if (decision.markReviewDone) sessionState.markReviewDone(dir);
  if (decision.resetRoundFlags) sessionState.resetRoundFlags(dir);
  if (decision.doCleanup) cleanup.run(dir);

  return decision;
}

module.exports = { runStop };
