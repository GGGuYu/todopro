#!/usr/bin/env node
// src/install/init.js
// TodoPro init 引导程序:检测平台、注入 hook 配置、放核心脚本与 SKILL.md、提示重载。
// 仅用 Node 内置模块(零依赖)。
//
// spec: harness-install
// 用法:
//   node src/install/init.js                       # 自动检测平台
//   node src/install/init.js --platform claude-code # 显式指定
//   node src/install/init.js --platform codex
//   node src/install/init.js --platform hana
//
// 平台检测标志:
//   claude-code: 项目根有 .claude/ 目录
//   codex:       ~/.codex/config.toml 存在
//   hana:        环境变量 HANA_HOME 或常见路径存在 plugins/ 目录

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ─── 工具函数 ───
function info(msg) { console.log('  ' + msg); }
function ok(msg) { console.log('  ✓ ' + msg); }
function warn(msg) { console.log('  ! ' + msg); }
function err(msg) { console.error('  ✗ ' + msg); }

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

// ─── 主流程 ───
function main() {
  const args = parseArgs(process.argv);
  console.log('TodoPro init\n');

  if (args.help) {
    console.log('用法:node src/install/init.js [--platform claude-code|codex|hana] [--dir <project-dir>]');
    console.log('  --platform  显式指定目标平台(否则自动检测)');
    console.log('  --dir       目标项目目录(默认当前目录)');
    return;
  }

  // 11.6 检测 Node
  if (!checkNode()) { process.exit(1); }

  // 11.1 检测平台
  let platform = args.platform;
  if (!platform) {
    platform = detectPlatform(args.dir);
    if (!platform) {
      err('未检测到任何平台。请用 --platform 显式指定:claude-code | codex | hana');
      process.exit(1);
    }
    info('检测到平台:' + platform);
  } else {
    info('指定平台:' + platform);
  }

  console.log();
  switch (platform) {
    case 'claude-code': installClaudeCode(args.dir); break;
    case 'codex': installCodex(args.dir); break;
    case 'hana': installHana(args.dir); break;
    default:
      err('未知平台:' + platform + '(支持:claude-code | codex | hana)');
      process.exit(1);
  }
}

main();
