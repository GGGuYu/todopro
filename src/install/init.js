#!/usr/bin/env node
// src/install/init.js
// TodoPro init 引导程序:全局安装 + 各工具 hook 配置 + SKILL.md。
// 仅用 Node 内置模块(零依赖)。
//
// 架构(全局安装 + 软链/hook 绝对路径):
//   1. installGlobal: 把 src/ + SKILL.md + review-subagent-prompt.md 复制到 ~/.agents/skills/todopro/(全局自包含,标准 skill 结构)
//   2. 各工具安装: hook command 用全局绝对路径(不依赖仓库在项目内)
//      - Claude Code: merge hooks 进 .claude/settings.json,command 指向全局
//      - Codex: append [hooks] 到 config.toml,command 指向全局
//      - Hana: 插件 extensions/tools/core 软链到全局(回退复制)
//   3. SKILL.md 复制到工具技能目录;review-subagent-prompt.md 预置到项目 .todopro/
//
// 用法:
//   node src/install/init.js                       # 交互式选择平台(推荐)
//   node src/install/init.js --platform claude-code # 静默安装指定平台
//   node src/install/init.js --platform all        # 安装全部平台
//   node src/install/init.js --update              # 只刷新全局安装(不重配 hook)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const readline = require('readline');

// ─── 工具函数 ───
function info(msg) { console.log('  ' + msg); }
function ok(msg) { console.log('  ✓ ' + msg); }
function warn(msg) { console.log('  ! ' + msg); }
function err(msg) { console.error('  ✗ ' + msg); }

// ─── ANSI / 终端工具 ───
const ANSI = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  cursorUp: (n) => `\x1b[${n}A`,
  cursorShow: '\x1b[?25h',
  cursorHide: '\x1b[?25l',
  clearLine: '\x1b[K',
};

// ─── 路径常量 ───
// 全局安装目录(跨工具标准位置)
const GLOBAL_DIR = path.join(os.homedir(), '.agents', 'skills', 'todopro');

function parseArgs(argv) {
  const args = { platform: null, dir: process.cwd(), update: false, uninstall: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--platform' && argv[i + 1]) { args.platform = argv[++i]; }
    else if (argv[i] === '--dir' && argv[i + 1]) { args.dir = argv[++i]; }
    else if (argv[i] === '--update') { args.update = true; }
    else if (argv[i] === '--uninstall') { args.uninstall = true; }
    else if (argv[i] === '--help' || argv[i] === '-h') { args.help = true; }
  }
  return args;
}

// TodoPro 仓库根(此 init.js 所在的 src/install/ 往上两级)
function todoproRoot() {
  return path.resolve(__dirname, '..', '..');
}

// 递归复制目录(仅 .js/.json/.md 文件,跳过 ._ macOS 残留)
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('._')) continue; // 跳过 macOS AppleDouble
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (/\.(js|json|md)$/.test(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
    // 当前所有源文件均匹配 .js/.json/.md；若将来新增 .toml/.yaml 等需扩展此正则。
  }
}

// 创建软链,失败则回退到复制
function symlinkOrCopy(target, linkPath) {
  try {
    // 若已存在(文件/软链/目录)先删
    try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.symlinkSync(target, linkPath);
    return 'symlink';
  } catch (e) {
    // 软链失败(权限/平台),回退复制
    try {
      if (fs.statSync(target).isDirectory()) {
        copyDir(target, linkPath);
      } else {
        fs.copyFileSync(target, linkPath);
      }
      return 'copy';
    } catch (e2) {
      warn('软链和复制都失败: ' + linkPath + ' → ' + target + ': ' + e2.message);
      return 'failed';
    }
  }
}

