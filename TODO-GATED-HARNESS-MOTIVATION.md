# Todo-Gated Agent Harness 强制校验与 Review 机制 — 项目动机与目标

> 本文档用于在新目录开 OpenSpec 任务时转移上下文。它记录了一整轮调研与设计讨论的完整思考过程，包括动机、问题、调研结论、设计抉择。**实现方案不在本文档敲死**，留给后续任务去定。

---

## 一、动机：从哪里来

### 1.1 背景：Harness 决定模型能力的下限

我们观察到，Claude Code / Codex 这类"重 Harness"的 CLI Agent 工具，其能力并不完全来自模型本身，很大一部分来自 **Harness（脚手架）层的设计**——上下文压缩有章法、todo 完成触发校验钩子、独立子 agent review 回注、精心雕琢的行为约束提示词。这些机制让普通模型也能拥有更强的执行能力，代价是消耗更多 Token。

与之相对的是"极简 Harness"流派（如 Pi / earendil-works/pi），设计原则是骨架完整、策略留白——compaction 有章法、钩子点全开，但 todo 校验、子 agent review、行为约束提示词一个都不内置。开箱朴素，但可塑性强。

### 1.2 触发点：调研 HanaAgent 时发现的能力缺口

我们调研了 HanaAgent（liliMozi/openhanako，一个基于 Pi SDK 的桌面 AI 助理），核实了以下几点：

- **HanaAgent 的内核就是 Pi**（`@mariozechner/pi-coding-agent`，旧名 badlogic/pi-mono，现 earendil-works/pi）。`lib/pi-sdk/index.ts` 是唯一适配层，agent loop、工具调度、session 管理、compaction 全部来自上游。
- **HanaAgent 钉死在 Pi 0.70.2**，从 v0.297 到 v0.329（30+ 个 release）内核纹丝未动，期间只迭代外壳（人格/记忆/沙盒/技能/桌面 UI）。上游同期已到 0.79.6，差 9 个版本号，且 npm scope 已从 `@mariozechner/*` 迁到 `@earendil-works/*`，旧 scope 停更。
- **Pi 的 Harness 能力盘点**（读源码核实）：
  - 上下文压缩：**有章法**。工具结果截断到 2000 字、调用序列化、文件清单提取（`<read-files>`/`<modified-files>`）、turn 边界切、结构化摘要 prompt（Goal/Constraints/Progress）。不输 Claude Code 思路。
  - 钩子点：**很全**。25 个事件（`before_agent_start`/`turn_end`/`tool_call`/`tool_result`/`session_before_compact` 等），但只是"钩子点"，无内置策略。
  - todo 校验钩子：**无**。没有内置 todo 工具，没有语义级校验钩子。
  - 独立子 agent review 回注：**无**。没有 subagent，没有多 agent 编排。
  - 行为约束提示词：**朴素**。默认就两行 guideline（"简洁""路径写清楚"），控制权交给 `customPrompt`/`appendSystemPrompt`/`promptGuidelines`。
  - idle 续命/主动提醒：**无**。prompt 完就结束，等下一个用户输入。
- **Pi 的设计哲学**：骨架完整、策略留白。重机制要谁想要谁自己写 extension，框架不内置。

结论：HanaAgent 和 Pi 都没有我们想要的那套"强化 Harness 策略"。

### 1.3 我们想要什么

我们想要一套 **Agent 执行能力的强化机制**，核心诉求是：

1. **查漏**：Agent 停下来时，如果还有未完成的任务，系统能检测到并提醒它（甚至不让它出循环）。
2. **强制校验**：任务宣告完成时，强制触发一次校验，防止模型"做完不验"。
3. **独立 review 回注**：用独立子 agent（不受原上下文影响）review 当前工作，结果回注成"思考"传回主 Agent，提升质量。
4. **不要过度**：简单任务（打个招呼、git commit、编译装包）不该被拖进昂贵的循环。

---

## 二、核心问题与设计抉择

### 2.1 关键判断：用"模型是否建 todo"当闸门

最关键的设计决定是：**把所有重机制和"Agent 主动建了 todo"这件事强绑定**。

理由：
- "任务大小"无法便宜地判断（要预判意图，开销大且不可靠）。
- 但"模型自己有没有觉得这事儿值得拆步"是一个**免费且准确的过滤器**——模型的判断就是过滤器。
- 小任务（打招呼、git commit、编译装包）模型根本不会建 todo，所以永远不会触碰任何钩子。
- "重"是模型自己招来的（主动 opt-in），不是 harness 强加的。这解决了"会不会过度"的担忧。

这比用"有没有 mutating 工具"这种启发式更可靠——闸门信号从"启发式"换成"模型自己的 opt-in"。

