#!/usr/bin/env node
// src/install/init.js
// TodoPro init 引导程序:检测平台、注入 hook 配置、放核心脚本与 SKILL.md、提示重载。
// 仅用 Node 内置模块(零依赖)。
//
// spec: harness-install
// 用法:
//   node src/install/init.js                       # 交互式选择平台(推荐)
//   node src/install/init.js --platform claude-code # 静默安装指定平台
//   node src/install/init.js --platform codex
//   node src/install/init.js --platform hana
//   node src/install/init.js --platform all        # 安装全部平台
//
// 平台检测标志:
//   claude-code: 项目根有 .claude/ 目录
//   codex:       ~/.codex/config.toml 存在
//   hana:        环境变量 HANA_HOME 或常见路径存在 plugins/ 目录

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
  // 游标
  cursorUp: (n) => `\x1b[${n}A`,
  cursorShow: '\x1b[?25h',
  cursorHide: '\x1b[?25l',
  clearLine: '\x1b[K',
};

function parseArgs(argv) {
  const args = { platform: null, dir: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--platform' && argv[i + 1]) { args.platform = argv[++i]; }
    else if (argv[i] === '--dir' && argv[i + 1]) { args.dir = argv[++i]; }
    else if (argv[i] === '--help' || argv[i] === '-h') { args.help = true; }
  }
  return args;
}

// TodoPro 仓库根(此 init.js 所在的 src/install/ 往上两级)
function todoproRoot() {
  return path.resolve(__dirname, '..', '..');
}

// ─── 平台检测 ───
function detectPlatform(dir) {
  // Claude Code:项目根有 .claude/
  if (fs.existsSync(path.join(dir, '.claude'))) return 'claude-code';
  // Codex:~/.codex/config.toml(全局)或项目 config.toml
  if (fs.existsSync(path.join(os.homedir(), '.codex', 'config.toml'))) return 'codex';
  if (fs.existsSync(path.join(dir, 'config.toml'))) return 'codex';
  // Hana:HANA_HOME 或常见插件目录
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), '.openhanako');
  if (fs.existsSync(path.join(hanaHome, 'plugins'))) return 'hana';
  return null;
}

// ─── 检测所有存在的平台(返回数组,用于交互式提示) ───
function detectPlatforms(dir) {
  const found = [];
  if (fs.existsSync(path.join(dir, '.claude'))) found.push('claude-code');
  if (fs.existsSync(path.join(os.homedir(), '.codex', 'config.toml')) ||
      fs.existsSync(path.join(dir, 'config.toml'))) found.push('codex');
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), '.openhanako');
  if (fs.existsSync(path.join(hanaHome, 'plugins'))) found.push('hana');
  return found;
}

// 平台标签映射(展示用)
const PLATFORM_LABELS = {
  'claude-code': 'Claude Code',
  'codex':       'Codex',
  'hana':        'HanaAgent',
};

// ─── Node 检测 ───
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