// 生成 .todopro/README.md(运行时目录说明)。三平台共用。
function writeTodoproReadme(todoproDir) {
  const content = [
    '# `.todopro/` 运行时目录',
    '',
    '本目录由 TodoPro 在监护期间生成,会话放行退出时自动清理(除预置静态文件)。',
    '源文件在 `skills/todopro/`,init 时拷贝/生成到此。',
    '',
    '| 文件 | 谁写 | 职责 | 清理时 |',
    '|---|---|---|---|',
    '| `todo.json` | 模型(经 TodoPro 工具全量替换)+ 钩子回填 updated_at | 唯一真相源。完整 todo 列表 + session.status | 删 |',
    '| `todo.md` | 钩子自动生成 | todo.json 的只读 Markdown 镜像 | 删 |',
    '| `requirement-summary.md` | 主 Agent(review 时写) | 详细需求总结,不写实现方法。复写覆盖 | 删 |',
    '| `review-subagent-prompt.md` | 预置(init 拷贝) | review 子 agent 审查规则。复用不删 | **保留** |',
    '| `touched-files.json` | PostToolUse 钩子自动 | 监护期间被编辑类工具碰过的文件路径 | 删 |',
    '| `session-state.json` | 钩子维护 | 会话级状态(计数、轮标志、review_done) | 删 |',
    '',
    '> 此文件由 `init` 自动生成,不入库(.gitignore 忽略 .todopro/* 但保留 README)。',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(todoproDir, 'README.md'), content, 'utf8');
}

// ─── 全局安装:把 src/ + skills/ 复制到 ~/.agents/skills/todopro/ ───
function installGlobal(root) {
  info('全局安装到 ' + GLOBAL_DIR + '...');
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });

  // 复制 src/core/
  copyDir(path.join(root, 'src/core'), path.join(GLOBAL_DIR, 'src/core'));
  // 复制 src/platforms/claude-code/
  copyDir(path.join(root, 'src/platforms/claude-code'), path.join(GLOBAL_DIR, 'src/platforms/claude-code'));
  // 复制 src/platforms/codex/
  copyDir(path.join(root, 'src/platforms/codex'), path.join(GLOBAL_DIR, 'src/platforms/codex'));
  // 复制 src/platforms/hana/
  copyDir(path.join(root, 'src/platforms/hana'), path.join(GLOBAL_DIR, 'src/platforms/hana'));
  // 复制 src/install/init.js(删掉仓库后仍需 --update / --uninstall)
  fs.mkdirSync(path.join(GLOBAL_DIR, 'src/install'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/install/init.js'), path.join(GLOBAL_DIR, 'src/install/init.js'));
  // 复制 SKILL.md + review-subagent-prompt.md 到全局目录根(标准 skill 结构:~/.agents/skills/todopro/SKILL.md)
  fs.copyFileSync(path.join(root, 'skills/todopro/SKILL.md'), path.join(GLOBAL_DIR, 'SKILL.md'));
  fs.copyFileSync(path.join(root, 'skills/todopro/review-subagent-prompt.md'), path.join(GLOBAL_DIR, 'review-subagent-prompt.md'));

  // 清理旧版嵌套结构(之前 bug 留下的 ~/.agents/skills/todopro/skills/todopro/...)
  const oldSkillsDir = path.join(GLOBAL_DIR, 'skills');
  if (fs.existsSync(oldSkillsDir)) { removeDir(oldSkillsDir); }

  // 复制 bin/todopro CLI 入口
  fs.mkdirSync(path.join(GLOBAL_DIR, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(root, 'bin/todopro'), path.join(GLOBAL_DIR, 'bin/todopro'));
  fs.chmodSync(path.join(GLOBAL_DIR, 'bin/todopro'), 0o755);

  ok('全局安装完成(src/ + skills/ + bin/ 已复制到 ' + GLOBAL_DIR + ')');
  info('将以下行添加到 ~/.zshrc 或 ~/.bashrc 即可全局使用 todopro 命令:');
  console.log('  ' + ANSI.cyan + 'export PATH="' + path.join(GLOBAL_DIR, 'bin') + ':$PATH"' + ANSI.reset);
  return GLOBAL_DIR;
}

// ─── 平台检测 ───
function detectPlatforms(dir) {
  const found = [];
  if (fs.existsSync(path.join(dir, '.claude'))) found.push('claude-code');
  if (fs.existsSync(path.join(os.homedir(), '.codex', 'config.toml')) ||
      fs.existsSync(path.join(dir, 'config.toml'))) found.push('codex');
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), '.openhanako');
  if (fs.existsSync(path.join(hanaHome, 'plugins'))) found.push('hana');
  return found;
}

