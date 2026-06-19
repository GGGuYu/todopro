## Context

本设计承接 `TODO-GATED-HARNESS-MOTIVATION.md` 的完整调研。结论先行:三平台(Claude Code / Codex / Pi·Hana)的事件钩子语义高度对称,核心判断逻辑可平台无关共享,真正不可移植的只有"钩子配置怎么写进各平台配置文件"。

平台钩子能力对照(已核实):

| 能力 | Claude Code | Codex | Pi/Hana |
|---|---|---|---|
| 拦截 turn 结束 | `Stop`(exit 2 / `decision:block` 阻断,`additionalContext` 续跑) | `stop`(`should_block`+`continuation_fragments`) | `turn_end`/`agent_end` |
| 工具后注入 | `PostToolUse`(`additionalContext`/`updatedToolOutput`) | `post_tool_use`(`additional_context`) | `tool_result` 事件 |
| 拦特定工具 | `PreToolUse` + matcher(`permissionDecision`) | `pre_tool_use` matcher | `tool_call` 事件 |
| 子 agent 结束 | `SubagentStop` | `subagent_stop` | `agent_end` |
| 内置 todo 工具 | `TodoWrite`(全量替换) | `update_plan`(全量替换) | 无 |

Skill/技能机制只能带 SKILL.md + 脚本,**带不了钩子配置**——钩子配置在平台配置文件里(`.claude/settings.json` / `config.toml` / Hana 插件 `extensions/`)。因此安装必须有 init 引导程序。

约束:核心脚本零 npm 依赖(纯 Node 内置模块),不增加用户环境负担,不与用户项目依赖冲突。

## Goals / Non-Goals

**Goals:**

- TodoPro 自定义 todo 工具:全量替换语义(模型零学习成本)+ 扩展 status(paused/abandoned)+ 稳定 id + 落盘。
- 循环出口兜底:Stop 钩子在"有 pending 且本轮无 TodoPro 写操作"时阻断注入,强制四选一,带熔断。
- 完成时重 review:全部完成时引导主 Agent 用**原生**子 agent 机制起独立 review,需求总结复写、子 agent 自读、结果分档且均可忽略,带熔断与会话硬上限。
- 文件记录:PostToolUse 钩子自动记碰过的文件,事实记录不依赖模型。
- 清理:放行退出时删运行时文件。
- Skill 暴露增量价值,模型自主调用,不拦内置 todo。
- 跨平台核心逻辑共享(零依赖纯 Node),各平台薄适配层。
- init 引导程序三平台各一份。

**Non-Goals:**

- 不在 Agent 干活过程中干预(中间过程零介入,只在循环出口和 todo 完成两个边界点触发)。
- 不强制 Agent 把事做完——强制的是"做明确选择",pause/abandon/acknowledge_stall 是合法出口。
- 不重写各平台底层 compaction 算法。
- 不预先判断用户意图——用行为痕迹(是否用我们的工具)做闸门。
- 不拦内置 todo(Claude Code 的 TodoWrite / Codex 的 update_plan)——装了不代表 100% 会用,接受优雅退化。
- 不由我们的脚本调 API 跑 review——review 由主 Agent 用原生子 agent 机制起,避开 API key 跨平台差异。

## Decisions

### 决策 1:闸门信号 = "调用了 TodoPro 工具",不是"建了 todo"

**选择**:用"Agent 主动选择了我们的增强 todo 工具"作为闸门,而非泛泛的"建没建 todo"。

**理由**:这是比 opt-in 还强的同意动作。调用我们的工具本身已够强,不需要再叠加"还调用了编辑工具"这种组合信号(会让逻辑变复杂)。模型调了就是想要增强;没调就是裸跑。

**代价与接受**:闸门信号变强 = 覆盖率下降。Claude Code 上模型可能图省事直接用内置 TodoWrite,整套机制不生效。**这是可接受的优雅退化**——靠 SKILL.md description 暴露增量价值吸引主动调用,不靠强制。提高覆盖率只能靠 description 写得好,不靠拦内置 todo(侵入性太大,用户不一定信任)。

