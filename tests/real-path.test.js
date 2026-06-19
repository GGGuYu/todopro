// tests/real-path.test.js
// 真实路径验证:模拟模型经 Bash 工具调用 TodoPro 脚本(不绕过"模型怎么调到工具"这层)。
//
// 这套测试针对 review 指出的 P0 问题:Claude Code/Codex 上 TodoPro 不是注册工具,
// 模型靠 Bash 调脚本。验证整条链路:
//   模型用 Bash 工具跑 `node todopro-tool.js '<json>'`
//   → Claude Code 触发 PostToolUse(Bash matcher)
//   → post-tool-use.js 从 command 识别出 todopro-tool → 置推进标志
//   → Stop 钩子读到推进标志 → 放行
//
// 关键:测试不直接调 todopro-tool.js,而是模拟"模型用 Bash 工具"——
// 先真实执行 bash 命令(让脚本写盘),再发 PostToolUse(Bash) 事件让钩子识别。
// 运行:node tests/real-path.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// 平台隔离:测试 Claude Code 适配器,文件和内联调用都指向 .todopro/claude-code/
process.env.TODOPRO_PLATFORM = 'claude-code';
const PLATFORM = 'claude-code';
let PASS = 0, FAIL = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); PASS++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); FAIL++; }
}

// 模拟模型用 Bash 工具调用 TodoPro 脚本(真实执行 + 触发 PostToolUse)。
// payload 是要传给脚本的 JSON。返回脚本 stdout。
function modelCallsTodoProViaBash(dir, payload) {
  const script = path.join(ROOT, 'src/platforms/claude-code/todopro-tool.js');
  const payloadJson = JSON.stringify(payload);
  // 1. 真实执行 bash 命令(模型会这么做)
  const cmd = `echo '${payloadJson.replace(/'/g, "'\\''")}' | node "${script}"`;
  const stdout = execSync(cmd, { encoding: 'utf8', env: process.env });
  // 2. 模拟 Claude Code 触发 PostToolUse(Bash matcher),command 就是上面那条
  const ptuPayload = {
    cwd: dir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: cmd },
  };
  execSync(`echo '${JSON.stringify(ptuPayload).replace(/'/g, "'\\''")}' | node "${path.join(ROOT, 'src/platforms/claude-code/post-tool-use.js')}"`, { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
  return stdout;
}

function stopHook(dir) {
  const cmd = `echo '{"cwd":"${dir}","hook_event_name":"Stop"}' | node "${path.join(ROOT, 'src/platforms/claude-code/stop-hook.js')}"`;
  try {
    return execSync(cmd, { encoding: 'utf8', env: process.env }).trim();
  } catch (e) { return e.stdout || ''; }
}
function subagentStop(dir) {
  const cmd = `echo '{"cwd":"${dir}","hook_event_name":"SubagentStop"}' | node "${path.join(ROOT, 'src/platforms/claude-code/subagent-stop.js')}"`;
  execSync(cmd, { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
}
function resetRound() {
  execSync(`node -e "require('${ROOT.replace(/'/g, "'\\''")}/src/core/session-state').resetRoundFlags()"`, { env: process.env });
}
function fresh(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  process.env.TODOPRO_DIR = path.join(dir, '.todopro');
}
function sessionStatus() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'todo.json'), 'utf8')).session.status; }
  catch (e) { return null; }
}

const DIR = '/tmp/tp-realpath';
console.log('真实路径验证(模型经 Bash 调用,不绕过)\n');

// R1:模型经 Bash 建 todo → PostToolUse 识别 → 推进标志置位 → Stop 放行
test('R1 模型经 Bash 调 todopro-tool 建 todo → Stop 放行(推进标志被识别)', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  const out = stopHook(DIR);
  // 推进了 → 放行(无 block)
  assert.ok(!out.includes('"decision":"block"'), '推进了应放行,但被阻断。output: ' + out);
});

