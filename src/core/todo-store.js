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

  // P0-H3:pause 恢复。若会话之前是 paused,且本次调用没显式设 paused/abandoned
  // (即模型在做维护——传了新 todos,不是在 pause/abandon),自动恢复成 active。
  // 这让 pause 不再是单向永久状态:模型再次维护 todo 即恢复监护。
  const prevStatus = existing && existing.session ? existing.session.status : 'active';
  const patchStatus = sessionPatch && sessionPatch.status;
  const resumedStatus = (prevStatus === 'paused' && patchStatus !== 'paused' && patchStatus !== 'abandoned')
    ? 'active' : prevStatus;

  // P1-H6:session 只保留 status(计数字段 nudge_count/review_nudge_count/review_done
  // 由独立的 session-state.json 维护,这里的死值会误导人/review 子 agent,删掉)。
  const data = {
    version: 1,
    created_at: (existing && existing.created_at) || nowIso(),
    todos: normalized,
    session: {
      status: patchStatus || resumedStatus || 'active',
    },
  };
  fs.writeFileSync(p.todoJson, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // P1-4:全量替换若静默删除了旧项,给调用方一个 warning。
  // P1-4 残留修复:条件用 removedIds.length > 0(比 oldTodos.length > normalized.length 更准,
  // 处理"删了又加"总数相等但仍删了项的场景)。
  let warning = null;
  if (oldTodos.length > 0) {
    const removedIds = oldTodos
      .filter(t => !usedIds.has(t.id))
      .map(t => t.id);
    if (removedIds.length > 0) {
      warning = '注意:本次全量替换删除了 ' + removedIds.length + ' 个旧 todo 项(id: ' +
        removedIds.join(', ') + ')。若非有意,请确认是否漏带了这些项——' +
        'TodoPro 落盘且被钩子追踪,漏带会导致进度数据残缺。';
    }
  }

  return { data, oldTodos, warning };
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
};
