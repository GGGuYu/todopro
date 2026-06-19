## Why

"重 Harness" CLI Agent(Claude Code / Codex)的能力很大一部分来自 Harness 层——上下文压缩、todo 完成触发校验、独立子 agent review 回注、行为约束提示词。这些机制让普通模型更可靠,但代价是消耗更多 Token,且与特定平台绑定。"极简 Harness"流派(Pi / HanaAgent)骨架完整、钩子点全开,但 todo 校验、子 agent review、行为约束策略一个都不内置,开箱朴素。

我们想要一套**可移植的 Agent 执行强化机制**:在大任务上提供查漏、强制校验、独立 review;在小任务上零开销。关键洞察是——**把所有重机制绑定到"Agent 主动选择了我们的增强 todo 工具"这一 opt-in 信号上**。模型不调我们的工具,机制完全不介入,与裸跑无异;模型调了,就是它自己招来的监护。这把"任务大小"的判断从昂贵的启发式,换成免费且准确的模型自选。

## What Changes

- **新增 TodoPro 自定义 todo 工具**:全量替换语义(模仿内置 TodoWrite,模型零学习成本),扩展 `status` 增加 `paused`/`abandoned`,增加稳定 `id` 字段(跨全量替换可追踪单项变更)。状态落盘到 `.todopro/`(内置 todo 不落盘,这是我们的增量价值)。同时维护只读 Markdown 镜像供人和模型查看。
- **新增"循环出口兜底"钩子**:Stop 钩子检测——存在未完成 todo 且本轮无 TodoPro 写操作时,阻断并注入"你本轮没推进 todo,确定要退出吗?"提示,强制 Agent 四选一(维护 / 暂停 / 放弃 / 知情停顿 acknowledge_stall)。带熔断(同一会话最多自动 nudge 2 次,第 3 次交还用户)。
- **新增"完成时重 review"机制**:最后一条 todo 被勾掉、全部完成时,Stop 钩子注入提示词,引导主 Agent 用其**原生**子 agent 机制起一个独立 review。主 Agent 只写一份需求总结文件 + 给子 agent 两个文件路径;子 agent 自读一切(git diff + touched-files + todo + 预置审查规则),上下文与主 Agent 完全无关。review 结果分档(CRITICAL/ISSUE/SUGGEST),**全部先查实、均可忽略**(不强制修)。带熔断(review nudge 最多 2 次,单会话最多 3 次 review)。
- **新增文件记录钩子**:PostToolUse 钩子(锁定编辑类工具)在监护期间自动记录被碰过的文件到 `touched-files.json`——**事实记录,不依赖模型**,供 review 子 agent 读取。与 git diff 互补。
- **新增清理机制**:review 满足(或熔断)且放行退出时,删掉本次需求的运行时文件(todo.json / requirement-summary.md / touched-files.json / session-state.json),避免前后需求混乱。预置静态文件(review-subagent-prompt.md)保留复用。
- **新增 Skill(TodoPro)**:通过 SKILL.md 的 description 暴露增量价值("比内置 todo 多提供完成时的独立 review 和漏洞复查,适合多步/多文件改造任务"),模型自主调用,不拦内置 todo。装了不代表 100% 会用——这是可接受的优雅退化。
- **新增 init 引导程序**:检测平台、注入 hook 配置、放核心脚本与 SKILL.md、提示重载。三平台各一份薄入口。
- **跨平台核心逻辑共享**:读 todo/判状态/生成提醒/组装 review prompt 用平台无关的**零依赖纯 Node 脚本**(仅用内置 fs/path/crypto/child_process)实现。各平台只写薄 hook 适配层(双向:归一化事件输入 + 反归一化输出)。

## Capabilities

### New Capabilities

- `todo-pro-tool`: TodoPro 自定义 todo 工具——全量替换语义、扩展状态(paused/abandoned)、稳定 id、落盘到 `.todopro/`、只读 MD 镜像。这是整套机制的闸门与数据源。
- `loop-exit-guard`: 循环出口兜底——Stop 钩子检测本轮无 TodoPro 写操作且有 pending 时阻断注入,强制四选一,带 nudge 熔断。中间过程零干预,只在边界点触发。
- `completion-review`: 完成时重 review——全部 todo 完成时引导主 Agent 起原生子 agent 独立审查,需求总结复写、子 agent 自读、结果分档且均可忽略,带 review 熔断与会话硬上限。
- `file-tracking`: 文件记录——PostToolUse 钩子在监护期间自动记录被碰文件,事实记录不依赖模型,供 review 子 agent 读取,与 git diff 互补。
- `session-cleanup`: 会话清理——review 满足或熔断且放行退出时删运行时文件,避免前后需求混乱,保留预置静态文件。
- `harness-install`: init 引导程序——检测平台、注入 hook 配置、放脚本与 SKILL.md、提示重载。三平台各一份薄入口。
- `cross-platform-core`: 跨平台核心逻辑——平台无关的零依赖纯 Node 脚本,各平台薄适配层双向归一化。

### Modified Capabilities

<!-- 无现有 specs,全部为新建。 -->

## Impact

- **新增目录**:`.todopro/`(运行时,可 gitignore)、核心脚本目录(零依赖 Node)、各平台 hook 适配目录、init 程序。
- **平台配置文件改动(由 init 程序执行)**:Claude Code `.claude/settings.json` 的 `hooks`;Codex `config.toml` 的 `[hooks]`;HanaAgent full-access 插件的 `extensions/`。
- **依赖**:核心脚本零 npm 依赖(纯 Node 内置模块)。无新增运行时依赖,不与用户项目依赖冲突。安装不需 `npm install`。
- **Token 成本**:仅在 Agent 主动用 TodoPro 工具时产生额外开销(注入提示词 ~1-2K/次,review 子 agent 调用)。小任务零开销。
- **不改动**:各平台底层 compaction 算法、内置 todo 工具本身、模型 API。不拦内置 todo,不预判用户意图。
- **跨平台**:Claude Code(文档最全,首选最小闭环平台)、Codex(有内置 `update_plan`,与我们形成对照)、Pi/HanaAgent(无内置 todo,我们的工具是唯一选择)。