// R2:本轮没调 TodoPro(只干了别的)→ Stop 阻断四选一
test('R2 本轮没调 TodoPro 脚本 → Stop 阻断+四选一(提示词含 Bash 调用说明)', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  resetRound(); // 新一轮,本轮还没调 TodoPro
  const out = stopHook(DIR);
  assert.ok(out.includes('"decision":"block"'), '没推进应阻断');
  assert.ok(out.includes('todopro-tool.js'), '四选一提示应教 Bash 调用脚本');
  assert.ok(out.includes('pause'), '提示应含 pause 出口');
  assert.ok(out.includes('acknowledge_stall'), '提示应含 acknowledge_stall 出口');
});

// R3:被 nudge 后,模型用 Bash 调 acknowledge_stall → 推进 → 放行
test('R3 被nudge后模型经 Bash 调 acknowledge_stall → 放行(session仍 active)', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  resetRound();
  stopHook(DIR); // nudge1
  // 模型选择 acknowledge_stall
  modelCallsTodoProViaBash(DIR, { action: 'acknowledge_stall' });
  const out = stopHook(DIR);
  assert.ok(!out.includes('"decision":"block"'), 'acknowledge_stall 后应放行');
  assert.strictEqual(sessionStatus(), 'active', 'acknowledge_stall 不应改 session.status');
});

// R4:模型用 Bash 调 pause → session.status=paused → Stop 放行(不再监护)
test('R4 模型经 Bash 调 pause → session.paused → Stop 放行不监护', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  modelCallsTodoProViaBash(DIR, { action: 'pause' });
  assert.strictEqual(sessionStatus(), 'paused', 'pause 后 session 应 paused');
  resetRound();
  const out = stopHook(DIR);
  assert.ok(!out.includes('"decision":"block"'), 'paused 应放行不监护');
});

// R5:模型用 Bash 调 abandon → session.abandoned → Stop 放行+清理
test('R5 模型经 Bash 调 abandon → session.abandoned → Stop 放行+清理', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  modelCallsTodoProViaBash(DIR, { action: 'abandon' });
  assert.strictEqual(sessionStatus(), 'abandoned');
  const out = stopHook(DIR);
  assert.ok(!out.includes('"decision":"block"'), 'abandoned 应放行');
  assert.ok(!fs.existsSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'todo.json')), 'abandoned 应清理 todo.json');
});

// R6:普通 Bash 命令(不是调 todopro-tool)不应置推进标志
test('R6 普通 Bash 命令(非 todopro-tool)不置推进标志 → Stop 仍判定没推进', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  resetRound();
  // 模拟模型跑了个普通 bash 命令(如 npm test)
  const ptuPayload = {
    cwd: DIR, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  };
  execSync(`echo '${JSON.stringify(ptuPayload).replace(/'/g, "'\\''")}' | node "${path.join(ROOT, 'src/platforms/claude-code/post-tool-use.js')}"`, { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
  const out = stopHook(DIR);
  assert.ok(out.includes('"decision":"block"'), '普通 bash 不算推进,应阻断');
});

// R7:全完成 → review 引导 → 模型起子 agent → 放行+清理(全经 Bash)
test('R7 全完成经 Bash → review引导 → 子agent → 放行+清理', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'completed' }] });
  resetRound();
  const out1 = stopHook(DIR);
  assert.ok(out1.includes('"decision":"block"'), '应阻断引导 review');
  assert.ok(out1.includes('独立 review'), '应含 review 引导');
  // out1 阻断时置了 review_pending。主 agent 按流程先写 requirement-summary.md 再起 review 子 agent
  fs.writeFileSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'requirement-summary.md'), '需求总结', 'utf8');
  subagentStop(DIR);
  const out2 = stopHook(DIR);
  assert.ok(!out2.includes('"decision":"block"'), 'review子agent后应放行');
  // P0-1:review-completed 不立即 cleanup(保留 review_total_count)。再 Stop 一次(reviewed-exit)才清理
  stopHook(DIR);
  assert.ok(!fs.existsSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'todo.json')), '应清理(reviewed-exit 后)');
});

