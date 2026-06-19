// tests/hana-plugin.test.js
// Hana 插件真实路径验证:require extensions/index.js(传 mock pi),
// 断言 registerTool 被调用、handler 能跑、action 出口能走通。
//
// 这套测试针对 P0 review:
//   H1: tools/todopro.js 从未被调用(死代码)→ extensions 应调 registerTool
//   H2: handler 不支持 action 出口 → handler 应处理 action
//   H5: cross-platform 12.4 用"文件存在"冒充"功能可用"→ 本测试真 require 真执行
//
// 运行:node tests/hana-plugin.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
// 支持 async 测试:返回 Promise 时等待,捕获 rejection 计为失败。
// 同步测试在 try/catch 里直接判定,不重复打印。
function test(name, fn) {
  let result;
  try {
    result = fn();
  } catch (e) {
    console.log('  ✗ ' + name + '\n    ' + e.message); FAIL++;
    return Promise.resolve();
  }
  if (result && typeof result.then === 'function') {
    // async 测试:等待 Promise,成功标 PASS,rejection 标 FAIL
    return result.then(
      () => { console.log('  ✓ ' + name); PASS++; },
      (e) => { console.log('  ✗ ' + name + '\n    ' + (e.message || e)); FAIL++; }
    );
  }
  // 同步测试没抛错 = 通过
  console.log('  ✓ ' + name); PASS++;
  return Promise.resolve();
}

console.log('Hana 插件真实路径验证\n');

(async () => {
  // 用真实安装的插件目录(模拟部署态)
  const HANA_HOME = '/tmp/tp-hana-realtest';

  function freshInstall() {
    fs.rmSync(HANA_HOME, { recursive: true, force: true });
    fs.mkdirSync(HANA_HOME, { recursive: true });
    execSync(`HANA_HOME=${HANA_HOME} node "${path.join(ROOT, 'src/install/init.js')}" --platform hana --dir ${HANA_HOME}`,
      { stdio: 'ignore' });
    return path.join(HANA_HOME, 'plugins', 'todopro');
  }

  // mock pi 对象:记录 registerTool 调用、捕获事件回调、提供 sendUserMessage
  function makeMockPi() {
    const pi = {
      cwd: HANA_HOME,
      _eventHandlers: {},
      _registeredTools: [],
      _sentMessages: [],
      on(event, handler) { this._eventHandlers[event] = handler; },
      registerTool(toolDef) { this._registeredTools.push(toolDef); },
      sendUserMessage(text, opts) { this._sentMessages.push({ text, opts }); },
    };
    return pi;
  }

  await test('H1: extensions/index.js 加载时调用 registerTool(模型能看到 TodoPro 工具)', () => {
    const pluginDir = freshInstall();
    const indexPath = path.join(pluginDir, 'extensions', 'index.js');
    assert.ok(fs.existsSync(indexPath), 'extensions/index.js 应存在');
    delete require.cache[require.resolve(indexPath)];
    const pi = makeMockPi();
    const factory = require(indexPath);
    assert.strictEqual(typeof factory, 'function', 'extensions/index.js 应导出工厂函数');
    factory(pi);
    assert.ok(pi._registeredTools.length > 0, '应调用 registerTool 注册至少一个工具,实际: ' + pi._registeredTools.length);
    const tool = pi._registeredTools[0];
    assert.strictEqual(tool.name, 'TodoPro', '注册的工具名应为 TodoPro');
    assert.strictEqual(typeof tool.handler, 'function', '工具应有 handler 函数');
  });

  await test('H2: handler 支持 todos 维护出口', async () => {
    const pluginDir = freshInstall();
    const indexPath = path.join(pluginDir, 'extensions', 'index.js');
    delete require.cache[require.resolve(indexPath)];
    process.env.TODOPRO_DIR = path.join(HANA_HOME, '.todopro');
    fs.rmSync(process.env.TODOPRO_DIR, { recursive: true, force: true });
    const pi = makeMockPi();
    pi.cwd = HANA_HOME;
    require(indexPath)(pi);
    assert.ok(pi._registeredTools.length > 0, '工具应已注册');
    const tool = pi._registeredTools[0];
    const result = await tool.handler({ todos: [{ content: 'task A', status: 'in_progress' }] }, { cwd: HANA_HOME });
    assert.ok(result.ok, '维护出口应 ok,实际: ' + JSON.stringify(result));
    assert.ok(result.todos && result.todos.length === 1, '应返回 todos');
  });

  await test('H2: handler 支持 action 出口(pause/abandon/acknowledge_stall)', async () => {
    const pluginDir = freshInstall();
    const indexPath = path.join(pluginDir, 'extensions', 'index.js');
    delete require.cache[require.resolve(indexPath)];
    process.env.TODOPRO_DIR = path.join(HANA_HOME, '.todopro');
    fs.rmSync(process.env.TODOPRO_DIR, { recursive: true, force: true });
    const pi = makeMockPi();
    pi.cwd = HANA_HOME;
    require(indexPath)(pi);
    assert.ok(pi._registeredTools.length > 0, '工具应已注册');
    const tool = pi._registeredTools[0];

    // 先建一个 todo(否则 pause 无会话)
    await tool.handler({ todos: [{ content: 'a', status: 'in_progress' }] }, { cwd: HANA_HOME });

    // pause
    let r = await tool.handler({ action: 'pause' }, { cwd: HANA_HOME });
    assert.ok(r.ok, 'pause 应 ok,实际: ' + JSON.stringify(r));
    assert.strictEqual(r.action, 'pause', '应返回 action=pause,实际: ' + r.action);

    // abandon
    fs.rmSync(process.env.TODOPRO_DIR, { recursive: true, force: true });
    await tool.handler({ todos: [{ content: 'a', status: 'in_progress' }] }, { cwd: HANA_HOME });
    r = await tool.handler({ action: 'abandon' }, { cwd: HANA_HOME });
    assert.ok(r.ok, 'abandon 应 ok');
    assert.strictEqual(r.action, 'abandon');

    // acknowledge_stall
    fs.rmSync(process.env.TODOPRO_DIR, { recursive: true, force: true });
    await tool.handler({ todos: [{ content: 'a', status: 'in_progress' }] }, { cwd: HANA_HOME });
    r = await tool.handler({ action: 'acknowledge_stall' }, { cwd: HANA_HOME });
    assert.ok(r.ok, 'acknowledge_stall 应 ok');
    assert.strictEqual(r.action, 'acknowledge_stall');
  });

  await test('H1: schema 应同时支持 todos 和 action(不互斥 required)', () => {
    const pluginDir = freshInstall();
    const indexPath = path.join(pluginDir, 'extensions', 'index.js');
    delete require.cache[require.resolve(indexPath)];
    const pi = makeMockPi();
    require(indexPath)(pi);
    assert.ok(pi._registeredTools.length > 0, '工具应已注册');
    const tool = pi._registeredTools[0];
    const props = tool.parameters.properties;
    assert.ok(props.todos, 'schema 应有 todos 字段');
    assert.ok(props.action, 'schema 应有 action 字段');
    const req = tool.parameters.required || [];
    assert.ok(!req.includes('todos') || !req.includes('action'), 'todos 和 action 不应同时 required');
  });

  console.log('\n结果:' + PASS + ' 通过, ' + FAIL + ' 失败');
  process.exit(FAIL === 0 ? 0 : 1);
})();
