// src/core/paths.js
// 平台无关:解析 .todopro/ 运行时目录下各文件路径。
// 所有核心模块通过此模块获取路径,避免硬编码。
// 仅用 Node 内置模块(零依赖)。

const path = require('path');

// 解析 .todopro/ 目录。优先用环境变量 TODOPRO_DIR(测试/自定义用),
// 否则默认为 项目根/.todopro/。项目根 = 从 cwd 向上找 package.json 或用 cwd。
function resolveTodoproDir(startDir) {
  if (process.env.TODOPRO_DIR) {
    return path.resolve(process.env.TODOPRO_DIR);
  }
  const base = startDir || process.cwd();
  return path.join(base, '.todopro');
}

function paths(dir) {
  const root = resolveTodoproDir(dir);
  return {
    root,
    todoJson: path.join(root, 'todo.json'),
    todoMd: path.join(root, 'todo.md'),
    requirementSummary: path.join(root, 'requirement-summary.md'),
    reviewSubagentPrompt: path.join(root, 'review-subagent-prompt.md'),
    touchedFiles: path.join(root, 'touched-files.json'),
    sessionState: path.join(root, 'session-state.json'),
  };
}

module.exports = { paths, resolveTodoproDir };
