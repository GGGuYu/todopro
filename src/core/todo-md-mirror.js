// src/core/todo-md-mirror.js
// 平台无关:todo.json 变更后生成只读 todo.md 镜像(checkbox 格式)。
// 供人和模型查看,模型不应直接编辑(编辑改 todo.json)。
// 仅用 Node 内置模块(零依赖)。
//
// spec: todo-pro-tool / 只读 Markdown 镜像自动生成

const fs = require('fs');
const { paths } = require('./paths');

const STATUS_CHECK = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
  paused: '[=]',
  abandoned: '[-]',
};

const PRIORITY_LABEL = { high: 'HIGH', medium: '', low: 'low' };

// 从 todo.json 生成 todo.md。data 为已读取的 todo.json 对象。
function generate(dir, data) {
  if (!data) return;
  const p = paths(dir);
  const lines = [];
  lines.push('# TodoPro — 当前进度');
  lines.push('');
  lines.push('> 此文件由 TodoPro 自动生成,只读。修改请用 TodoPro 工具(改 .todopro/todo.json)。');
  lines.push('');

  const session = data.session || {};
  if (session.status && session.status !== 'active') {
    lines.push(`> **会话状态:${session.status}**`);
    lines.push('');
  }

  if (!data.todos || data.todos.length === 0) {
    lines.push('_(无 todo 项)_');
  } else {
    for (const t of data.todos) {
      const chk = STATUS_CHECK[t.status] || '[ ]';
      const prio = PRIORITY_LABEL[t.priority] || '';
      const prioStr = prio ? ` **${prio}**` : '';
      lines.push(`- ${chk}${prioStr} \`${t.id}\` ${t.content}`);
    }
  }

  lines.push('');
  fs.writeFileSync(p.todoMd, lines.join('\n'), 'utf8');
}

module.exports = { generate, STATUS_CHECK };
