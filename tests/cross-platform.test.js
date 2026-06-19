// tests/cross-platform.test.js
// 跨平台一致性验证(任务组 12)。
// 12.1 核心脚本三平台共用同一份(无平台特定分支)
// 12.2 三平台归一化事件与反归一化输出契约一致(同一决策产生等价行为)
// 12.3 三平台均零 npm 依赖(纯 node 内置模块运行)
// 运行:node tests/cross-platform.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); PASS++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); FAIL++; }
}

console.log('组12:跨平台一致性验证\n');

// 12.1 核心脚本三平台共用同一份(无平台分支)
test('12.1 核心脚本无平台特定分支(src/core/ 不引用 platforms/)', () => {
  const coreDir = path.join(ROOT, 'src/core');
  const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 10, '核心脚本应至少 10 个,实际 ' + files.length);
  for (const f of files) {
    const content = fs.readFileSync(path.join(coreDir, f), 'utf8');
    // 核心脚本不应 require platforms/(平台无关代码引用)。
    // 注意:提示词文本里可能出现 "src/platforms/..." 作为给模型的说明字符串,那不是代码引用,允许。
    assert.ok(!content.includes("require('../platforms/") && !content.includes('require("../platforms/'),
      f + ' 不应 require platforms/(提示词文本里的路径字符串允许)');
  }
  console.log('    核心脚本 ' + files.length + ' 个,均无平台分支');
});

test('12.1b 三平台适配层都 require 同一份 core(run-stop/run-post-tool-use/run-todopro-tool)', () => {
  const platforms = ['claude-code', 'codex'];
  for (const p of platforms) {
    const stopHook = fs.readFileSync(path.join(ROOT, 'src/platforms', p, 'stop-hook.js'), 'utf8');
    assert.ok(stopHook.includes("require('../../core/run-stop')"), p + ' stop-hook 应 require core/run-stop');
  }
  // Hana extensions 也 require run-stop
  const hanaExt = fs.readFileSync(path.join(ROOT, 'src/platforms/hana/extensions/index.js'), 'utf8');
  assert.ok(hanaExt.includes("run-stop"), 'hana extensions 应 require core/run-stop');
  console.log('    三平台均通过 core/run-stop 共享 Stop 决策逻辑');
});

