// src/core/touched-files.js
// 平台无关:PostToolUse(编辑类工具)在监护期间自动记录被碰过的文件路径到
// .todopro/touched-files.json(去重)。事实记录,不依赖模型。
// 仅用 Node 内置模块(零依赖)。
//
// spec: file-tracking
//   - 钩子自动记录编辑过的文件(Write/Edit/Bash 写),不记读操作(Read/Grep/Glob)
//   - 非监护期间不记录

const fs = require('fs');
const path = require('path');
const { paths } = require('./paths');
const todoStore = require('./todo-store');

// 判断哪些工具算"编辑类"。平台适配层把工具名归一化后传这里。
// 编辑类:写/改/删文件的操作。读操作不记。
const EDIT_TOOL_PATTERNS = [
  /^write$/i, /^edit$/i, /^multi_edit$/i,
  /^bash$/i,            // bash 可能写文件(由调用方传 file_path 提取)
  /^create$/i, /^save$/i,
];

function isEditTool(toolName) {
  if (!toolName) return false;
  return EDIT_TOOL_PATTERNS.some(re => re.test(toolName));
}

// 从工具调用里提取涉及的文件路径。不同工具参数名不同,尽力提取。
// input: 工具的输入对象(归一化后)
function extractFilePaths(toolName, input) {
  if (!input) return [];
  const out = [];
  // Write/Edit/MultiEdit: file_path
  if (input.file_path) out.push(String(input.file_path));
  // MultiEdit: edits[].file_path 或 file_path
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (e.file_path) out.push(String(e.file_path));
    }
  }
  // bash: 尝试从命令里提取重定向目标(尽力,不完美)
  if (/bash/i.test(toolName) && typeof input.command === 'string') {
    // > file 或 >> file
    const re = />{1,2}\s*([^\s|&;]+)/g;
    let m;
    while ((m = re.exec(input.command)) !== null) {
      out.push(m[1]);
    }
  }
  return out;
}

function read(dir) {
  const p = paths(dir);
  try {
    const raw = fs.readFileSync(p.touchedFiles, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return { files: [] };
    throw e;
  }
}

// 追加文件路径(去重,相对 cwd 规范化)。只在监护期间(活跃会话)记录,
// 且仅记录编辑类工具(spec: 只记编辑类不记读操作)。
function record(dir, toolName, input) {
  // 只在活跃会话记录(spec: 非监护期间不记录)
  if (!todoStore.isActiveSession(dir)) return;
  // 只记编辑类工具(spec: 读操作不记录)
  if (!isEditTool(toolName)) return;

  const filePaths = extractFilePaths(toolName, input);
  if (filePaths.length === 0) return;

  const data = read(dir);
  const set = new Set(data.files || []);
  for (const f of filePaths) {
    // 规范化为相对 cwd 的路径(若可解析)
    let rel = f;
    try {
      rel = path.relative(process.cwd(), path.resolve(f));
      if (rel === '') rel = f;
    } catch (e) { rel = f; }
    set.add(rel);
  }
  data.files = Array.from(set).sort();
  const p = paths(dir);
  fs.mkdirSync(p.root, { recursive: true });
  fs.writeFileSync(p.touchedFiles, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

module.exports = { record, read, isEditTool, extractFilePaths, EDIT_TOOL_PATTERNS };
