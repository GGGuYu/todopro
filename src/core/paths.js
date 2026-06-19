// src/core/paths.js
// 平台无关:解析 .todopro/ 运行时目录下各文件路径。
// 所有核心模块通过此模块获取路径,避免硬编码。
// 仅用 Node 内置模块(零依赖)。
//
// 平台隔离:各平台适配器启动时调用 setPlatform('claude-code'|'codex'|'hana'),
// 此后 paths() 返回 .todopro/<platform>/ 子目录路径,防止不同平台状态互相污染。
// review-subagent-prompt.md 为共享只读文件,始终在 .todopro/ 根下。

const path = require('path');

let _platform = null;

// 平台适配器启动时调用,后续所有 paths() 都返回对应子目录。
// 也支持 TODOPRO_PLATFORM 环境变量(测试/内联脚本用)。
function setPlatform(platform) {
  _platform = platform;
}
if (!_platform && process.env.TODOPRO_PLATFORM) {
  _platform = process.env.TODOPRO_PLATFORM;
}

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
  const base = resolveTodoproDir(dir);
  const root = _platform ? path.join(base, _platform) : base;
  return {
    root,
    todoJson: path.join(root, 'todo.json'),
    todoMd: path.join(root, 'todo.md'),
    requirementSummary: path.join(root, 'requirement-summary.md'),
    reviewSubagentPrompt: path.join(base, 'review-subagent-prompt.md'), // 共享只读
    touchedFiles: path.join(root, 'touched-files.json'),
    sessionState: path.join(root, 'session-state.json'),
  };
}

module.exports = { paths, setPlatform, resolveTodoproDir };