const PLATFORM_LABELS = {
  'claude-code': 'Claude Code',
  'codex':       'Codex',
  'hana':        'HanaAgent',
};

function checkNode() {
  try {
    const v = execSync('node --version', { encoding: 'utf8' }).trim();
    ok('Node ' + v + ' 已安装');
    return true;
  } catch (e) {
    err('未检测到 Node。TodoPro 需要 Node >= 18。请先安装 Node。');
    return false;
  }
}

// ─── Claude Code 安装(用全局绝对路径)───
function installClaudeCode(dir, globalDir) {
  info('安装到 Claude Code...');
  const claudeDir = path.join(dir, '.claude');

  // 1. 确保 .claude/ 存在
  fs.mkdirSync(claudeDir, { recursive: true });

  // 2. merge hooks 进 .claude/settings.json
  //    hook command 用全局绝对路径(不依赖仓库在项目内,不依赖 ${CLAUDE_PROJECT_DIR})
  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
    catch (e) { warn('现有 settings.json 解析失败,将备份后重建'); fs.renameSync(settingsPath, settingsPath + '.bak'); }
  }
  settings.hooks = settings.hooks || {};

  // 构建 hooks 模板(command 用全局绝对路径)
  const ccDir = path.join(globalDir, 'src/platforms/claude-code');
  const hookCmd = (script) => 'node "' + path.join(ccDir, script) + '"';
  const hooksTpl = {
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: hookCmd('stop-hook.js') }] }],
    PostToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: hookCmd('post-tool-use.js') }] },
      { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: hookCmd('post-tool-use.js') }] },
    ],
    SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: hookCmd('subagent-stop.js') }] }],
  };

  // merge:每个事件类型合并 matcher 数组(去重:同 matcher+command 跳过)
  for (const evt of Object.keys(hooksTpl)) {
    settings.hooks[evt] = settings.hooks[evt] || [];
    for (const entry of hooksTpl[evt]) {
      const exists = settings.hooks[evt].some(e =>
        e.matcher === entry.matcher && e.hooks && e.hooks.some(h => h.command === entry.hooks[0].command));
      if (!exists) settings.hooks[evt].push(entry);
    }
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  ok('hooks 已 merge 进 ' + path.relative(dir, settingsPath) + '(command 指向全局 ' + GLOBAL_DIR + ')');

  // 3. 放 SKILL.md 到 .claude/skills/todopro/(复制,不软链——小文件且 Claude Code 可能不跟随软链)
  const skillDir = path.join(claudeDir, 'skills', 'todopro');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(globalDir, 'SKILL.md'), path.join(skillDir, 'SKILL.md'));
  ok('SKILL.md 已放到 ' + path.relative(dir, skillDir));

  // 4. 预置 review-subagent-prompt.md + README.md 到项目 .todopro/
  const todoproDir = path.join(dir, '.todopro');
  fs.mkdirSync(todoproDir, { recursive: true });
  fs.copyFileSync(path.join(globalDir, 'review-subagent-prompt.md'),
           path.join(todoproDir, 'review-subagent-prompt.md'));
  ok('review-subagent-prompt.md 已预置到 .todopro/');
  writeTodoproReadme(todoproDir);

  console.log();
  ok('Claude Code 安装完成。');
  info('请重启 Claude Code(或重载会话)以使 hooks 生效。');
  info('之后模型在做多步/多文件任务时可自主调用 TodoPro(见 SKILL.md)。');
  info('hooks 指向全局 ' + GLOBAL_DIR + ',在任何项目目录都生效。');
}