**备选(已否决)**:拦内置 TodoWrite,deny 并提示改用。否决理由:侵入性大,违背自主原则,用户不信任。

### 决策 2:工具形态 = 路线 A(全量替换 + 扩展 status + 稳定 id)

**选择**:模仿内置 TodoWrite 的全量替换语义,扩展 status 加 `paused`/`abandoned`,加稳定 `id` 字段。

**理由**:
- 模型零学习成本(它已会 TodoWrite,三平台里 Claude Code/Codex 都是全量替换语义)。
- pause/abandon 作为 status 字段是一等公民。
- 稳定 id 让钩子能 diff 出"到底哪几项变了"——这是"本轮有没有推进"和"最后一项 completed"判断的基础。内置 TodoWrite 没有 id,全量替换时模型可能漏带某项或重排,钩子没法稳定追踪。

**schema**:
```jsonc
// .todopro/todo.json — 唯一真相源
{
  "version": 1,
  "created_at": "ISO8601",
  "todos": [
    { "id": "t1", "content": "...",
      "status": "pending" | "in_progress" | "completed" | "paused" | "abandoned",
      "priority": "high" | "medium" | "low",
      "updated_at": "ISO8601" }   // 钩子回填,模型不用管
  ],
  "session": {
    "status": "active" | "paused" | "abandoned" | "completed",
    "review_done": false,
    "nudge_count": 0,
    "review_nudge_count": 0
  }
}
```
保留内置的硬约束:**同一时刻最多 1 个 `in_progress`**。

**备选(已否决)**:路线 B(增量动作 add/check/pause/abandon)。否决理由:模型要学一套动词,三平台无对照,丧失零学习成本优势。推进检测"有调用即推进"虽更省事,但 diff 新旧 JSON 也不难(钩子在工具调用前后存快照对比)。

### 决策 3:存储 = JSON 真相源 + MD 只读镜像

**选择**:`.todopro/todo.json` 为唯一真相源(模型和钩子都写,全量替换);`.todopro/todo.md` 为钩子自动生成的只读镜像,供人和模型查看。

**理由**:
- 纯 Markdown 的坑:模型编辑易出格式偏差,钩子解析要写正则/AST,三平台适配层各写各的——违背"核心逻辑共享、零依赖"。
- 纯 JSON 的坑:模型看着一行 JSON 不舒服,git 历史难看。
- 折中:JSON 是 schema 是真相,MD 是渲染。模型写 JSON,人看 MD,职责干净。

**目录结构**:
```
.todopro/
  todo.json                 ← 唯一真相源(模型+钩子写)
  todo.md                   ← 只读镜像(钩子自动生成)
  requirement-summary.md    ← review 时主 agent 写,复写覆盖
  review-subagent-prompt.md ← 预置静态文件(我们提供,复用不删)
  touched-files.json        ← 钩子自动记
  session-state.json        ← 钩子维护(nudge/review 计数、轮标志)
```

### 决策 4:循环出口兜底 = 四选一,推进检测用 PostToolUse 标志

**选择**:Stop 钩子检测"本轮有没有发生过 TodoPro 工具调用"。没有 + 有 pending → 阻断注入,强制四选一。

**推进的定义**:对 todo 的任何写操作(check/add/update/delete 都算)——即"本轮有没有发生过 TodoPro 工具调用"。任何调用都算(写操作必然经过工具)。

**检测机制**:PostToolUse 钩子配 matcher 锁定 TodoPro 工具,每次被调置 `wrote_todo_this_round=true` 标志;Stop 时读标志,放行后复位。零 LLM、纯事实判断。

**四选一**:
- **维护**:check 掉做完的 / add 新增的(推进了,放行)
- **暂停** `pause`:整个 todo 挂起,停止监护直到恢复(长期,通常等用户/外部)
- **放弃** `abandon`:方向错了,显式撤销
- **知情停顿** `acknowledge_stall`:我这轮 knowingly 不推进,放行本轮,下轮继续监护(短期)

