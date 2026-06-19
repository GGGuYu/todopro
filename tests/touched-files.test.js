// tests/touched-files.test.js
// extractFilePaths 单元测试(P3-2):各工具的文件路径提取。
// 重点覆盖 apply_patch(P1-1 修复:从 patch 字符串提取)。
// 运行:node tests/touched-files.test.js

const assert = require('assert');
const { extractFilePaths, isEditTool } = require('../src/core/touched-files');

let PASS = 0, FAIL = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); PASS++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); FAIL++; }
}

console.log('extractFilePaths 单元测试\n');

test('Write: file_path 提取', () => {
  assert.deepStrictEqual(
    extractFilePaths('Write', { file_path: '/tmp/foo.js' }),
    ['/tmp/foo.js']
  );
});

test('Edit: file_path 提取', () => {
  assert.deepStrictEqual(
    extractFilePaths('Edit', { file_path: 'src/bar.ts' }),
    ['src/bar.ts']
  );
});

test('MultiEdit: file_path + edits[].file_path', () => {
  assert.deepStrictEqual(
    extractFilePaths('MultiEdit', { file_path: 'a.js', edits: [{ file_path: 'b.js' }, { file_path: 'c.js' }] }),
    ['a.js', 'b.js', 'c.js']
  );
});

test('apply_patch: +++ b/<path> 提取(P1-1)', () => {
  const patch = '--- a/src/foo.js\n+++ b/src/foo.js\n@@\n-old\n+new\n--- a/src/bar.js\n+++ b/src/bar.js\n@@\n-old\n+new';
  assert.deepStrictEqual(
    extractFilePaths('apply_patch', { patch }),
    ['src/foo.js', 'src/bar.js']
  );
});

test('apply_patch: *** Add/Delete File 提取(Codex 格式)', () => {
  const patch = '*** Begin Patch\n*** Add File: src/new.js\n+new content\n*** Delete File: src/old.js\n*** End Patch';
  assert.deepStrictEqual(
    extractFilePaths('apply_patch', { patch }),
    ['src/new.js', 'src/old.js']
  );
});

test('apply_patch: 无路径行 → 空数组', () => {
  assert.deepStrictEqual(
    extractFilePaths('apply_patch', { patch: 'some content without paths' }),
    []
  );
});

test('isEditTool: 识别编辑类工具', () => {
  assert.strictEqual(isEditTool('Write'), true);
  assert.strictEqual(isEditTool('Edit'), true);
  assert.strictEqual(isEditTool('apply_patch'), true);
  assert.strictEqual(isEditTool('Read'), false);
  assert.strictEqual(isEditTool('Bash'), false);
  assert.strictEqual(isEditTool('create'), false);  // P2-4: 已删
  assert.strictEqual(isEditTool('save'), false);    // P2-4: 已删
});

test('无 input → 空数组', () => {
  assert.deepStrictEqual(extractFilePaths('Write', null), []);
  assert.deepStrictEqual(extractFilePaths('Write', undefined), []);
});

console.log('\n结果:' + PASS + ' 通过, ' + FAIL + ' 失败');
process.exit(FAIL === 0 ? 0 : 1);