// ─── Codex 安装(用全局绝对路径)───
function installCodex(dir, globalDir) {
  info('安装到 Codex...');
  const codexDir = path.join(os.homedir(), '.codex');
  const configPath = fs.existsSync(path.join(dir, 'config.toml'))
    ? path.join(dir, 'config.toml')
    : path.join(codexDir, 'config.toml');

  // TOML hooks(command 用全局绝对路径)
  function tomlLitStr(s) {
    if (s.indexOf("'") === -1) return "'" + s + "'";
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function codexHookEntry(hookType, scriptName, matcher) {
    const scriptPath = path.join(globalDir, 'src/platforms/codex', scriptName);
    const lines = ['[[hooks.' + hookType + ']]'];
    if (matcher) lines.push('matcher = ' + tomlLitStr(matcher));
    lines.push('command = ["node", ' + tomlLitStr(scriptPath) + ']');
    return lines.join('\n');
  }
  const codexHooksToml = [
    '',
    '# --- TodoPro hooks (added by todopro init) ---',
    codexHookEntry('stop', 'stop-hook.js'),
    codexHookEntry('post_tool_use', 'post-tool-use.js', 'shell'),
    codexHookEntry('post_tool_use', 'post-tool-use.js', 'apply_patch|write|edit'),
    codexHookEntry('subagent_stop', 'subagent-stop.js'),
    '# --- end TodoPro hooks ---',
    '',
  ].join('\n');

  // 追加(去重:查 stop-hook.js)
  let existing = '';
  if (fs.existsSync(configPath)) existing = fs.readFileSync(configPath, 'utf8');
  if (existing.includes('todopro') && existing.includes('stop-hook.js')) {
    warn(configPath + ' 已含 TodoPro hooks,跳过');
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.appendFileSync(configPath, codexHooksToml, 'utf8');
    ok('hooks 已追加到 ' + configPath);
  }

  // SKILL.md
  const skillDir = path.join(codexDir, 'skills', 'todopro');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(globalDir, 'SKILL.md'), path.join(skillDir, 'SKILL.md'));
  ok('SKILL.md 已放到 ' + skillDir);

  // 预置 review-subagent-prompt.md
  const todoproDir = path.join(dir, '.todopro');
  fs.mkdirSync(todoproDir, { recursive: true });
  fs.copyFileSync(path.join(globalDir, 'review-subagent-prompt.md'),
           path.join(todoproDir, 'review-subagent-prompt.md'));
  writeTodoproReadme(todoproDir);

  console.log();
  ok('Codex 安装完成。');
  info('请重启 Codex 以加载配置。');
  info('hooks 指向全局 ' + GLOBAL_DIR + '。');
}

// ─── Hana 安装(软链到全局,回退复制)───
function installHana(dir, globalDir) {
  info('安装到 HanaAgent...');
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), '.openhanako');
  const pluginsDir = path.join(hanaHome, 'plugins');
  const pluginDir = path.join(pluginsDir, 'todopro');

  // full-access 插件结构:manifest.json + extensions/ + tools/ + skills/ + core/
  fs.mkdirSync(pluginDir, { recursive: true });

  // manifest.json(复制,小文件且需在插件目录)
  fs.copyFileSync(path.join(globalDir, 'src/platforms/hana/manifest.json'),
           path.join(pluginDir, 'manifest.json'));
  ok('manifest.json 已创建(full-access)');

  // extensions/index.js(软链到全局,回退复制)
  fs.mkdirSync(path.join(pluginDir, 'extensions'), { recursive: true });
  const extMethod = symlinkOrCopy(
    path.join(globalDir, 'src/platforms/hana/extensions/index.js'),
    path.join(pluginDir, 'extensions/index.js')
  );
  ok('extensions/index.js (' + extMethod + ')');

  // tools/todopro.js(软链到全局,回退复制)
  fs.mkdirSync(path.join(pluginDir, 'tools'), { recursive: true });
  const toolMethod = symlinkOrCopy(
    path.join(globalDir, 'src/platforms/hana/tools/todopro.js'),
    path.join(pluginDir, 'tools/todopro.js')
  );
  ok('tools/todopro.js (' + toolMethod + ')');

  // SKILL.md(复制)
  fs.mkdirSync(path.join(pluginDir, 'skills', 'todopro'), { recursive: true });
  fs.copyFileSync(path.join(globalDir, 'SKILL.md'),
           path.join(pluginDir, 'skills/todopro/SKILL.md'));
  ok('SKILL.md 已放到插件 skills/');

  // core/(软链到全局 src/core,回退复制)
  // resolveCore 的第一候选 path.join(__dirname, '..', 'core', name):
  //   __dirname = extensions/ → .. = pluginDir → core = 软链 → 全局 src/core ✓
  const coreMethod = symlinkOrCopy(
    path.join(globalDir, 'src/core'),
    path.join(pluginDir, 'core')
  );
  ok('core/ (' + coreMethod + ' → 全局 src/core)');

  // 预置 review-subagent-prompt.md
  const todoproDir = path.join(dir, '.todopro');
  fs.mkdirSync(todoproDir, { recursive: true });
  fs.copyFileSync(path.join(globalDir, 'review-subagent-prompt.md'),
           path.join(todoproDir, 'review-subagent-prompt.md'));
  writeTodoproReadme(todoproDir);

  console.log();
  ok('Hana 安装完成。');
  info('需在 Hana 设置 → 插件页面开启"允许全权插件"开关,然后重载。');
  info('插件通过软链引用全局 ' + GLOBAL_DIR + '。');
}

