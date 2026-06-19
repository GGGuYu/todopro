// tests/closed-loop.test.js
// Claude Code 最小闭环验证(任务组 8)。
// 用 Node 内置 assert 跑,零依赖。模拟 Claude Code 钩子的 stdin payload,
// 验证各场景的输出与副作用。
// 运行:node tests/closed-loop.test.js

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 平台隔离:测试 Claude Code 适配器,文件和内联调用都指向 .todopro/claude-code/
process.env.TODOPRO_PLATFORM = 'claude-code';
let PASS = 0, FAIL = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); PASS++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); FAIL++; }
}

// 调一个钩子脚本,传 stdin JSON,返回 stdout 解析后的对象(或 null 若空)
function hook(script, payload) {
  const cmd = `echo '${JSON.stringify(payload).replace(/'/g, "'\\''")}' | node "${path.join(ROOT, 'src/platforms/claude-code', script)}"`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', env: process.env }).trim();
    return out ? JSON.parse(out) : null;
  } catch (e) {
    throw new Error('hook failed: ' + (e.stdout || e.message));
  }
}
function todoproTool(todosJson) {
  const cmd = `echo '${todosJson.replace(/'/g, "'\\''")}' | node "${path.join(ROOT, 'src/platforms/claude-code/todopro-tool.js')}"`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8', env: process.env }).trim());
}
function fresh(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  process.env.TODOPRO_DIR = path.join(dir, '.todopro');
}
// 平台隔离后,Claude Code 的钩子读写 .todopro/claude-code/ 子目录
const PLATFORM = 'claude-code';
function stateFile() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'session-state.json'), 'utf8')); }
  catch (e) { return null; }
}
function todoExists() {
  return fs.existsSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'todo.json'));
}

const DIR = '/tmp/todopro-test-cl';

console.log('组8:Claude Code 最小闭环验证\n');

// 8.1 小任务零开销:不调 TodoPro 工具时,所有钩子不触发
test('8.1 小任务零开销:无 .todopro 时 Stop 放行(空输出,不阻断)', () => {
  fresh(DIR);
  const out = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' });
  assert.strictEqual(out, null, '应无输出(放行)');
  assert.strictEqual(todoExists(), false, '不应创建 .todopro');
});

// 8.2 循环出口兜底:建 todo 后中途停止不维护 → 阻断四选一
test('8.2 建 todo 后本轮无推进 → 阻断+四选一注入', () => {
  fresh(DIR);
  todoproTool('[{"content":"a","status":"in_progress"}]');
  // 复位本轮标志(模拟新轮次)
  execSync(`node -e "require('${ROOT.replace(/'/g,"'\\''")}/src/core/session-state').resetRoundFlags()"`, { env: process.env });
  const out = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' });
  assert.ok(out && out.decision === 'block', '应 block');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('四个合法出口'), '应含四选一');
});

// 8.3 nudge 熔断:连续没推进 → 第3次交还用户
test('8.3 nudge 熔断:第3次放行交还用户+清理', () => {
  fresh(DIR);
  todoproTool('[{"content":"a","status":"in_progress"}]');
  execSync(`node -e "require('${ROOT.replace(/'/g,"'\\''")}/src/core/session-state').resetRoundFlags()"`, { env: process.env });
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // nudge1 block
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // nudge2 block
  const out = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // 熔断
  assert.ok(out === null || (out && !out.decision), '第3次应放行(无 block)');
  assert.ok(out && out.hookSpecificOutput.additionalContext.includes('交还用户'), '应含交还用户提示');
});