### 2.2 "强制"的语义：强制做决定，不是强制做完

"不让 Agent 出循环"的正确语义是**强制它做一个明确的选择**，而不是强制它把事干完。三者择一：

- **维护**（勾掉做完的、补上新增的）
- **暂停**（`todo_pause`：这一轮要问用户/等外部条件，主动挂起）
- **放弃**（`todo_abandon`：方向错了或不需要了，显式撤销）

三者都是合法出口。Harness 不评判它选哪个，只要求**它不能"什么都没选就悄悄溜走"**。

本质：把"忘记维护 todo"这个**沉默失败**，变成"必须显式声明意图"的**有意识动作**。不替模型做决定，不让它无意识地漂出去。

### 2.3 三个触发点

| 触发点 | 检测信号 | 动作 |
|---|---|---|
| 建 todo | todo 工具被调用（add 动作） | 打会话标志，开启监护 |
| 循环停止但有未完成 todo | turn 结束时，最后一条 assistant 消息无工具调用，且 todo 有 pending 项，且未被 pause/abandon | 注入 nudge 续跑（强制三选一） |
| 最后一条 todo 完成 | todo 工具检测到全部 checked off | 触发重校验 |

"循环停止"的检测是事实判断（最后一条消息纯文本、无工具调用块），不需要额外 LLM 调用——呼应"别用开销省开销"。

### 2.4 必须防的坑

1. **nudge 续跑必须有熔断**：同一份 todo 最多自动 nudge 2 次，第 3 次交还用户。防止无限续。
2. **重校验结果搭"完成 todo"工具调用的返回值回来**：当模型勾掉最后一项时，工具内部直接跑 review，把 review 文本作为该工具的 return。这样 review 自然流回对话变成"工具结果"，模型一定会读到，不需要额外的消息注入通道。少一条注入路径就少一处出错。
3. **重 review 的结果要"可忽略"**：回注时明确标注"这是独立审查意见，供参考，不必全盘接受"，否则模型会把每条意见都当必须执行，反而放大消耗。
4. **阈值是经验值**：N（改几个文件）、X（多少 token）要按模型和成本容忍度调，没有万能数字。

### 2.5 中间过程不干预

明确原则：**钩子只在两个边界点（循环出口、todo 完成）触发，中间全程不碰**。重的东西只发生在"它自己停下来"或"它自己宣告完成"这两个瞬间，不在它干活的过程中插嘴。这与"别太重"完全一致。

---

## 三、跨平台可行性调研结论

我们调研了三个平台的钩子能力，确认了方案的跨平台可移植性。

### 3.1 调研对象

- **Claude Code**（Anthropic 官方 CLI）
- **Codex**（OpenAI 官方 CLI，openai/codex）
- **Pi**（earendil-works/pi，HanaAgent 的内核）+ **HanaAgent** 插件系统

### 3.2 Claude Code hooks 能力

来源：官方文档 https://code.claude.com/docs/en/hooks + 社区生态（disler/claude-code-hooks-mastery 3.7k star、GowayLee/cchooks Python SDK 等）。

共 30 个 hook 事件。与本项目相关的关键能力：

| 能力 | 事件 | 机制 |
|---|---|---|
| 拦截 turn 结束 | `Stop` | exit 2 或 `decision:"block"` 阻止停止、继续对话 |
| 强制续跑 | `Stop` | `hookSpecificOutput.additionalContext` 提供非错误反馈，对话继续让模型据此行动 |
| 拦子 agent 结束 | `SubagentStop` | 同上语义 |
| 拦特定工具 | `PreToolUse` + matcher | `permissionDecision: deny/ask/allow`，可改写 `updatedInput` |
| 工具完成后注入反馈 | `PostToolUse` | `additionalContext` 出现在工具结果旁；可 `updatedToolOutput` 替换结果 |
| 拦压缩 | `PreCompact` | `decision:"block"` 可阻断 |
| 拦任务标记完成 | `TaskCompleted` | exit 2 阻止标记完成 |
| 注入上下文 | 多事件 | `additionalContext` 包成 system reminder 插入对话 |
| 用户提交时注入 | `UserPromptSubmit` | stdout 或 `additionalContext` |

`additionalContext` 上限 10000 字符。exit 0=成功（解析 JSON），exit 2=阻断。文档最全、生态最成熟。

### 3.3 Codex hooks 能力

来源：openai/codex 源码（codex-rs/hooks/）。**注意：Codex 有新旧两套 hook 系统，开发者门户文档 Forbidden，以下结论来自直接读 Rust 源码。**