// ─── 卸载:精确清理各平台的 TodoPro 痕迹(保留用户其他配置)───

// 递归删除目录(空目录也删)
function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  catch (e) { return false; }
}

function uninstallClaudeCode(dir) {
  info('卸载 Claude Code...');
  const claudeDir = path.join(dir, '.claude');
  let cleaned = 0;

  // 1. 从 settings.json 精确删除 TodoPro hook 条目(command 含 'todopro')
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.hooks) {
        for (const evt of Object.keys(settings.hooks)) {
          const before = settings.hooks[evt].length;
          // 过滤掉 command 含 'todopro' 的条目
          settings.hooks[evt] = settings.hooks[evt].filter(e =>
            !(e.hooks && e.hooks.some(h => (h.command || '').includes('todopro')))
          );
          cleaned += before - settings.hooks[evt].length;
          // 若该事件类型删空了,删掉空数组(必须在 cleaned += 之后,否则 settings.hooks[evt] 变 undefined)
          if (settings.hooks[evt].length === 0) delete settings.hooks[evt];
        }
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
        ok('settings.json 已清理 TodoPro hooks(删除 ' + cleaned + ' 条,保留其他配置)');
      }
    } catch (e) { warn('settings.json 解析失败,跳过 hook 清理: ' + e.message); }
  }

  // 2. 删 .claude/skills/todopro/(项目级 SKILL.md)
  const skillDir = path.join(claudeDir, 'skills', 'todopro');
  if (fs.existsSync(skillDir)) { removeDir(skillDir); ok('已删 ' + path.relative(dir, skillDir)); }

  // 3. 删 .todopro/(预置文件 + 运行时文件)
  const todoproDir = path.join(dir, '.todopro');
  if (fs.existsSync(todoproDir)) { removeDir(todoproDir); ok('已删 ' + path.relative(dir, todoproDir)); }

  ok('Claude Code 卸载完成');
}