// 8.4 完成 review:全部 completed → 阻断 review 引导 → 起子 agent → 放行+清理
test('8.4 全完成 → review引导 → 起子agent → 放行+清理', () => {
  fresh(DIR);
  todoproTool('[{"content":"a","status":"completed"}]');
  execSync(`node -e "require('${ROOT.replace(/'/g,"'\\''")}/src/core/session-state').resetRoundFlags()"`, { env: process.env });
  const out1 = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' });
  assert.ok(out1 && out1.decision === 'block', '应 block 引导 review');
  assert.ok(out1.hookSpecificOutput.additionalContext.includes('独立 review'), '应含 review 引导');
  // 主 agent 按流程先写 requirement-summary.md(P1-2 残留修复:SubagentStop 检查它存在才算 review)
  fs.writeFileSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'requirement-summary.md'), '需求总结', 'utf8');
  // 模拟起子 agent
  hook('subagent-stop.js', { cwd: DIR, hook_event_name: 'SubagentStop' });
  const out2 = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' });
  assert.ok(!out2.decision, '应放行');
  assert.ok(out2.hookSpecificOutput.additionalContext.includes('已完成本轮独立 review'), '应确认 review 完成');
  // P0-1:review-completed 不立即 cleanup(保留 review_total_count)。需再 Stop 一次(reviewed-exit)才清理
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' });
  assert.strictEqual(todoExists(), false, '应已清理(reviewed-exit 后)');
});

// 8.5 review 熔断:子 agent 糊弄不起 → rv_nudge++ → 熔断
test('8.5 review 熔断:连续不起子agent → 跳过 review', () => {
  fresh(DIR);
  todoproTool('[{"content":"a","status":"completed"}]');
  execSync(`node -e "require('${ROOT.replace(/'/g,"'\\''")}/src/core/session-state').resetRoundFlags()"`, { env: process.env });
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // rv_nudge1
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // rv_nudge2
  const out = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // 熔断
  assert.ok(!out.decision, '应放行');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('跳过'), '应含跳过提示');
});

// 8.6 清理:放行退出后运行时文件删,review-subagent-prompt 保留
test('8.6 清理:删运行时文件', () => {
  fresh(DIR);
  todoproTool('[{"content":"a","status":"completed"}]');
  // 放 review-subagent-prompt.md(预置)
  fs.writeFileSync(path.join(process.env.TODOPRO_DIR, 'review-subagent-prompt.md'), 'rules', 'utf8');
  execSync(`node -e "require('${ROOT.replace(/'/g,"'\\''")}/src/core/session-state').resetRoundFlags()"`, { env: process.env });
  // P1-2:先触发 review-nudge(置 review_pending),写 requirement-summary,再起子 agent(才算 review 子 agent)
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // review-nudge1,置 review_pending
  fs.writeFileSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'requirement-summary.md'), '需求总结', 'utf8');
  hook('subagent-stop.js', { cwd: DIR, hook_event_name: 'SubagentStop' }); // review_pending=true + summary存在 → review_subagent_fired
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // review-completed(不 cleanup,P0-1)
  hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' }); // reviewed-exit → cleanup
  assert.strictEqual(todoExists(), false, 'todo.json 应删');
  assert.strictEqual(fs.existsSync(path.join(process.env.TODOPRO_DIR, 'review-subagent-prompt.md')), true, 'review-subagent-prompt 应保留');
});

// 8.7 优雅退化:模型用内置 TodoWrite 不用 TodoPro → 机制不触发
test('8.7 优雅退化:无 .todopro(用内置todo)→ Stop 不触发任何机制', () => {
  fresh(DIR);
  // 模拟模型用了内置 TodoWrite(不碰我们的 .todopro)
  const out = hook('stop-hook.js', { cwd: DIR, hook_event_name: 'Stop' });
  assert.strictEqual(out, null, '应纯放行无注入');
  assert.strictEqual(todoExists(), false, '不应有 .todopro');
  // PostToolUse 编辑类工具:无活跃会话 → 不记 touched-files
  hook('post-tool-use.js', { cwd: DIR, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/tmp/x.js' } });
  assert.strictEqual(fs.existsSync(path.join(process.env.TODOPRO_DIR, PLATFORM, 'touched-files.json')), false, '无活跃会话不应记 touched-files');
});

console.log('\n结果:' + PASS + ' 通过, ' + FAIL + ' 失败');
process.exit(FAIL === 0 ? 0 : 1);