// ─── Claude Code 安装 ───
function installClaudeCode(dir) {
  info('安装到 Claude Code...');
  const root = todoproRoot();
  const claudeDir = path.join(dir, '.claude');

  // 1. 确保 .claude/ 存在
  fs.mkdirSync(claudeDir, { recursive: true });

  // 2. merge hooks 进 .claude/settings.json
  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { warn('现有 settings.json 解析失败,将备份后重建'); fs.renameSync(settingsPath, settingsPath + '.bak'); }
  }
  settings.hooks = settings.hooks || {};

  // 读取我们的 hooks 模板
  const hooksTpl = JSON.parse(fs.readFileSync(path.join(root, 'src/platforms/claude-code/settings.hooks.json'), 'utf8'));
  // merge:每个事件类型合并 matcher 数组(避免重复添加)
  for (const evt of Object.keys(hooksTpl.hooks)) {
    settings.hooks[evt] = settings.hooks[evt] || [];
    for (const entry of hooksTpl.hooks[evt]) {
      // 去重:若已有相同 matcher+command 则跳过
      const exists = settings.hooks[evt].some(e =>
        e.matcher === entry.matcher && e.hooks && e.hooks.some(h => h.command === entry.hooks[0].command));
      if (!exists) settings.hooks[evt].push(entry);
    }
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  ok('hooks 已 merge 进 ' + path.relative(dir, settingsPath));

  // 3. 放 SKILL.md 到 .claude/skills/todopro/
  //    核心脚本通过 ${CLAUDE_PROJECT_DIR} 引用(已在 hooks command 里),无需拷贝
  //    但若用户把 todopro 仓库放在别处,需保证路径可达——这里要求 todopro 仓库就在项目内
  const skillDir = path.join(claudeDir, 'skills', 'todopro');
  fs.mkdirSync(skillDir, { recursive: true });
  copyFile(path.join(root, 'skills/todopro/SKILL.md'), path.join(skillDir, 'SKILL.md'));
  ok('SKILL.md 已放到 ' + path.relative(dir, skillDir));

  // 4. 放 review-subagent-prompt.md 到 .todopro/(预置静态文件)
  const todoproDir = path.join(dir, '.todopro');
  fs.mkdirSync(todoproDir, { recursive: true });
  copyFile(path.join(root, 'skills/todopro/review-subagent-prompt.md'),
           path.join(todoproDir, 'review-subagent-prompt.md'));
  ok('review-subagent-prompt.md 已预置到 .todopro/');

  // 5. 确保核心脚本路径可达(todopro 仓库需在项目内或 CLAUDE_PROJECT_DIR 指向它)
  if (!dir.startsWith(root) && root !== dir && !fs.existsSync(path.join(dir, 'src/core/decide-stop.js'))) {
    warn('TodoPro 核心脚本不在当前项目内。hooks 用 ${CLAUDE_PROJECT_DIR} 引用,');
    warn('请确保 Claude Code 在此项目目录启动,或将 TodoPro 仓库克隆到项目内。');
  } else {
    ok('核心脚本路径可达(src/platforms/claude-code/*.js)');
  }

  console.log();
  ok('Claude Code 安装完成。');
  info('请重启 Claude Code(或重载会话)以使 hooks 生效。');
  info('之后模型在做多步/多文件任务时可自主调用 TodoPro(见 SKILL.md)。');
}

