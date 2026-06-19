## ADDED Requirements

### Requirement: 核心逻辑平台无关共享
系统 SHALL 将核心判断逻辑(读 todo / 判状态 / 生成提醒文本 / 组装 review prompt / 跑 git diff)实现为平台无关的脚本,三平台共享同一份。

#### Scenario: 三平台共用核心脚本
- **WHEN** 任一平台的 hook 入口被触发
- **THEN** 入口 SHALL 调用同一份平台无关核心脚本完成判断与文本生成,不重复实现逻辑

### Requirement: 核心脚本零 npm 依赖
核心脚本 SHALL 仅使用 Node 内置模块(fs/path/crypto/child_process),不引入任何 npm 依赖。

#### Scenario: 无需 npm install
- **WHEN** 核心脚本被放置到用户环境
- **THEN** 系统 SHALL 能直接以 `node script.js` 运行,无需先执行 `npm install`,不与用户项目依赖冲突

### Requirement: 各平台薄适配层双向归一化
各平台 SHALL 提供薄适配层,双向归一化:把平台原始 payload 归一化成统一事件喂给核心逻辑,把核心逻辑产出的统一决策反归一化成各平台期望的输出字段。

#### Scenario: 归一化事件输入
- **WHEN** 平台 hook 收到原始 payload(Claude Code JSON / Codex JSON / Pi event 对象)
- **THEN** 适配层 SHALL 将其归一化成统一内部事件表示(如 `{event, round_wrote_todo, session, todos}`)喂给核心逻辑

#### Scenario: 反归一化输出为 Claude Code 格式
- **WHEN** 核心逻辑产出决策 `{action:"block", inject_text:"..."}`
- **THEN** Claude Code 适配层 SHALL 翻译为 exit 2 + `additionalContext`

#### Scenario: 反归一化输出为 Codex 格式
- **WHEN** 核心逻辑产出决策 `{action:"block", inject_text:"..."}`
- **THEN** Codex 适配层 SHALL 翻译为 `should_block:true` + `block_reason` + `continuation_fragments`

#### Scenario: 反归一化输出为 Pi 格式
- **WHEN** 核心逻辑产出决策 `{action:"block", inject_text:"..."}`
- **THEN** Pi 适配层 SHALL 翻译为钩子阻止退出 + `context.afterUser` 注入

### Requirement: 统一内部事件与决策表示
系统 SHALL 定义统一的内部事件表示与统一决策表示,作为核心逻辑与适配层之间的契约。

#### Scenario: 统一事件契约
- **WHEN** 适配层归一化事件
- **THEN** 产出的统一事件 SHALL 包含核心逻辑判断所需的全部字段(event 类型、本轮是否推进、会话状态、todos 列表)

#### Scenario: 统一决策契约
- **WHEN** 核心逻辑产出决策
- **THEN** 决策 SHALL 包含 action(allow/block)、inject_text(注入文本)、reset_flags(需复位的标志),供适配层反归一化