// R9:P1-2 回归——非 review 轮起的子 agent 不算 review 完成
test('R9 全完成但未触发review引导时起的探索子agent → 不算review完成(仍阻断)', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'completed' }] });
  resetRound();
  // 本轮先起了一个探索子 agent(不经 review 引导,review_pending=false)
  subagentStop(DIR);
  // Stop:应仍阻断引导 review(探索子 agent 不算 review 子 agent)
  const out = stopHook(DIR);
  assert.ok(out.includes('"decision":"block"'), '非review子agent不应算review完成,应仍阻断');
  assert.ok(out.includes('独立 review'), '应引导 review');
});

// R8:优雅退化——模型用内置 TodoWrite(不经我们的脚本)→ 机制完全不触发
test('R8 模型用内置 TodoWrite 不调我们的脚本 → 无 .todopro → Stop 纯放行', () => {
  fresh(DIR);
  // 模拟模型用了内置 TodoWrite(完全不碰我们的脚本)
  const out = stopHook(DIR);
  assert.strictEqual(out.trim(), '', '无 .todopro 应纯放行无输出');
  assert.ok(!fs.existsSync(process.env.TODOPRO_DIR), '不应创建 .todopro');
});

// R10:P1-2 残留——review 引导后起子 agent 会被误判(已知限制,靠提示词约束 + 熔断)
// 记录这个限制:review_pending=true 时任何子 agent 都算 review。reviewGuide 提示词约束"只起 review 子 agent"。
test('R10 review引导后起子agent(已写requirement-summary)→ 算review完成', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'completed' }] });
  resetRound();
  const out1 = stopHook(DIR); // review-nudge → review_pending=true
  assert.ok(out1.includes('独立 review'), '应引导 review');
  assert.ok(out1.includes('只起这一个 review 子 agent'), '提示词应约束只起 review 子 agent');
  // 主 agent 先写了 requirement-summary.md(review 流程正确)
  fs.writeFileSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'requirement-summary.md'), '需求总结', 'utf8');
  // review_pending=true 时起子 agent → 算 review 完成
  subagentStop(DIR);
  const out2 = stopHook(DIR);
  assert.ok(!out2.includes('"decision":"block"'), '写了summary+起子agent应算 review 完成');
});

// R10b:P1-2 残留真修复——review 引导后没写 requirement-summary 就起子 agent → 不算 review(仍阻断)
// SubagentStop 检查 requirement-summary.md 存在才置 review_subagent_fired。
test('R10b review引导后没写requirement-summary就起子agent → 不算review完成(仍阻断)', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'completed' }] });
  resetRound();
  stopHook(DIR); // review-nudge → review_pending=true
  // 主 agent 没写 requirement-summary.md 就起了子 agent(跳步/探索)
  subagentStop(DIR);
  const out = stopHook(DIR);
  assert.ok(out.includes('"decision":"block"'), '没写summary就起子agent不应算review完成,应仍阻断');
});

// R11:H4 回归——字面字符串(grep todopro-tool.js)不应被误判为推进
test('R11 grep/cat 含 todopro-tool.js 字面字符串 → 不算推进(正则要求 node 调用)', () => {
  fresh(DIR);
  modelCallsTodoProViaBash(DIR, { todos: [{ content: 'a', status: 'in_progress' }] });
  resetRound();
  // 模拟跑了个 grep 命令(含 todopro-tool.js 字符串,但不是 node 调用)
  const ptuPayload = {
    cwd: DIR, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'grep -r todopro-tool.js .' },
  };
  execSync(`echo '${JSON.stringify(ptuPayload).replace(/'/g, "'\\''")}' | node "${path.join(ROOT, 'src/platforms/claude-code/post-tool-use.js')}"`, { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
  const out = stopHook(DIR);
  assert.ok(out.includes('"decision":"block"'), 'grep 不算推进,应阻断');
});

console.log('\n结果:' + PASS + ' 通过, ' + FAIL + ' 失败');
process.exit(FAIL === 0 ? 0 : 1);
