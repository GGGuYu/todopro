// src/core/session-state.js
// 平台无关:会话级状态维护。独立于 todo.json 的 session 字段,存更细粒度的
// 轮标志与计数(nudge_count / review_nudge_count / review 硬上限计数 /
// wrote_todo_this_round / subagent_fired_this_round / review_pending / review_subagent_fired)。
// 仅用 Node 内置模块(零依赖)。
//
// spec: loop-exit-guard / completion-review(熔断与复位)
//
// P1-2 修复:区分"任何子 agent"和"review 子 agent"。
//   review_pending:decide-stop 返回 review-nudge 时置 true,标记"现在起子 agent 应该是 review"。
//   review_subagent_fired:SubagentStop 时若 review_pending=true 才置 true(认为是 review 子 agent)。
//   review 完成/熔断时复位 review_pending。
//   decide-stop 用 review_subagent_fired(而非 subagent_fired_this_round)判断 review 是否完成。

const fs = require('fs');
const { paths } = require('./paths');
const NUDGE_LIMIT = 2;          // 循环出口 nudge 最多 2 次,第 3 次交还用户
const REVIEW_NUDGE_LIMIT = 2;   // review nudge 最多 2 次
const REVIEW_HARD_LIMIT = 3;    // 单会话 review 硬上限

const DEFAULT_STATE = {
  wrote_todo_this_round: false,
  subagent_fired_this_round: false,   // 本轮起了任何子 agent(仅统计用,不直接决定 review)
  review_pending: false,              // P1-2:review 引导已注入,现在起的子 agent 应是 review
  review_subagent_fired: false,       // P1-2:本轮起了 review 子 agent(由 SubagentStop 在 review_pending 时置)
  nudge_count: 0,
  review_nudge_count: 0,
  review_total_count: 0,
};

function read(dir) {
  const p = paths(dir);
  try {
    const raw = fs.readFileSync(p.sessionState, 'utf8');
    return Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// P3-1 修复:write 显式两参数 (dir, state)。不再支持单参数隐式重载(坏味道)。
// 调用方必须传 dir(可传 null/undefined 用默认)和 state。
function write(dir, state) {
  const p = paths(dir);
  fs.mkdirSync(p.root, { recursive: true });
  fs.writeFileSync(p.sessionState, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function ensure(dir) {
  let s = read(dir);
  if (!s) {
    s = Object.assign({}, DEFAULT_STATE);
    write(dir, s);
  }
  return s;
}

// PostToolUse(TodoPro 工具)调用:置本轮推进标志,归零 nudge_count(推进了重新给机会)
function markTodoWritten(dir) {
  const s = ensure(dir);
  s.wrote_todo_this_round = true;
  s.nudge_count = 0;
  write(dir, s);
  return s;
}

// SubagentStop:置本轮子 agent 标志。
// P1-2 + 残留修复:若 review_pending=true,还需检查 requirement-summary.md 是否存在,
//   存在才置 review_subagent_fired(认为主 agent 走了 review 流程:先写需求总结再起子 agent)。
//   没写 summary 就起子 agent(跳步/探索)→ 不算 review,继续 nudge。
//   这比"任何子 agent 都算"更可靠:review 流程要求先写 requirement-summary.md,
//   主 agent 若没写就起子 agent,显然不是在跑 review。
function markSubagentFired(dir) {
  const s = ensure(dir);
  s.subagent_fired_this_round = true;
  if (s.review_pending) {
    // 检查 requirement-summary.md 是否存在(P1-2 残留真修复)
    const p = paths(dir);
    let summaryExists = false;
    try { fs.accessSync(p.requirementSummary); summaryExists = true; } catch (e) { /* 不存在 */ }
    if (summaryExists) {
      s.review_subagent_fired = true;
    }
    // 若 summary 不存在,不置 review_subagent_fired——不算 review 完成
  }
  write(dir, s);
  return s;
}

// P1-2:decide-stop 返回 review-nudge 时调,标记"现在起的子 agent 应是 review"
function markReviewPending(dir) {
  const s = ensure(dir);
  s.review_pending = true;
  s.review_subagent_fired = false;
  write(dir, s);
  return s;
}

// review 真正完成(子 agent 跑了):累计 + 复位 review_nudge + 复位 review_pending
function markReviewDone(dir) {
  const s = ensure(dir);
  s.review_total_count += 1;
  s.review_nudge_count = 0;
  s.review_pending = false;
  s.review_subagent_fired = false;
  write(dir, s);
  return s;
}

// review nudge 一次(主 agent 糊弄不起 review 子 agent,或 review 未完成)
function bumpReviewNudge(dir) {
  const s = ensure(dir);
  s.review_nudge_count += 1;
  write(dir, s);
  return s;
}

// 循环出口 nudge 一次(本轮没推进)
function bumpNudge(dir) {
  const s = ensure(dir);
  s.nudge_count += 1;
  write(dir, s);
  return s;
}

// Stop 放行后复位轮标志(为下一轮准备)。
// P1-2:复位 review_pending(下轮若需 review 会重新 markReviewPending)。
function resetRoundFlags(dir) {
  const s = ensure(dir);
  s.wrote_todo_this_round = false;
  s.subagent_fired_this_round = false;
  s.review_subagent_fired = false;
  // review_pending 不在这里复位:review 引导注入后,主 agent 可能跨多轮才起子 agent。
  // 只在 markReviewDone(完成)或 review 熔断时复位。但若本轮放行且非 review 路径,
  // review_pending 应该是 false(否则是遗留)。防御性复位。
  s.review_pending = false;
  write(dir, s);
  return s;
}

module.exports = {
  read,
  write,
  ensure,
  markTodoWritten,
  markSubagentFired,
  markReviewPending,
  markReviewDone,
  bumpReviewNudge,
  bumpNudge,
  resetRoundFlags,
  NUDGE_LIMIT,
  REVIEW_NUDGE_LIMIT,
  REVIEW_HARD_LIMIT,
  DEFAULT_STATE,
};
