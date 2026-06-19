## ADDED Requirements

### Requirement: TodoPro 工具采用全量替换语义
TodoPro 工具 SHALL 采用全量替换语义:每次调用把整个 todo 列表发全,覆盖上一份 `.todopro/todo.json`。这是为了与内置 TodoWrite 语义一致,让模型零学习成本。

#### Scenario: 全量替换覆盖旧列表
- **WHEN** Agent 调用 TodoPro 工具传入一个新的完整 todos 数组
- **THEN** 系统 SHALL 用新数组完全覆盖 `.todopro/todo.json` 的 `todos` 字段,旧数据不保留(除 session 字段由钩子维护)

#### Scenario: 工具返回上一版供模型对照
- **WHEN** Agent 调用 TodoPro 工具
- **THEN** 系统 SHALL 在工具返回中包含 `oldTodos`(上一版列表),供模型对照变化

### Requirement: TodoPro 扩展 todo 状态
TodoPro SHALL 支持 5 种 status:`pending`、`in_progress`、`completed`、`paused`、`abandoned`。前三种与内置一致,后两种为本工具扩展。

#### Scenario: 暂停整个会话监护
- **WHEN** Agent 把 session.status 设为 `paused`(或所有 todo 设 paused)
- **THEN** 系统 SHALL 停止循环出口兜底监护,直到 Agent 显式恢复

#### Scenario: 放弃整个会话
- **WHEN** Agent 把 session.status 设为 `abandoned`
- **THEN** 系统 SHALL 视为 Agent 显式撤销本次需求,放行退出,不再监护

### Requirement: 同一时刻最多一个 in_progress
TodoPro SHALL 强制约束:同一时刻最多 1 个 todo 的 status 为 `in_progress`。

#### Scenario: 拒绝多个 in_progress
- **WHEN** Agent 传入的 todos 数组中存在 2 个或更多 `in_progress` 项
- **THEN** 系统 SHALL 拒绝该次写入并返回校验错误,提示"同一时刻最多一个 in_progress"

### Requirement: 稳定 id 跨全量替换追踪单项
TodoPro SHALL 为每个 todo 分配稳定 `id`(如 t1/t2/t3),id 在全量替换中保持稳定,使钩子能 diff 出单项变更。

#### Scenario: id 稳定支持 diff
- **WHEN** Agent 全量替换时保留某项的 id 不变但改了其 status
- **THEN** 钩子 SHALL 能通过对比新旧 JSON 的同 id 项,识别出该项 status 发生了变更

#### Scenario: 新增项获得新 id
- **WHEN** Agent 在全量替换中新增一项(未指定 id)
- **THEN** 系统 SHALL 为该项分配一个未使用的新 id

### Requirement: 状态落盘到 .todopro 目录
TodoPro SHALL 将 todo 状态落盘到 `.todopro/todo.json`,作为唯一真相源。内置 todo 不落盘,这是本工具的增量价值。

#### Scenario: 落盘供钩子跨调用读取
- **WHEN** Agent 调用 TodoPro 工具写入新状态
- **THEN** 系统 SHALL 立即将新状态持久化到 `.todopro/todo.json`,供后续 Stop/PostToolUse 钩子读取

### Requirement: 只读 Markdown 镜像自动生成
系统 SHALL 在 `.todopro/todo.json` 每次变更后,自动生成只读的 `.todopro/todo.md` 镜像,供人和模型查看。

#### Scenario: JSON 变更后 MD 镜像同步
- **WHEN** `.todopro/todo.json` 被写入新内容
- **THEN** 系统 SHALL 重新生成 `.todopro/todo.md`,反映最新 todo 列表与状态,且该文件标记为只读(模型不应直接编辑)

### Requirement: updated_at 由钩子回填
TodoPro SHALL 由钩子(而非模型)回填每个 todo 的 `updated_at` 时间戳,模型无需关心。

#### Scenario: 钩子回填时间戳
- **WHEN** Agent 调用 TodoPro 工具写入新状态
- **THEN** 钩子 SHALL 在落盘前为发生变更的项回填 `updated_at` 为当前 ISO8601 时间,未变更项的 `updated_at` 保持不变