- **旧 `notify`（legacy_notify.rs）**：只有 `agent-turn-complete` 一个事件，`Stdio::null()` 丢弃所有输出，纯 fire-and-forget，**不能阻断不能注入**。很多老文档/博客讲的是这套，会误导。
- **新 hooks（codex-rs/hooks/src/events/）**：这才是与 Claude Code 对等的系统。

新 hooks 事件（events/ 目录）：`session_start`、`user_prompt_submit`、`pre_tool_use`、`post_tool_use`、`stop`、`subagent_stop`、`compact`（pre/post）、`permission_request`。

关键能力（schema.rs + types.rs + stop.rs 核实）：

| 能力 | 字段/机制 |
|---|---|
| 阻断退出 | `StopOutcome.should_block: bool` + `block_reason` |
| 强制续跑 | `StopOutcome.continuation_fragments: Vec<HookPromptFragment>` |
| 注入消息 | `additional_context: Option<String>`（PostToolUse/PreToolUse hookSpecificOutput） |
| 工具权限 | `PreToolUse`: `allow`/`deny`（permission_decision） |
| 通用输出 | `HookUniversalOutputWire`: `continue: bool` + `stop_reason` + `system_message` |

`HookResult::FailedAbort` 能中止操作。事件名与 Claude Code 几乎一一对应，输出字段语义对称（`additionalContext` ↔ `additional_context`，`block`+`reason` ↔ `should_block`+`block_reason`）。

### 3.4 Pi / HanaAgent 能力

- **Pi**：25 个 extension 事件钩子（`before_agent_start`/`turn_end`/`tool_call`/`tool_result`/`session_before_compact` 等），可通过 Hana 的 full-access 插件 `extensions/*.js` 接入。插件 SDK 提供 `sampleText()`（发起独立 LLM 调用，不受当前会话上下文影响）和 `context.afterUser`/`context.system`（回注主对话）。
- **HanaAgent 插件系统**：restricted 插件可贡献 `tools/*.js`/`skills/`/`commands/`；full-access 插件额外可贡献 `extensions/*.js`（Pi SDK 事件拦截）、`routes/`、`providers/`、生命周期钩子。

### 3.5 跨平台对照结论

三个平台的事件语义高度对称，核心逻辑可共享：

| 能力 | Claude Code | Codex | Pi/Hana |
|---|---|---|---|
| 拦截 turn 结束 | `Stop` | `stop` | `turn_end`/`agent_end` |
| 阻断退出+续跑 | exit 2 / `decision:block` | `should_block`+`continuation_fragments` | 钩子 + `_pendingNextTurnMessages` |
| 注入消息 | `additionalContext` | `additional_context` | `context.afterUser` |
| 拦特定工具 | `PreToolUse` matcher | `pre_tool_use` matcher | `tool_call` 事件 |
| 工具后注入 | `PostToolUse` | `post_tool_use` | `tool_result` 事件 |
| 独立 LLM 调用 | 外部脚本调 API | 外部脚本调 API | `sampleText()` |
| 拦任务完成 | `TaskCompleted` | — | — |

**真正不可移植的只有一处：钩子配置怎么写进各平台的配置文件。** 核心判断逻辑（读 todo 文件、判断状态、生成提醒文本、跑独立 review）可以用一个平台无关的脚本（Python/Node）实现，三个平台各自配一个薄薄的 hook 入口去调它。

### 3.6 一个重要约束：Skill 带不了钩子配置

各平台的 Skill/技能机制只能带 SKILL.md + 脚本，**带不了钩子配置**。钩子配置在平台配置文件里：
- Claude Code：`.claude/settings.json` 的 `hooks` 字段
- Codex：`config.toml` 的 `[hooks]` 段
- Hana：full-access 插件自带 `extensions/`，装了就生效

因此"安装时必须有引导程序"——引导脚本负责检测平台、把预制 hook 配置 merge 进对应配置文件、放好工具脚本和 SKILL.md、提示重载。这是跨平台唯一需要各写一份的部分，且是一次性安装逻辑。

---

## 四、目标（不敲死实现）

### 4.1 总目标

构建一套 **todo-gated 的 Agent 执行强化机制**，以 Skill + 自定义 todo 工具 + 平台 hook 的形式交付，可跨 Claude Code / Codex / HanaAgent 三平台复用。机制让 Agent 在大任务上更可靠（查漏、强制校验、独立 review），同时在小任务上零开销。

### 4.2 必须达成