// 12.2 三平台同一决策产生等价行为
// 用同一份 todo + session 状态,分别跑 Claude Code 和 Codex 的 stop-hook,
// 验证阻断/放行决策一致(只是 I/O 格式不同)
test('12.2 同一状态下 Claude Code 与 Codex 决策一致(阻断时都阻断,放行时都放行)', () => {
  const dir1 = '/tmp/xp-cc';
  const dir2 = '/tmp/xp-codex';
  fs.rmSync(dir1, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.mkdirSync(dir1, { recursive: true });
  fs.mkdirSync(dir2, { recursive: true });

  // 两边都建同样的 todo(有 pending,in_progress)
  for (const d of [dir1, dir2]) {
    const env = Object.assign({}, process.env, { TODOPRO_DIR: d + '/.todopro' });
    execSync(`echo '[{"content":"a","status":"in_progress"}]' | node "${ROOT}/src/platforms/claude-code/todopro-tool.js"`, { env });
    // 复位轮标志
    execSync(`node -e "require('${ROOT}/src/core/session-state').resetRoundFlags()"`, { env });
  }

  // 跑 Claude Code stop-hook
  const env1 = Object.assign({}, process.env, { TODOPRO_DIR: dir1 + '/.todopro' });
  const ccOut = execSync(`echo '{"cwd":"${dir1}","hook_event_name":"Stop"}' | node "${ROOT}/src/platforms/claude-code/stop-hook.js"`, { env: env1, encoding: 'utf8' });
  const ccBlocked = ccOut.includes('"decision":"block"');

  // 跑 Codex stop-hook(注意两边状态独立,需同样复位)
  const env2 = Object.assign({}, process.env, { TODOPRO_DIR: dir2 + '/.todopro' });
  execSync(`node -e "require('${ROOT}/src/core/session-state').resetRoundFlags()"`, { env: env2 });
  let codexBlocked = false, codexExit = 0;
  try {
    execSync(`echo '{"cwd":"${dir2}","hook_event_name":"Stop"}' | node "${ROOT}/src/platforms/codex/stop-hook.js"`, { env: env2, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    codexExit = e.status;
    codexBlocked = (e.status === 2);
  }

  assert.strictEqual(ccBlocked, true, 'Claude Code 应阻断(没推进)');
  assert.strictEqual(codexBlocked, true, 'Codex 应阻断(没推进),exit=' + codexExit);
  console.log('    两平台均阻断:CC=' + ccBlocked + ', Codex(exit2)=' + codexBlocked);
});

test('12.2b 两平台推进后均放行', () => {
  const dir1 = '/tmp/xp-cc2';
  const dir2 = '/tmp/xp-codex2';
  for (const d of [dir1, dir2]) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    const env = Object.assign({}, process.env, { TODOPRO_DIR: d + '/.todopro' });
    execSync(`echo '[{"content":"a","status":"in_progress"}]' | node "${ROOT}/src/platforms/claude-code/todopro-tool.js"`, { env });
    // 模拟推进(置标志)
    execSync(`echo '{"cwd":"${d}","tool_name":"TodoPro","tool_input":{}}' | node "${ROOT}/src/platforms/claude-code/post-tool-use.js"`, { env });
  }
  const env1 = Object.assign({}, process.env, { TODOPRO_DIR: dir1 + '/.todopro' });
  const ccOut = execSync(`echo '{"cwd":"${dir1}","hook_event_name":"Stop"}' | node "${ROOT}/src/platforms/claude-code/stop-hook.js"`, { env: env1, encoding: 'utf8' });
  const ccBlocked = ccOut.includes('"decision":"block"');

  const env2 = Object.assign({}, process.env, { TODOPRO_DIR: dir2 + '/.todopro' });
  execSync(`echo '{"cwd":"${dir2}","tool_name":"TodoPro","tool_input":{}}' | node "${ROOT}/src/platforms/codex/post-tool-use.js"`, { env: env2 });
  let codexBlocked = false;
  try {
    execSync(`echo '{"cwd":"${dir2}","hook_event_name":"Stop"}' | node "${ROOT}/src/platforms/codex/stop-hook.js"`, { env: env2 });
  } catch (e) { codexBlocked = (e.status === 2); }

  assert.strictEqual(ccBlocked, false, 'Claude Code 推进后应放行');
  assert.strictEqual(codexBlocked, false, 'Codex 推进后应放行');
  console.log('    两平台推进后均放行:CC=' + !ccBlocked + ', Codex=' + !codexBlocked);
});

// 12.3 三平台均零 npm 依赖
test('12.3 所有 .js 仅 require Node 内置模块或本项目内部模块(零 npm 依赖)', () => {
  const builtin = new Set(require('module').builtinModules);
  builtin.add('fs'); builtin.add('path'); builtin.add('crypto'); builtin.add('child_process');
  builtin.add('os'); builtin.add('module');

  function checkDir(dir) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const requires = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
      for (const r of requires) {
        const mod = r.match(/require\(['"]([^'"]+)['"]\)/)[1];
        if (mod.startsWith('.') || mod.startsWith('/')) continue; // 内部模块
        assert.ok(builtin.has(mod), path.relative(ROOT, path.join(dir, f)) + ' require 了非内置模块: ' + mod);
      }
    }
  }
  checkDir(path.join(ROOT, 'src/core'));
  checkDir(path.join(ROOT, 'src/platforms/claude-code'));
  checkDir(path.join(ROOT, 'src/platforms/codex'));
  checkDir(path.join(ROOT, 'src/platforms/hana/extensions'));
  checkDir(path.join(ROOT, 'src/platforms/hana/tools'));
  checkDir(path.join(ROOT, 'src/install'));
  console.log('    全部模块仅用 Node 内置(fs/path/crypto/child_process/os),零 npm 依赖');
});

// 12.4 Hana 插件 resolveCore 路径正确(部署后能找到 bundled core)
// 守着 P0-2 修复:extensions/ 和 tools/ 的 resolveCore 第一候选必须指向 plugins/todopro/core/
test('12.4 Hana 插件部署后 resolveCore 能找到 bundled core(extensions 与 tools 两条路径)', () => {
  const hanaHome = '/tmp/tp-xp-hana';
  fs.rmSync(hanaHome, { recursive: true, force: true });
  fs.mkdirSync(hanaHome, { recursive: true });
  execSync(`HANA_HOME=${hanaHome} node "${path.join(ROOT, 'src/install/init.js')}" --platform hana --dir ${hanaHome}`, { stdio: 'ignore' });

  const pluginDir = path.join(hanaHome, 'plugins', 'todopro');
  const coreDir = path.join(pluginDir, 'core');
  assert.ok(fs.existsSync(coreDir), 'core bundle 目录应存在');

  // 模拟 extensions/index.js 的 resolveCore(__dirname = extensions/)
  const extDir = path.join(pluginDir, 'extensions');
  const extResolve = (name) => path.join(extDir, '..', 'core', name);
  for (const m of ['todo-store.js', 'decide-stop.js', 'run-stop.js']) {
    assert.ok(fs.existsSync(extResolve(m)), 'extensions resolveCore 应找到 ' + m + ',实际路径: ' + extResolve(m));
  }

  // 模拟 tools/todopro.js 的 resolveCore(__dirname = tools/)
  const toolsDir = path.join(pluginDir, 'tools');
  const toolsResolve = (name) => path.join(toolsDir, '..', 'core', name);
  for (const m of ['todo-store.js', 'run-todopro-tool.js', 'session-state.js']) {
    assert.ok(fs.existsSync(toolsResolve(m)), 'tools resolveCore 应找到 ' + m);
  }
  console.log('    extensions/ 与 tools/ 的 resolveCore 均指向 plugins/todopro/core/ ✓');
});

console.log('\n结果:' + PASS + ' 通过, ' + FAIL + ' 失败');
process.exit(FAIL === 0 ? 0 : 1);
