## ADDED Requirements

### Requirement: 放行退出时清理运行时文件
系统 SHALL 在 review 满足(或熔断)且放行退出时,删除本次需求的运行时文件,避免前后需求混乱。

#### Scenario: 删除运行时文件
- **WHEN** 会话放行退出(review_done=true 或 review 熔断或 nudge 熔断)
- **THEN** 系统 SHALL 删除:.todopro/todo.json / .todopro/requirement-summary.md / .todopro/touched-files.json / .todopro/session-state.json

#### Scenario: 保留预置静态文件
- **WHEN** 清理触发
- **THEN** 系统 SHALL 保留 .todopro/review-subagent-prompt.md(预置静态文件,下次复用),不删除

### Requirement: 清理时机为放行退出而非全完成
系统 SHALL 在"放行退出"那一刻触发清理,而非"全部完成"那一刻,因为全完成后可能还要跑 review、修 review 发现的问题(会新增 todo 回到有 pending 状态)。

#### Scenario: 全完成但未放行不清理
- **WHEN** 所有 todo 完成,但 review 尚未满足且未熔断,会话未放行退出
- **THEN** 系统 SHALL 不清理,保留运行时文件供后续 review 与可能的修复轮使用

#### Scenario: 修复后再次完成才清理
- **WHEN** review 后 Agent 新增 todo 修复问题,再次全部完成并 review 满足后放行退出
- **THEN** 系统 SHALL 在此次放行退出时清理

### Requirement: 清理为删除不归档
系统 SHALL 直接删除运行时文件,不归档到 history 目录。

#### Scenario: 删除不留痕
- **WHEN** 清理触发
- **THEN** 系统 SHALL 直接删除文件,不复制到 .todopro/history/ 或类似归档目录
