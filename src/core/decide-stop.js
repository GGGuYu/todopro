// src/core/decide-stop.js
// 平台无关:Stop 钩子决策表。整套机制的"大脑"。
// 吃归一化事件,吐统一决策。纯函数,不直接做 IO(副作用由适配层执行)。
// 仅用 Node 内置模块(零依赖)。
//
// spec: loop-exit-guard / completion-review(熔断与硬上限)
// design: 决策 7(防死循环状态机)
//
// 决策表(每类阻断带保险丝,烧断必放行;review 硬上限):
// ┌──────────────────────┬──────────────┬───────────────┬─────────────────────────────┐
// │ 会话状态             │ 本轮推进?    │ 保险丝        │ 动作                        │
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 无会话/paused/       │  —           │  —            │ 放行                        │
// │ abandoned/completed  │              │               │                             │
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 有 pending           │  推进了       │  —            │ 放行                        │
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 有 pending           │  没推进       │ nudge<2       │ 阻断+注入四选一; nudge++   │
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 有 pending           │  没推进       │ nudge≥2       │ 放行+注入"交还用户"(丝断)│
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 全完成,未 review     │ (review到期) │ rv_nudge<2    │ 阻断+注入 review 提示; ++  │
// │   且 review_total<3  │              │               │                             │
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 全完成,未 review     │ (review到期) │ rv_nudge≥2    │ 放行+注入"review 跳过"     │
// │   且 review_total<3  │              │  或 硬上限≥3  │  (丝断/硬上限)            │
// ├──────────────────────┼──────────────┼───────────────┼─────────────────────────────┤
// │ 全完成,已 review     │  —           │  —            │ 放行                        │
// └──────────────────────┴──────────────┴───────────────┴─────────────────────────────┘

const sessionState = require('./session-state');
const prompts = require('./prompts');

// 归一化事件(适配层喂入):
//   {
//     hasSession: bool,            // 是否有活跃 TodoPro 会话
//     sessionStatus: 'active'|'paused'|'abandoned'|'completed',
//     todos: [...],                // 当前 todo 列表
//     roundWroteTodo: bool,        // 本轮是否推进(发生 TodoPro 写操作)
//     roundSubagentFired: bool,    // 本轮是否起过子 agent
//   }
//
// 统一决策(吐给适配层):
//   {
//     action: 'allow' | 'block',
//     injectText: string | null,   // 注入文本(additionalContext / continuation_fragments / afterUser)
//     bumpNudge: bool,             // 适配层据此调 sessionState.bumpNudge
//     bumpReviewNudge: bool,       // 适配层据此调 bumpReviewNudge
//     markReviewDone: bool,        // review 真完成时(子 agent 跑了)累计
//     doCleanup: bool,             // 放行退出时清理运行时文件
//     resetRoundFlags: bool,       // 放行后复位轮标志(为下一轮准备)
//     reason: string,              // 决策原因(日志/调试用)
//   }