`pause` 与 `acknowledge_stall` 的区别:pause 是"长期挂起、别再监护我了";acknowledge_stall 是"就这轮停一下,下轮接着干,继续监护"。不重叠。

**改进点(相对动机文档 2.3)**:原信号"有 pending + 最后一条消息无工具调用"会误伤正在干活(编辑了文件但最后没调工具)的轮次。新信号"本轮有没有推进 todo"精准命中"忘记维护 todo"这个真问题。

### 决策 5:review 不由脚本调 API,由主 Agent 用原生子 agent 机制起

**选择**:review 时,Stop 钩子只注入提示词,引导主 Agent 用其**原生**子 agent 机制(Claude Code Task / Codex subagent / Pi sampleText/subagent)起一个独立 review。我们只提供提示词文件,不提供"内部调 API 的 review 工具"。

**理由**:
- 避开 API key 跨平台差异(原方案:脚本调 API 要配 key,Claude Code/Codex 上要额外配,Pi 上浪费 sampleText)。新方案:零 key,用宿主配置。
- 吃缓存:主 Agent 生成"需求总结"基于已有对话,前段命中缓存,只有总结那段是新算的。子 agent 新上下文不命中,但输入小(总结+todo+diff+提示词,几 K 到十几 K),调用不贵。

**review 数据流**:
```
主 agent 上下文(可能 300K,前段命中缓存)
  │
  │ ① Stop 钩子 → 检测全部 todo 完成 → 注入提示词(~1-2K):
  │    "todo 全部完成。请:
  │     (a) 写详细需求总结到 .todopro/requirement-summary.md
  │         — 详细描述需求本身,【不要】写实现方法(让子 agent 自己据需求 review)
  │         — 复写覆盖,不追加
  │     (b) 用你的原生 Task/subagent 机制起子 agent,
  │         只给它两个文件路径:
  │          • .todopro/requirement-summary.md(你刚写的)
  │          • .todopro/review-subagent-prompt.md(我们预置的)
  │         让子 agent 自己读这两个文件 + git diff + touched-files + todo,
  │         独立审查本次改动"
  ▼
主 agent:只做两件事——写需求总结文件 + 调原生起子 agent
  (主 agent 全程不读 review-subagent-prompt.md,上下文不膨胀)
  ▼
子 agent(全新上下文,与主 agent 那 300K 完全无关)
  自己读:requirement-summary.md / review-subagent-prompt.md / todo.json
          / touched-files.json / git diff
  → 按需求 review,不被实现方法带偏
  → 输出 CRITICAL/ISSUE/SUGGEST 分档结果
  ▼
结果回主 agent:先查实,再判修,均可忽略
```

**关键约束**:主 agent 不读大文件(只写需求总结 + 给路径),子 agent 自己读一切,上下文彻底独立。需求总结复写覆盖不累积(不与上次需求混)。requirement-summary.md **每次 review 都写**(即使第一次没异常也写),复写覆盖。

**备选(已否决)**:提供 TodoPro.review 工具,内部调 API。否决理由:跨平台 API key 问题,且多一条注入通道多一处出错。

### 决策 6:review 分档 = 全部先查实、均可忽略

**选择**:子 agent 输出按 CRITICAL/ISSUE/SUGGEST 分档,但**契约统一为"全部先查实,查实后按需求自行判断修不修,均可忽略"**。分档是严重度标签帮主 agent 分配注意力,不是"必须修 vs 可忽略"的硬分界。

**理由**:光跟主 agent 说"可忽略",它容易直接跳到"不修"(省事),把查实都省了,白 review。所以明确要求先查实。但若强制 CRITICAL 必修,又违背"review 是建议不是命令"——模型会把每条当 TODO 执行,放大消耗。折中:全部强制查实,修不修自由。

