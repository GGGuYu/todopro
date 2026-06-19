// src/core/session-state.js
// 平台无关:会话级状态维护。独立于 todo.json 的 session 字段,存更细粒度的
// 轮标志与计数(nudge_count / review_nudge_count / review 硬上限计数 /
// wrote_todo_this_round / subagent_fired_this_round)。
// 仅用 Node 内置模块(零依赖)。
//
// spec: loop-exit-guard / completion-review(熔断与复位)
//
// 设计:session-state.json 由钩子维护,模型不直接写。
//   - wrote_todo_this_round:本轮 PostToolUse(TodoPro)置 true,Stop 放行后复位
//   - subagent_fired_this_round:本轮 SubagentStop 置 true,Stop 放行后复位
//   - nudge_count:循环出口兜底连续未推进次数,推进时归零,达上限熔断
//   - review_nudge_count:review 引导连续未完成次数,review 后新增 todo 归零
//   - review_total_count:本会话累计 review 次数,硬上限 3

const fs = require('fs');
const { paths } = require('./paths');

const NUDGE_LIMIT = 2;          // 循环出口 nudge 最多 2 次,第 3 次交还用户
const REVIEW_NUDGE_LIMIT = 2;   // review nudge 最多 2 次
const REVIEW_HARD_LIMIT = 3;    // 单会话 review 硬上限

const DEFAULT_STATE = {
  wrote_todo_this_round: false,
  subagent_fired_this_round: false,
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

// write 支持两种签名:write(dir, state) 或 write(state)(dir 省略时用 env/默认)
function write(dir, state) {
  // 单参数调用:write(state)
  if (state === undefined && dir !== null && typeof dir === 'object') {
    state = dir;
    dir = null;
  }
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

// PostToolUse(编辑类工具)只记文件,不动状态——见 touched-files.js

// SubagentStop:置本轮子 agent 标志
function markSubagentFired(dir) {
  const s = ensure(dir);
  s.subagent_fired_this_round = true;
  write(dir, s);
  return s;
}

// review 真正完成(子 agent 跑完且主 agent 收到结果):累计 + 复位 review_nudge
function markReviewDone(dir) {
  const s = ensure(dir);
  s.review_total_count += 1;
  s.review_nudge_count = 0;
  write(dir, s);
  return s;
}

// review nudge 一次(主 agent 糊弄不起子 agent,或 review 未完成)
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

// review 后主 agent 新增 todo(去修 review 发现的问题):给新一轮 review 机会
function resetReviewNudge(dir) {
  const s = ensure(dir);
  s.review_nudge_count = 0;
  write(dir, s);
  return s;
}

// Stop 放行后复位轮标志(为下一轮准备)
function resetRoundFlags(dir) {
  const s = ensure(dir);
  s.wrote_todo_this_round = false;
  s.subagent_fired_this_round = false;
  write(dir, s);
  return s;
}

module.exports = {
  read,
  write,
  ensure,
  markTodoWritten,
  markSubagentFired,
  markReviewDone,
  bumpReviewNudge,
  bumpNudge,
  resetReviewNudge,
  resetRoundFlags,
  NUDGE_LIMIT,
  REVIEW_NUDGE_LIMIT,
  REVIEW_HARD_LIMIT,
  DEFAULT_STATE,
};