function uninstallCodex(dir) {
  info('卸载 Codex...');
  let cleaned = false;

  // 1. 从 config.toml 精确删除 # --- TodoPro hooks --- 到 # --- end TodoPro hooks --- 段
  const configPath = fs.existsSync(path.join(dir, 'config.toml'))
    ? path.join(dir, 'config.toml')
    : path.join(os.homedir(), '.codex', 'config.toml');
  if (fs.existsSync(configPath)) {
    let content = fs.readFileSync(configPath, 'utf8');
    const startMarker = '# --- TodoPro hooks';
    const endMarker = '# --- end TodoPro hooks ---';
    const startIdx = content.indexOf(startMarker);
    if (startIdx >= 0) {
      const endIdx = content.indexOf(endMarker, startIdx);
      if (endIdx >= 0) {
        // 删从 startMarker 前的空行到 endMarker 后的换行
        let removeStart = startIdx;
        // 往前吃掉一个空行(如果有)
        if (removeStart > 0 && content[removeStart - 1] === '\n') removeStart--;
        if (removeStart > 0 && content[removeStart - 1] === '\n') removeStart--;
        let removeEnd = endIdx + endMarker.length;
        if (content[removeEnd] === '\n') removeEnd++;
        content = content.slice(0, removeStart) + content.slice(removeEnd);
        fs.writeFileSync(configPath, content, 'utf8');
        ok('config.toml 已清理 TodoPro hooks 段(保留其他配置)');
        cleaned = true;
      }
    }
    if (!cleaned) { info('config.toml 未找到 TodoPro hooks 段,跳过'); }
  }

  // 2. 删 ~/.codex/skills/todopro/
  const skillDir = path.join(os.homedir(), '.codex', 'skills', 'todopro');
  if (fs.existsSync(skillDir)) { removeDir(skillDir); ok('已删 ' + skillDir); }

  // 3. 删 .todopro/
  const todoproDir = path.join(dir, '.todopro');
  if (fs.existsSync(todoproDir)) { removeDir(todoproDir); ok('已删 ' + path.relative(dir, todoproDir)); }

  ok('Codex 卸载完成');
}

function uninstallHana(dir) {
  info('卸载 HanaAgent...');
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), '.openhanako');
  const pluginDir = path.join(hanaHome, 'plugins', 'todopro');

  // 1. 删整个插件目录(软链+manifest+skills)
  if (fs.existsSync(pluginDir)) { removeDir(pluginDir); ok('已删插件 ' + pluginDir); }
  else { info('未找到 Hana 插件目录,跳过'); }

  // 2. 删 .todopro/
  const todoproDir = path.join(dir, '.todopro');
  if (fs.existsSync(todoproDir)) { removeDir(todoproDir); ok('已删 ' + path.relative(dir, todoproDir)); }

  ok('Hana 卸载完成');
}

function uninstallGlobal() {
  info('卸载全局安装...');
  if (fs.existsSync(GLOBAL_DIR)) { removeDir(GLOBAL_DIR); ok('已删全局 ' + GLOBAL_DIR); }
  else { info('未找到全局安装目录,跳过'); }
}

function uninstallAll(platforms, dir, removeGlobal) {
  let count = 0;
  for (const p of platforms) {
    count++;
    console.log();
    info(`[${count}/${platforms.length}] 卸载 ${PLATFORM_LABELS[p] || p}...`);
    switch (p) {
      case 'claude-code': uninstallClaudeCode(dir); break;
      case 'codex': uninstallCodex(dir); break;
      case 'hana': uninstallHana(dir); break;
      default: warn('未知平台:' + p + ',跳过');
    }
  }
  // 最后删全局(所有平台都卸了才删)
  if (removeGlobal) {
    console.log();
    uninstallGlobal();
  }
  console.log();
  ok(`卸载完成 — 已清理 ${count} 个平台${removeGlobal ? ' + 全局安装' : ''}。`);
  info('请重启对应平台以使卸载生效。');
}

