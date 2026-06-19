// src/core/git-diff.js
// 平台无关:跑 git diff 供 review 子 agent 读取。非 git 仓库降级返回空。
// 仅用 Node 内置模块(零依赖)。
//
// spec: file-tracking / 文件记录与 git diff 互补
//   - git 仓库下:返回相对基线的实际改动文本
//   - 非 git 仓库:返回空字符串(子 agent 降级只读 touched-files.json)

const { execSync } = require('child_process');

// 检测是否 git 仓库
function isGitRepo(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir || process.cwd(),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch (e) {
    return false;
  }
}

// 获取 diff。默认与 HEAD 比(已暂存+未暂存)。
// 若没有 HEAD(全新仓库无提交),则列出所有未跟踪文件内容。
function getDiff(dir, opts) {
  const cwd = dir || process.cwd();
  const maxBytes = (opts && opts.maxBytes) || 200000; // 限制 200KB,防超大 diff
  if (!isGitRepo(cwd)) return '';

  try {
    // 先尝试 git diff HEAD(有提交时)
    let diff = '';
    let diffOverflowed = false;
    try {
      diff = execSync('git diff HEAD --no-color', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: maxBytes,
      }).toString('utf8');
    } catch (e) {
      // P3-3:区分两种失败。
      //   - 无 HEAD(ENOENT/exit code 128 "unknown revision"):降级到未跟踪文件,文案准确。
      //   - maxBuffer 超限(diff 太大):标记 overflowed,不降级到"未跟踪文件"(会误导),
      //     改返回截断提示。
      const msg = String(e.message || '');
      if (msg.includes('maxBuffer')) {
        diffOverflowed = true;
      }
      // git diff HEAD 在无 HEAD 时 exit code 非 0,stderr 含 "unknown revision" 或类似
      // 这种情况下 diff 保持空,走未跟踪文件分支(正确)
      diff = '';
    }

    if (diffOverflowed) {
      return '(git diff 输出超过 ' + maxBytes + ' 字节上限,已省略。请缩小改动范围或手动查看 git diff。)';
    }

    // 若 diff 为空,可能是全新仓库无 HEAD,或无改动。补充未跟踪文件清单。
    if (!diff) {
      try {
        const untracked = execSync('git ls-files --others --exclude-standard', {
          cwd,
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: maxBytes,
        }).toString('utf8').trim();
        if (untracked) {
          diff = '(未跟踪文件,无 git 历史 diff)\n' + untracked;
        }
      } catch (e) {
        // ignore
      }
    }

    // 截断保护
    if (diff.length > maxBytes) {
      diff = diff.slice(0, maxBytes) + '\n...[diff 已截断,超过 ' + maxBytes + ' 字节]';
    }
    return diff;
  } catch (e) {
    return '';
  }
}

// 获取当前 HEAD 短 hash(供 review 子 agent 标识基线)
function getHeadShort(dir) {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: dir || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

module.exports = { isGitRepo, getDiff, getHeadShort };