// ─── Codex 安装(骨架,组9 完善适配层后激活)───
function installCodex(dir) {
  info('安装到 Codex...');
  const root = todoproRoot();
  const codexDir = path.join(os.homedir(), '.codex');
  const configPath = fs.existsSync(path.join(dir, 'config.toml'))
    ? path.join(dir, 'config.toml')
    : path.join(codexDir, 'config.toml');

  // Codex hooks 配置(TOML 段)。
  // P2-5 修复:路径用 TOML 字面字符串(单引号)包裹,单引号内不转义,含空格/反斜杠都安全。
  // 去重查 "todopro/stop-hook.js" 标志字符串(比查注释更可靠,用户改注释不影响)。
  function tomlLitStr(s) {
    // TOML 字面字符串:单引号包裹,内部单引号不允许(字面串不能含单引号)。
    // 路径不应含单引号;若含则回退到基本字符串(双引号)并转义。
    if (s.indexOf("'") === -1) return "'" + s + "'";
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function codexHookEntry(hookType, scriptName, matcher) {
    const scriptPath = path.join(root, 'src/platforms/codex', scriptName);
    const lines = ['[[hooks.' + hookType + ']]'];
    if (matcher) lines.push('matcher = ' + tomlLitStr(matcher));
    lines.push('command = ["node", ' + tomlLitStr(scriptPath) + ']');
    return lines.join('\n');
  }
  const codexHooksToml = [
    '',
    '# --- TodoPro hooks (added by todopro init) ---',
    codexHookEntry('stop', 'stop-hook.js'),
    '# PostToolUse 匹配 shell(含 todopro-tool 调用,推进检测)+ 编辑类工具(记 touched-files)',
    codexHookEntry('post_tool_use', 'post-tool-use.js', 'shell'),
    codexHookEntry('post_tool_use', 'post-tool-use.js', 'apply_patch|write|edit'),
    codexHookEntry('subagent_stop', 'subagent-stop.js'),
    '# --- end TodoPro hooks ---',
    '',
  ].join('\n');

  // 追加(去重:查 stop-hook.js 路径标志,不靠注释——用户改注释不影响去重)
  let existing = '';
  if (fs.existsSync(configPath)) existing = fs.readFileSync(configPath, 'utf8');
  if (existing.includes('todopro') && existing.includes('stop-hook.js')) {
    warn(configPath + ' 已含 TodoPro hooks,跳过');
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.appendFileSync(configPath, codexHooksToml, 'utf8');
    ok('hooks 已追加到 ' + configPath);
  }

  // 放 SKILL.md(Codex 技能目录)
  // Codex 的 skill 机制待组9 确认;暂放 .codex/skills/
  const skillDir = path.join(codexDir, 'skills', 'todopro');
  fs.mkdirSync(skillDir, { recursive: true });
  copyFile(path.join(root, 'skills/todopro/SKILL.md'), path.join(skillDir, 'SKILL.md'));
  ok('SKILL.md 已放到 ' + skillDir);

  // 预置 review-subagent-prompt.md
  const todoproDir = path.join(dir, '.todopro');
  fs.mkdirSync(todoproDir, { recursive: true });
  copyFile(path.join(root, 'skills/todopro/review-subagent-prompt.md'),
           path.join(todoproDir, 'review-subagent-prompt.md'));

  console.log();
  ok('Codex 安装完成。');
  info('请重启 Codex 以加载配置。');
  info('之后模型在做多步/多文件任务时可自主调用 TodoPro(见 SKILL.md)。');
}

// ─── Hana 安装 ───
function installHana(dir) {
  info('安装到 HanaAgent...');
  const root = todoproRoot();
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), '.openhanako');
  const pluginsDir = path.join(hanaHome, 'plugins');
  const pluginDir = path.join(pluginsDir, 'todopro');

  // full-access 插件结构:manifest.json + extensions/ + tools/ + skills/ + core/(bundled)
  fs.mkdirSync(path.join(pluginDir, 'extensions'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'skills', 'todopro'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'core'), { recursive: true });

  // manifest.json
  copyFile(path.join(root, 'src/platforms/hana/manifest.json'),
           path.join(pluginDir, 'manifest.json'));
  ok('manifest.json 已创建(full-access)');

  // extensions/index.js(Pi 事件接入)
  copyFile(path.join(root, 'src/platforms/hana/extensions/index.js'),
           path.join(pluginDir, 'extensions/index.js'));
  ok('extensions/index.js 已安装');

  // tools/todopro.js(TodoPro 工具注册)
  copyFile(path.join(root, 'src/platforms/hana/tools/todopro.js'),
           path.join(pluginDir, 'tools/todopro.js'));
  ok('tools/todopro.js 已安装');

  // SKILL.md
  copyFile(path.join(root, 'skills/todopro/SKILL.md'),
           path.join(pluginDir, 'skills/todopro/SKILL.md'));
  ok('SKILL.md 已放到插件 skills/');

  // 核心脚本 bundle 到插件 core/(extensions/tools 通过 resolveCore 找这里)
  const coreFiles = ['paths.js', 'todo-store.js', 'todo-md-mirror.js', 'session-state.js',
                     'touched-files.js', 'git-diff.js', 'decide-stop.js', 'prompts.js',
                     'cleanup.js', 'run-stop.js', 'run-post-tool-use.js', 'run-todopro-tool.js'];
  for (const f of coreFiles) {
    copyFile(path.join(root, 'src/core', f), path.join(pluginDir, 'core', f));
  }
  ok('核心脚本(' + coreFiles.length + ' 个)已 bundle 到插件 core/');

  // 预置 review-subagent-prompt.md
  const todoproDir = path.join(dir, '.todopro');
  fs.mkdirSync(todoproDir, { recursive: true });
  copyFile(path.join(root, 'skills/todopro/review-subagent-prompt.md'),
           path.join(todoproDir, 'review-subagent-prompt.md'));

  console.log();
  ok('Hana 安装完成。');
  info('需在 Hana 设置 → 插件页面开启"允许全权插件"开关,然后重载。');
  info('之后模型在做多步/多文件任务时可自主调用 TodoPro(见 SKILL.md)。');
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

