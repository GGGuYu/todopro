## ADDED Requirements

### Requirement: 文件记录由钩子自动完成不依赖模型
系统 SHALL 通过 PostToolUse 钩子(锁定编辑类工具)在监护期间自动记录被碰过的文件到 `.todopro/touched-files.json`,不依赖模型手动写入。

#### Scenario: 钩子自动记录编辑过的文件
- **WHEN** 监护期间 Agent 调用编辑类工具(Write/Edit/Bash 写操作)修改了某文件
- **THEN** 系统 SHALL 自动将该文件路径追加到 `.todopro/touched-files.json`,模型无需参与

#### Scenario: 非监护期间不记录
- **WHEN** 会话未开启监护(未用 TodoPro 工具)或已 paused/abandoned
- **THEN** 系统 SHALL 不记录文件,避免噪音

### Requirement: 文件记录与 git diff 互补
系统 SHALL 让 review 子 agent 同时读取 touched-files 与 git diff,两者覆盖场景互补。

#### Scenario: touched-files 记路径含非 git 项目
- **WHEN** 项目非 git 仓库
- **THEN** review 子 agent SHALL 降级为只读 touched-files.json(含监护期间碰过的文件路径,含"读了但没改"的文件)

#### Scenario: git 仓库下两者都读
- **WHEN** 项目是 git 仓库
- **THEN** review 子 agent SHALL 同时读 touched-files.json(路径清单)与 git diff(实际改动文本),两样互补

### Requirement: 只记编辑类工具不记读操作
系统 SHALL 只记录编辑类工具(Write/Edit/Bash 写)碰过的文件,不记录读操作(Read/Grep/Glob)。

#### Scenario: 读操作不记录
- **WHEN** Agent 调用 Read/Grep/Glob 读取文件
- **THEN** 系统 SHALL 不将该文件加入 touched-files.json(读操作噪音大且对 review 价值低)