function decide(event, dir) {
  const e = event || {};

  // 1. 无活跃会话 → 放行,不动状态
  if (!e.hasSession) {
    return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
             markReviewDone: false, doCleanup: false, resetRoundFlags: false,
             reason: 'no-active-session' };
  }

  // 2. 会话已 paused / abandoned → 放行(pause/abandon 是合法出口)
  //    abandoned 时清理(需求撤销);paused 不清理(可能恢复)
  if (e.sessionStatus === 'abandoned') {
    return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
             markReviewDone: false, doCleanup: true, resetRoundFlags: true,
             reason: 'session-abandoned' };
  }
  if (e.sessionStatus === 'paused') {
    return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
             markReviewDone: false, doCleanup: false, resetRoundFlags: true,
             reason: 'session-paused' };
  }

  // acknowledge_stall 不是会话级状态,是轮级意图(经 action 调用,不改 session.status)。
  // 若因故落盘成 session.status,防御性当作 active 处理(不僵死),下轮继续监护。
  // 正常路径下 acknowledge_stall 不会到这里(actionToSessionPatch 返回 null,不改 session.status)。
  const sessionStatus = (e.sessionStatus === 'acknowledge_stall') ? 'active' : e.sessionStatus;

  // 读状态(计数器/标志)
  const st = sessionState.read(dir) || sessionState.DEFAULT_STATE;

  // 3. 有 pending 项(还没全完成)
  const hasPendingTodos = e.todos && e.todos.some(t => t.status === 'pending' || t.status === 'in_progress');
  if (hasPendingTodos) {
    if (e.roundWroteTodo) {
      // 本轮推进了 → 放行(nudge 已在 markTodoWritten 时归零)
      return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
               markReviewDone: false, doCleanup: false, resetRoundFlags: true,
               reason: 'progressed-this-round' };
    }
    // 本轮没推进
    if (st.nudge_count < sessionState.NUDGE_LIMIT) {
      // 阻断,注入四选一
      return { action: 'block', injectText: prompts.nudgeFourWay(st.nudge_count + 1),
               bumpNudge: true, bumpReviewNudge: false, markReviewDone: false,
               doCleanup: false, resetRoundFlags: false,
               reason: 'no-progress-nudge-' + (st.nudge_count + 1) };
    }
    // 熔断:交还用户
    return { action: 'allow', injectText: prompts.nudgeCircuitBreak(),
             bumpNudge: false, bumpReviewNudge: false, markReviewDone: false,
             doCleanup: true, resetRoundFlags: true,
             reason: 'nudge-circuit-break' };
  }

  // 4. 全部完成(无 pending)
  const allCompleted = e.todos && e.todos.length > 0 &&
    e.todos.every(t => t.status === 'completed');
  if (!allCompleted) {
    // 既无 pending 也不全完成:可能是空 todos(P1-3)或全 paused/abandoned 单项。
    // 空 todos + active → 僵尸会话,清理(P1-3 修复)。否则放行不干预。
    if (e.todos && e.todos.length === 0 && sessionStatus === 'active') {
      return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
               markReviewDone: false, doCleanup: true, resetRoundFlags: true,
               reason: 'empty-session-cleanup' };
    }
    return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
             markReviewDone: false, doCleanup: false, resetRoundFlags: true,
             reason: 'no-pending-not-all-completed' };
  }

  // 全完成:判断 review
  // P0-1 修复:review_done 标志跟踪"本会话已 review 过"。
  //   review-completed 不再立即 cleanup(否则 review_total_count 落不了盘,硬上限形同虚设)。
  //   改为:review 完成 → 标记 review_done,放行但保留 session-state。
  //   下一轮 Stop:若 todos 仍全完成 + review_done → 真正退出,cleanup。
  //   若 agent 新增 todo 修 review 问题 → review_done 复位,重新走 review,review_total_count 累加。
  if (st.review_done) {
    // 已 review 过,todos 仍全完成 → 真正退出,cleanup
    return { action: 'allow', injectText: null, bumpNudge: false, bumpReviewNudge: false,
             markReviewDone: false, doCleanup: true, resetRoundFlags: true,
             reason: 'reviewed-exit' };
  }

  // review_total 硬上限(现在能触发了,因为 review_total_count 不再被 cleanup 清零)
  if (st.review_total_count >= sessionState.REVIEW_HARD_LIMIT) {
    return { action: 'allow', injectText: prompts.reviewHardLimit(),
             bumpNudge: false, bumpReviewNudge: false, markReviewDone: false,
             doCleanup: true, resetRoundFlags: true,
             reason: 'review-hard-limit' };
  }

  // P1-2 修复:只有"本轮起了 review 子 agent(requirement-summary 已写)"才算 review 完成。
  if (st.review_subagent_fired) {
    // P0-1:review 完成但不 cleanup,保留 review_total_count 供硬上限判断。
    //   markReviewDone 置 review_done=true,下一轮 Stop 走 reviewed-exit 分支才 cleanup。
    return { action: 'allow', injectText: prompts.reviewDoneAck(),
             bumpNudge: false, bumpReviewNudge: false, markReviewDone: true,
             doCleanup: false, resetRoundFlags: true,
             reason: 'review-completed' };
  }

  // 本轮没起 review 子 agent(review 到期但主 agent 糊弄/还没起,或起了非review子agent)
  if (st.review_nudge_count < sessionState.REVIEW_NUDGE_LIMIT) {
    // 阻断,注入 review 引导。markReviewPending 标记"现在起的子 agent 应是 review"
    return { action: 'block', injectText: prompts.reviewGuide(st.review_nudge_count + 1),
             bumpNudge: false, bumpReviewNudge: true, markReviewDone: false,
             markReviewPending: true,
             doCleanup: false, resetRoundFlags: false,
             reason: 'review-nudge-' + (st.review_nudge_count + 1) };
  }
  // review 熔断:跳过
  return { action: 'allow', injectText: prompts.reviewCircuitBreak(),
           bumpNudge: false, bumpReviewNudge: false, markReviewDone: false,
           doCleanup: true, resetRoundFlags: true,
           reason: 'review-circuit-break' };
}

module.exports = { decide };