**子 agent 端提示词约束**:"基本能完成就只提建议,别钻牛角尖;但 CRITICAL(逻辑错/安全/数据丢失)即使基本完成也必须报。"

**主 agent 端提示词约束**:"这是独立审查意见,供参考。先客观查实确实有问题,再考虑针对当前需求修不修。均可忽略,不必全盘接受。"

### 决策 7:防死循环 = 每条阻断分支带保险丝 + review 硬上限

**选择**:Stop 钩子决策表,每类阻断都有保险丝,烧断必放行;review 循环有硬上限。

| 会话状态 | 本轮推进? | 保险丝 | 动作 |
|---|---|---|---|
| 无会话/paused/abandoned | — | — | 放行 |
| 有 pending | 推进了 | — | 放行 |
| 有 pending | 没推进 | nudge<2 | 阻断+注入四选一; nudge++ |
| 有 pending | 没推进 | nudge≥2 | 放行+注入"交还用户"(丝断) |
| 全完成,未 review | (review 到期) | rv_nudge<2 | 阻断+注入 review 提示; ++ |
| 全完成,未 review | (review 到期) | rv_nudge≥2 | 放行+注入"review 跳过"(丝断) |
| 全完成,已 review | — | — | 放行 |

**计数器复位**:
- `nudge` → 任何推进发生就归零(下轮重新给 2 次机会)
- `rv_nudge` → review 后若 agent 新增 todo(去修 review 发现的问题)则归零(给新一轮 review 机会)
- **硬上限**:单个会话最多 3 次 review。第 4 次到期的 review 直接放行+提示"已达 review 上限"。最后一道闸,保证 review 循环有界。

**子 agent 糊弄兜底**:用 SubagentStop 钩子记 `subagent_fired_this_round` 标志。review 轮结束时若该标志没亮(主 agent 没真起子 agent),算一次 rv_nudge。靠熔断兜底,不靠提示词硬约束(提示词在最近位置权重高,糊弄概率本就不大,但兜底值得加)。

### 决策 8:文件记录 = 钩子自动 + git diff 互补

**选择**:PostToolUse 钩子(锁定编辑类工具)在监护期间自动记碰过的文件到 `touched-files.json`,不依赖模型写。与 git diff 互补。

**理由**:
- 让模型把改的文件写进 todo 增加模型负担、易漏。钩子自动记是事实,跟"事实判断不用 LLM"精神一致。
- touched-files 与 git diff 覆盖场景互补:
  - touched-files:记监护期间碰过的文件路径,含非 git 项目,含"读了但没改"的文件,无改动细节。
  - git diff:记相对基线的实际改动文本,只在 git 仓库有效,只含"改了"的,有完整改动内容。
- 子 agent 两样都读最稳;非 git 项目降级成只读文件清单。
- 即使主 agent 需求总结有信息损失,todo + diff 也能把事实补回来,review 质量下限有保障。

### 决策 9:清理 = 删,放行退出时触发

**选择**:review 满足(或熔断)且放行退出时,删运行时文件,不归档。

**删除**:todo.json / requirement-summary.md / touched-files.json / session-state.json。
**保留**:review-subagent-prompt.md(预置静态,复用)。

**触发时机**:放行退出的那一刻(不是"全完成"那一刻)——因为全完成后还要跑 review、可能还要修 review 发现的问题(会新增 todo,状态回到"有 pending"),只有真正放行退出才算需求彻底结束。

### 决策 10:核心脚本零依赖纯 Node

**选择**:核心脚本只用 Node 内置模块(fs/path/crypto/child_process),不引一个 npm 包。

**理由**:
- 装时不用 `npm install`,放 .js 文件即跑。
- 不与用户项目依赖冲突。
- init 程序也因此简单。
- 核心脚本要干的活(读写 JSON、判状态、生成文本、跑 git diff、组装 review prompt、生成 hash)全都是 Node 内置能干的。