// ─── 交互式多选提示(↑/↓ 空格 回车, 零依赖纯 Node) ───
function multiSelectPrompt(options) {
  // options: [{ name, label, detected }]
  // returns: Promise<string[]> — 选中的 name 数组
  return new Promise((resolve) => {
    const stdin = process.stdin;

    // 非 TTY → 回退:只返回已检测到的平台
    if (!stdin.isTTY) {
      return resolve(options.filter(o => o.detected).map(o => o.name));
    }

    let selected = options.map(o => !!o.detected);
    let current = 0;
    let renderCount = 0;
    let warningMsg = '';
    const BASE_ROWS = options.length + 2; // 标题 + 选项 + 脚注
    let lastRows = 0; // P3 修复:记住上次输出的行数,cursorUp 用上次行数(不是当前),避免警告出现/消失时行数不一致导致残留

    function totalRows() {
      return BASE_ROWS + (warningMsg ? 1 : 0);
    }

    function render() {
      const rows = totalRows();
      if (renderCount > 0) {
        // P3:cursorUp 用上次实际输出的行数(lastRows),不是当前行数。
        //   警告出现(5→6)或消失(6→5)时,当前 totalRows 与上次不一致,
        //   用当前会多/少跳一行,导致残留。用 lastRows 精确回到上次输出起点。
        process.stdout.write(ANSI.cursorUp(lastRows));
        process.stdout.write('\r'); // 回到行首,确保覆盖
      }

      let out = '';
      // 标题
      out += '  \x1b[2m?\x1b[0m 请选择要安装的平台 (\x1b[2m↑/↓\x1b[0m 导航, \x1b[2m空格\x1b[0m 切换, \x1b[2m回车\x1b[0m 确认):\n';
      // 选项
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
      // 脚注
      out += `  ${ANSI.dim}(↑/↓ 导航, 空格切换, 回车确认, a 全选/取消, Ctrl+C 退出)${ANSI.reset}${ANSI.clearLine}`;
      // 警告
      if (warningMsg) {
        out += `\n  ${ANSI.yellow}!${ANSI.reset} ${warningMsg}${ANSI.clearLine}`;
      }

      process.stdout.write(out);
      lastRows = rows; // 记住本次行数,供下次 cursorUp 用
      renderCount++;
    }

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('keypress', onKeypress);
      process.stdout.write(ANSI.cursorShow);
    }

    function onKeypress(str, key) {
      warningMsg = ''; // 按键即清警告

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

    // 进入原始模式
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    process.stdout.write(ANSI.cursorHide);

    stdin.on('keypress', onKeypress);
    render();
  });
}

// ─── 安装所有选中平台 ───
function installAll(platforms, dir) {
  let count = 0;
  for (const p of platforms) {
    count++;
    console.log();
    info(`[${count}/${platforms.length}] 安装到 ${PLATFORM_LABELS[p] || p}...`);
    switch (p) {
      case 'claude-code': installClaudeCode(dir); break;
      case 'codex': installCodex(dir); break;
      case 'hana': installHana(dir); break;
      default: warn('未知平台:' + p + ',跳过');
    }
  }
  console.log();
  ok(`全部完成 — 已安装 ${count} 个平台。`);
  info('请重启对应平台(或重载会话)以使 hooks 生效。');
}

// ─── 主流程(现在支持交互式) ───
async function main() {
  const args = parseArgs(process.argv);
  console.log('TodoPro init\n');

  if (args.help) {
    console.log('用法:');
    console.log('  node src/install/init.js                       # 交互式选择平台');
    console.log('  node src/install/init.js --platform <name>     # 静默安装指定平台');
    console.log('  node src/install/init.js --platform all        # 安装全部平台');
    console.log('  node src/install/init.js --platform <name> --dir <path>  # 指定项目目录');
    console.log('');
    console.log('可用平台:claude-code | codex | hana');
    return;
  }

  // 11.6 检测 Node
  if (!checkNode()) { process.exit(1); }

  // 解析平台参数
  let platforms = [];

  if (args.platform) {
    // 非交互模式
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
    // 交互式模式:检测已存在平台 → 弹出多选提示
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
      console.log('\n  已取消，未安装任何平台。');
      return;
    }
    // 提示结束 → 换行(把后续输出和提示区域分开)
    process.stdout.write('\n');
    console.log('  ' + ANSI.green + '已选择: ' + platforms.map(p => PLATFORM_LABELS[p]).join(', ') + ANSI.reset);
  }

  // 执行安装
  installAll(platforms, args.dir);
}

main().catch(e => {
  err(e.message);
  process.exit(1);
});