// ─── 交互式多选提示(↑/↓ 空格 回车, 零依赖纯 Node) ───
function multiSelectPrompt(options, action = '安装') {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      return resolve(options.filter(o => o.detected).map(o => o.name));
    }

    let selected = options.map(o => !!o.detected);
    let current = 0;
    let renderCount = 0;
    let warningMsg = '';
    const BASE_ROWS = options.length + 2;
    let lastRows = 0;

    function totalRows() {
      return BASE_ROWS + (warningMsg ? 1 : 0);
    }

    function render() {
      const rows = totalRows();
      if (renderCount > 0) {
        process.stdout.write(ANSI.cursorUp(lastRows - 1));
        process.stdout.write('\r');
      }

      let out = '';
      out += `  \x1b[2m?\x1b[0m 请选择要${action}的平台 (\x1b[2m↑/↓\x1b[0m 导航, \x1b[2m空格\x1b[0m 切换, \x1b[2m回车\x1b[0m 确认):\n`;
      for (let i = 0; i < options.length; i++) {
        const isCur = i === current;
        const isSel = selected[i];
        const detected = options[i].detected;
        const checkbox = isSel ? `${ANSI.green}◼${ANSI.reset}` : '◻';
        const pointer = isCur ? `${ANSI.cyan}❯${ANSI.reset}` : ' ';
        const labelStyle = isCur ? ANSI.cyan : '';
        const detectedTag = detected ? `  ${ANSI.green}✓ 已检测到${ANSI.reset}` : '';
        out += `  ${pointer} ${checkbox} ${labelStyle}${options[i].label}${ANSI.reset}${detectedTag}${ANSI.clearLine}\n`;
      }
      out += `  ${ANSI.dim}(↑/↓ 导航, 空格切换, 回车确认, a 全选/取消, Ctrl+C 退出)${ANSI.reset}${ANSI.clearLine}`;
      if (warningMsg) {
        out += `\n  ${ANSI.yellow}!${ANSI.reset} ${warningMsg}${ANSI.clearLine}`;
      }

      process.stdout.write(out);
      // 清除上次渲染残留(警告出现又消失时,旧行数 > 新行数)
      if (renderCount > 0 && lastRows > rows) {
        const residual = lastRows - rows;
        for (let i = 0; i < residual; i++) {
          process.stdout.write(ANSI.clearLine + '\n');
        }
        process.stdout.write(ANSI.cursorUp(residual));
      }
      lastRows = rows;
      renderCount++;
    }

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('keypress', onKeypress);
      process.stdout.write(ANSI.cursorShow);
    }

    function onKeypress(str, key) {
      warningMsg = '';

      if (key.name === 'up' || (key.name === 'k' && key.ctrl)) {
        current = (current - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down' || (key.name === 'j' && key.ctrl)) {
        current = (current + 1) % options.length;
        render();
      } else if (key.name === 'space') {
        selected[current] = !selected[current];
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        const hasSel = selected.some(s => s);
        if (hasSel) {
          cleanup();
          resolve(options.filter((_, i) => selected[i]).map(o => o.name));
        } else {
          warningMsg = '至少选择一项';
          render();
        }
      } else if (key.name === 'c' && key.ctrl) {
        cleanup();
        console.log();
        process.exit(0);
      } else if (str === 'a') {
        const allSel = selected.every(s => s);
        selected = selected.map(() => !allSel);
        render();
      }
    }

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    process.stdout.write(ANSI.cursorHide);

    stdin.on('keypress', onKeypress);
    render();
  });
}

// ─── 安装所有选中平台 ───
function installAll(platforms, dir, globalDir) {
  let count = 0;
  for (const p of platforms) {
    count++;
    console.log();
    info(`[${count}/${platforms.length}] 安装到 ${PLATFORM_LABELS[p] || p}...`);
    switch (p) {
      case 'claude-code': installClaudeCode(dir, globalDir); break;
      case 'codex': installCodex(dir, globalDir); break;
      case 'hana': installHana(dir, globalDir); break;
      default: warn('未知平台:' + p + ',跳过');
    }
  }
  console.log();
  ok(`全部完成 — 已安装 ${count} 个平台。`);
  info('请重启对应平台(或重载会话)以使 hooks 生效。');
}