**代价**:写起来比 TS + 工具库糙一点,但核心脚本不复杂,可接受。

### 决策 11:跨平台 = 核心逻辑共享 + 双向薄适配层

**选择**:核心逻辑(读 todo/判状态/生成提醒/组装 review prompt)平台无关共享。各平台写薄适配层,**双向**:归一化事件输入(payload → 统一事件)+ 反归一化输出(统一决策 → 各平台字段)。

**归一化事件**:统一内部表示,如 `{event:"stop", round_wrote_todo:bool, session:..., todos:...}`。核心逻辑只吃这个。

**反归一化输出**:核心逻辑产出 `{action:"block"|"allow", inject_text:string, reset_flags:[...]}`。各平台翻译:
- Claude Code:block→exit 2,inject→`additionalContext`
- Codex:block→`should_block:true`+`block_reason`,inject→`continuation_fragments`
- Pi:block→钩子阻止,inject→`context.afterUser`

**唯一不可用同一份逻辑的**:独立 LLM 调用——但决策 5 已让它由主 Agent 原生机制起,我们的脚本不调 API,这个问题消失。

### 决策 12:落地顺序 = Claude Code 先跑最小闭环

**选择**:先在 Claude Code 上跑通最小闭环(文档最全、`Stop`+`additionalContext` 语义最干净),验证"四选一+熔断+完成校验"闭环;再抽核心逻辑成平台无关脚本;再加 Codex;再(可选)包装成 Hana 插件。

**注意**:Claude Code 有内置 TodoWrite,最小闭环天然带着"模型可能用内置不用我们的"这个覆盖率问题——靠 SKILL.md description 缓解,不靠拦。

## Risks / Trade-offs

- **[覆盖率:模型用内置 todo 不用我们的]** → 接受优雅退化。靠 SKILL.md description 暴露增量价值(review/审查)吸引主动调用。description 要平衡"够诱人"与"触发线够严",偏严(宁可漏中任务,别让小任务误触发重循环,有熔断兜底但每次 nudge 是钱)。

- **[review 信息损失:子 agent 只读主 agent 总结的需求]** → 需求总结要求"详细描述需求本身不写实现方法";子 agent 另读 todo + git diff + touched-files 补事实。review 质量下限有保障。

- **[主 agent 糊弄不起子 agent]** → 提示词在最近位置权重高,糊弄概率本不大;加 SubagentStop 标志检测 + rv_nudge 熔断兜底。

- **[死循环]** → 每类阻断带保险丝烧断必放行;review 硬上限 3 次/会话。数学上保证有界。

- **[分档被当硬规则]** → 提示词明确"全部先查实、均可忽略",分档只是注意力标签。子 agent 端约束"基本完成只提建议,CRITICAL 才必报"。

- **[钩子配置带不进 Skill]** → init 引导程序负责 merge 钩子配置进平台配置文件,放脚本和 SKILL.md,提示重载。三平台各一份,一次性安装逻辑。

- **[全量替换漏带项]** → 稳定 id 让钩子能 diff 出缺失项;工具返回 oldTodos 供模型对照(模仿内置 TodoWrite 的能力)。

- **[Node 版本差异]** → 仅用长期稳定的内置模块(fs/path/crypto/child_process),避开新 API。init 时检测 Node 存在性。

## Open Questions

- **review 是否需要支持"每项完成都 review"模式?** 当前默认只在"全部完成"触发一次。若某些长链路强依赖任务需要每步 review,后续做成可配阈值。当前非目标。
- **SKILL.md description 的精确措辞与触发线阈值**(预计超过 N 步 / 涉及多文件)——经验值,实现后按模型和成本调。
- **touched-files 记录范围**:只记编辑类工具(Write/Edit/Bash 写),还是连读操作(Read/Grep)也记?当前倾向只记编辑类(读操作噪音大且对 review 价值低)。
- **acknowledge_stall 与 pause 的提示词区分是否够清晰让模型选对**——实现后观察调参。
