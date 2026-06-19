// src/core/cleanup.js
// 平台无关:放行退出时清理本次需求的运行时文件,避免前后需求混乱。
// 仅用 Node 内置模块(零依赖)。
//
// spec: session-cleanup
//   - 删除:todo.json / todo.md / requirement-summary.md / touched-files.json / session-state.json
//   - 保留:review-subagent-prompt.md(预置静态,复用)
//   - 触发时机:放行退出(review 满足或熔断),非"全完成"时刻
//   - 删除不归档

const fs = require('fs');
const { paths } = require('./paths');

// 运行时文件清单(删除)。review-subagent-prompt.md 不在此列(保留)。
const RUNTIME_FILES = [
  'todoJson',
  'todoMd',
  'requirementSummary',
  'touchedFiles',
  'sessionState',
];

// 执行清理。返回 { deleted: [...], kept: [...] }。
function run(dir) {
  const p = paths(dir);
  const deleted = [];
  const kept = [];
  for (const key of RUNTIME_FILES) {
    const fp = p[key];
    try {
      fs.unlinkSync(fp);
      deleted.push(fp);
    } catch (e) {
      if (e.code === 'ENOENT') {
        // 文件不存在,跳过(可能本就没生成)
      } else {
        // 其他错误(权限等)记录但不中断清理
        kept.push(fp + ' (error: ' + e.code + ')');
      }
    }
  }
  // review-subagent-prompt.md 保留,不删
  kept.push(p.reviewSubagentPrompt + ' (保留:预置静态文件)');

  // 若 .todopro/ 目录空了(只剩 review-subagent-prompt.md 或全空),保留目录不删
  // (下次会话复用;init 时已创建)
  return { deleted, kept };
}

// 判断当前是否处于"应清理"状态(供适配层在放行分支确认)
// 实际清理由 decide-stop 的 doCleanup 标志触发,适配层调用 run()。
module.exports = { run, RUNTIME_FILES };
