// src/core/todo-store.js
// 平台无关:TodoPro todo 存储。唯一真相源 .todopro/todo.json。
// 语义:全量替换(模仿内置 TodoWrite,模型零学习成本)+ 扩展 status + 稳定 id。
// 仅用 Node 内置模块(零依赖)。
//
// spec: todo-pro-tool
//   - 全量替换覆盖旧列表,返回 oldTodos
//   - status: pending | in_progress | completed | paused | abandoned
//   - 同一时刻最多 1 个 in_progress(校验失败抛错)
//   - 稳定 id(新增项给未使用 id)
//   - updated_at 由本模块回填(模型不用管)
//   - 落盘到 .todopro/todo.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths } = require('./paths');

const VALID_STATUS = new Set(['pending', 'in_progress', 'completed', 'paused', 'abandoned']);
const VALID_PRIORITY = new Set(['high', 'medium', 'low']);

function nowIso() {
  return new Date().toISOString();
}

// 生成稳定 id:用计数器 + 短 hash,保证同会话内不重复且可读。
// 形如 t1, t2, ... 优先用自然序号(找当前最大序号 +1)。
function nextId(existingTodos) {
  let max = 0;
  for (const t of existingTodos) {
    const m = /^t(\d+)$/.exec(t.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `t${max + 1}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 读取当前 todo.json。不存在返回 null(无会话)。
function read(dir) {
  const p = paths(dir);
  try {
    const raw = fs.readFileSync(p.todoJson, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// 判断是否为活跃会话(有 todo.json 且 session 未 paused/abandoned/completed)。
// 供 Stop 钩子 early-exit 用。
function isActiveSession(dir) {
  const data = read(dir);
  if (!data) return false;
  const st = (data.session && data.session.status) || 'active';
  return st === 'active';
}

// 全量替换:接收新 todos 数组,写盘,返回 { data, oldTodos }。
// 校验:status/priority 合法、最多 1 个 in_progress、id 稳定。
// 模型可传 id(保留)或不传(分配新 id)。
//
// newTodos: [{ id?, content, status, priority }]
// sessionPatch: 可选,合并进 session(钩子用,如设 review_done)
function replace(dir, newTodos, sessionPatch) {
  const p = paths(dir);
  const existing = read(dir);
  const oldTodos = existing ? existing.todos : [];
  const oldById = new Map();
  for (const t of oldTodos) oldById.set(t.id, t);

  // 校验 + 归一化
  let inProgressCount = 0;
  const usedIds = new Set();
  const normalized = [];
  for (const t of newTodos || []) {
    const status = (t.status || 'pending').toLowerCase();
    if (!VALID_STATUS.has(status)) {
      throw new Error(`invalid status: ${t.status}`);
    }
    const priority = (t.priority || 'medium').toLowerCase();
    if (!VALID_PRIORITY.has(priority)) {
      throw new Error(`invalid priority: ${t.priority}`);
    }
    if (status === 'in_progress') inProgressCount++;

    // id 处理:模型传了就用(若未冲突),没传就分配
    let id = t.id;
    if (id && !usedIds.has(id) && oldById.has(id)) {
      // 保留旧 id
    } else if (id && !usedIds.has(id)) {
      // 模型新增但带了 id,接受(只要不冲突)
    } else {
      id = nextId([...oldTodos, ...normalized]);
    }
    usedIds.add(id);

    // updated_at 回填:仅当该项相对旧版发生变更(status/content/priority 变)才更新
    const old = oldById.get(id);
    const changed = !old ||
      old.status !== status ||
      old.content !== t.content ||
      old.priority !== priority;
    const updated_at = changed ? nowIso() : (old && old.updated_at) || nowIso();

    normalized.push({
      id,
      content: String(t.content || ''),
      status,
      priority,
      updated_at,
    });
  }

  if (inProgressCount > 1) {
    throw new Error('At most one todo can be in_progress');
  }

  ensureDir(p.root);
  const data = {
    version: 1,
    created_at: (existing && existing.created_at) || nowIso(),
    todos: normalized,
    session: Object.assign(
      { status: 'active', review_done: false, nudge_count: 0, review_nudge_count: 0 },
      existing && existing.session ? existing.session : {},
      sessionPatch || {}
    ),
  };
  fs.writeFileSync(p.todoJson, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { data, oldTodos };
}

// 查询便利方法
function allCompleted(data) {
  if (!data || !data.todos || data.todos.length === 0) return false;
  return data.todos.every(t => t.status === 'completed');
}

function hasPending(data) {
  if (!data || !data.todos) return false;
  return data.todos.some(t => t.status === 'pending' || t.status === 'in_progress');
}

module.exports = {
  read,
  replace,
  isActiveSession,
  allCompleted,
  hasPending,
  VALID_STATUS,
  // 导出供测试
  _nextId: nextId,
};