// ─── 主流程 ───
async function main() {
  const args = parseArgs(process.argv);
  console.log('TodoPro init\n');

  if (args.help) {
    console.log('用法:');
    console.log('  node src/install/init.js                       # 交互式选择平台(安装)');
    console.log('  node src/install/init.js --platform <name>     # 静默安装指定平台');
    console.log('  node src/install/init.js --platform all        # 安装全部平台');
    console.log('  node src/install/init.js --update              # 只刷新全局安装(不重配 hook)');
    console.log('  node src/install/init.js --uninstall           # 交互式选择平台(卸载)');
    console.log('  node src/install/init.js --uninstall --platform claude-code  # 静默卸载指定平台');
    console.log('  node src/install/init.js --platform <name> --dir <path>  # 指定项目目录');
    console.log('');
    console.log('可用平台:claude-code | codex | hana');
    console.log('');
    console.log('全局安装位置:' + GLOBAL_DIR);
    return;
  }

  if (!checkNode()) { process.exit(1); }

  const root = todoproRoot();

  // --update:只刷新全局安装
  if (args.update) {
    info('--update:只刷新全局安装...');
    installGlobal(root);
    ok('全局安装已更新。hooks 和 SKILL.md 不变(如需更新重跑 init --platform)');
    return;
  }

  // --uninstall:卸载
  if (args.uninstall) {
    let platforms = [];

    if (args.platform) {
      if (args.platform === 'all') {
        platforms = ['claude-code', 'codex', 'hana'];
      } else {
        const valid = ['claude-code', 'codex', 'hana'];
        if (!valid.includes(args.platform)) {
          err('未知平台:' + args.platform);
          process.exit(1);
        }
        platforms = [args.platform];
      }
      info('指定卸载平台:' + platforms.join(', '));
    } else {
      // 交互式:检测已装平台 → 弹出多选
      const detected = detectPlatforms(args.dir);
      const allPlatforms = [
        { name: 'claude-code', label: 'Claude Code', detected: detected.includes('claude-code') },
        { name: 'codex',       label: 'Codex',        detected: detected.includes('codex') },
        { name: 'hana',        label: 'HanaAgent',    detected: detected.includes('hana') },
      ];
      console.log('  ' + ANSI.dim + '已检测到安装位置:'
        + (detected.length ? detected.map(p => PLATFORM_LABELS[p]).join(', ') : '无')
        + ANSI.reset);
      console.log();
      platforms = await multiSelectPrompt(allPlatforms, '卸载');
      if (platforms.length === 0) {
        console.log('\n  已取消。');
        return;
      }
      process.stdout.write('\n');
      console.log('  ' + ANSI.yellow + '将卸载: ' + platforms.map(p => PLATFORM_LABELS[p]).join(', ') + ANSI.reset);
    }

    // 执行卸载。只有全卸载(claude-code + codex + hana)才删全局目录。
    const removeGlobal = platforms.length === 3;
    uninstallAll(platforms, args.dir, removeGlobal);
    return;
  }

  // 1. 全局安装(所有平台安装之前)
  const globalDir = installGlobal(root);

  // 2. 解析平台
  let platforms = [];

  if (args.platform) {
    if (args.platform === 'all') {
      platforms = ['claude-code', 'codex', 'hana'];
    } else {
      const valid = ['claude-code', 'codex', 'hana'];
      if (!valid.includes(args.platform)) {
        err('未知平台:' + args.platform + '(支持:claude-code | codex | hana)');
        process.exit(1);
      }
      platforms = [args.platform];
    }
    info('指定平台:' + platforms.join(', '));
  } else {
    // 交互式模式
    const detected = detectPlatforms(args.dir);
    const allPlatforms = [
      { name: 'claude-code', label: 'Claude Code', detected: detected.includes('claude-code') },
      { name: 'codex',       label: 'Codex',        detected: detected.includes('codex') },
      { name: 'hana',        label: 'HanaAgent',    detected: detected.includes('hana') },
    ];

    console.log('  ' + ANSI.dim + '已检测到:'
      + (detected.length ? detected.map(p => PLATFORM_LABELS[p]).join(', ') : '无')
      + ANSI.reset);
    console.log();

    platforms = await multiSelectPrompt(allPlatforms);
    if (platforms.length === 0) {
      console.log('\n  已取消,未安装任何平台。');
      return;
    }
    process.stdout.write('\n');
    console.log('  ' + ANSI.green + '已选择: ' + platforms.map(p => PLATFORM_LABELS[p]).join(', ') + ANSI.reset);
  }

  // 3. 执行各平台安装
  installAll(platforms, args.dir, globalDir);
}

main().catch(e => {
  err(e.message);
  process.exit(1);
});