1. **自定义 todo 工具**：提供 add/check/pause/abandon 等动作，状态落盘到文件。Agent 用了这个工具才会触发后续机制。
2. **循环出口兜底**：当存在未完成 todo 且 Agent 停止工具调用时，检测到并注入提醒，强制 Agent 三选一（维护/暂停/放弃）。带熔断（最多自动 nudge N 次，N 可配，默认 2）。
3. **完成时重校验**：最后一条 todo 被勾掉时，触发一次校验。校验结果搭该工具调用的返回值回流到对话。
4. **小任务零开销**：不建 todo 的任务（打招呼、git commit、编译装包）不触碰任何钩子，与裸跑无异。
5. **中间过程不干预**：钩子只在循环出口和 todo 完成两个边界点触发，不在 Agent 干活过程中插嘴。

### 4.3 应该达成

1. **独立子 agent review 回注**：完成校验时，用一个独立、干净的上下文跑 review，结果回注主对话成"思考输入"。强调结果"可忽略"。
2. **跨平台核心逻辑共享**：读 todo/判断状态/生成提醒/跑 review 用平台无关脚本实现，各平台只写薄 hook 入口。
3. **引导安装程序**：检测平台、写 hook 配置、放脚本和 SKILL.md、提示重载。

### 4.4 可以达成（后续）

1. **强制使用自定义 todo 工具而非内置的**：拦内置 TodoWrite（Claude Code）/ 对应工具，deny 并提示改用本 skill 的 todo 工具。
2. **idle 续命/主动提醒**：检测会话空闲，AI 总结当前进度并提醒下一步。
3. **阈值可配**：触发重校验的工作量阈值（改文件数/token 数）按模型和成本调。

### 4.5 非目标（明确不做）

- **不在 Agent 干活的过程中干预**（中间过程零介入）。
- **不强制 Agent 把事做完**——强制的是"做明确选择"，不是"完成"。pause/abandon 是合法出口。
- **不重写 Pi/Claude Code/Codex 的底层 compaction 算法**——各平台已有等价的章法压缩，不改。
- **不试图预先判断用户意图**——用行为痕迹（是否建 todo）做闸门，不用小模型预判意图。

---

## 五、落地建议（参考，非强制）

讨论中形成的建议顺序，供开任务时参考：

1. **先在 Claude Code 上跑通最小闭环**：文档最全、生态最成熟、`Stop`+`additionalContext` 语义最干净。
   - SKILL.md（要求多步任务用 todo 工具）
   - todo 工具（落盘 .todo.json）
   - Stop hook 脚本（读 .todo.json，有 pending 且未 pause → block + 注入提醒）
   - PostToolUse hook（todo 工具完成后，若全完成 → 注入校验 prompt 或工具内跑 review）
2. **验证"强制三选一 + 熔断 + 完成校验"闭环**。
3. **把核心逻辑抽成平台无关脚本**。
4. **写引导程序，加 Codex 的 config.toml hook 配置**。
5. **（可选）包装成 Hana full-access 插件**，复用同一套脚本。

---

## 六、关键调研依据（便于复核）

- HanaAgent 源码：`/tmp/openhanako`（已 clone）。内核依赖见 `package.json:64-65`，适配层 `lib/pi-sdk/index.ts`，系统提示词 `core/agent.ts:1131`，人格 `core/agent.ts:1000`。
- Pi 源码：`/tmp/pi-src`（已 clone earendil-works/pi）。主 loop `packages/coding-agent/src/core/agent-session.ts`（`_runAgentPrompt`/`_handlePostAgentRun`），compaction `packages/coding-agent/src/core/compaction/`（utils.ts 的 `serializeConversation` 截断工具结果到 2000 字、提取文件清单），extension 事件 `packages/coding-agent/src/core/extensions/types.ts`。
- HanaAgent 插件文档：`PLUGINS.md`（extensions 章节 line 437-467）、`PLUGIN_SDK.md`（`sampleText()` line 268、`context.afterUser` line 262）。
- Claude Code hooks：https://code.claude.com/docs/en/hooks （30 事件，`Stop` exit 2 阻断 + `additionalContext` 续跑）。
- Codex hooks：openai/codex 仓库 `codex-rs/hooks/`。新 hooks 见 `src/events/`（stop/pre_tool_use/post_tool_use 等），输出 schema 见 `src/schema.rs`（`additional_context`/`continue`/`block`），stop 能力见 `src/events/stop.rs`（`StopOutcome.should_block`+`continuation_fragments`）。旧 notify 见 `src/legacy_notify.rs`（fire-and-forget，不可用）。
- npm 包迁移：`@mariozechner/pi-coding-agent`（Hana 用的旧 scope，停更于 0.73.1）→ `@earendil-works/pi-coding-agent`（新 scope，0.79.6）。GitHub `badlogic/pi-mono` 301 重定向到 `earendil-works/pi`。
