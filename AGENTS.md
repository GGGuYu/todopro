# AGENTS.md — TodoPro 维护者指南

> 本文是给后来维护者(人或 AI agent)的**设计遗嘱**。它记录了 TodoPro 每个关键决定**为什么这么定**,以及哪些地方是**不能乱改的红线**。
>
> 如果你只看代码,会看到"怎么实现";但看不到"为什么不能换成另一种实现"。改代码前先读这份,理解约束的来历,否则容易把设计意图改没。
>
> 代码会变,这份文档要跟着变。改了设计就同步改这里,别让它和代码脱节。

---

## 一、这是什么

TodoPro 是一套 **todo-gated 的 Agent 执行强化机制**。一句话概括:

> **用"Agent 主动调用了我们的增强 todo 工具"当闸门,把重 Harness 机制(循环出口兜底、完成时独立 review、文件追踪)绑定在这个 opt-in 信号上;只在两个边界点触发,中间全程不干预。**

它以 Skill + 自定义 todo 工具 + 平台 hook 的形式交付,跨 Claude Code / Codex / HanaAgent 三平台复用。让 Agent 在大任务上更可靠(查漏、强制校验、独立 review),在小任务上零开销。

### 它解决的问题

"重 Harness" CLI Agent(Claude Code / Codex)的能力很大一部分来自 Harness 层——上下文压缩、todo 完成触发校验、独立子 agent review 回注、行为约束提示词。这些机制让普通模型更可靠,但代价是消耗更多 Token,且与特定平台绑定。

"极简 Harness"流派(Pi / HanaAgent)骨架完整、钩子点全开,但 todo 校验、子 agent review、行为约束策略一个都不内置,开箱朴素。

TodoPro 想要**可移植的强化机制**:大任务上有监护+review,小任务上零开销。关键是把"任务大小"的判断从昂贵的启发式,换成免费且准确的**模型自选**(它调不调我们的工具)。

完整动机与调研见 `TODO-GATED-HARNESS-MOTIVATION.md`(那份是开任务前的上下文转移文档,记录了 HanaAgent/Pi/Claude Code/Codex 的钩子能力盘点)。本文件聚焦**实现后的设计**。

---

## 二、核心设计原则(红线,改前必读)

这五条是整套设计的地基。任何改动若违反其中一条,等于改了 TodoPro 的本质,请先想清楚是不是该开一个新方向而不是改这里。

### 原则 1:闸门 = opt-in,不强制

**机制只在 Agent 主动调用了 TodoPro 工具后才激活。** 不建 todo 的任务(打招呼、git commit、编译装包)永远不触碰任何钩子,与裸跑无异。

- **不要**改成"检测到多步就自动激活"——那要么用昂贵的意图预判(不可靠),要么用"有没有 mutating 工具"这种启发式(误伤多)。
- **不要**拦内置 todo(Claude Code 的 `TodoWrite` / Codex 的 `update_plan`)。拦它侵入性太大,用户不一定信任我们的工具。装了不代表 100% 会用——**这是可接受的优雅退化**。
- 提高覆盖率只能靠 `SKILL.md` 的 `description` 写得好(暴露增量价值:完成时的独立 review + 漏洞复查),让模型在大任务上**主动选择**我们。这条路线侵入性小、可移植性好。

### 原则 2:只在两个边界点触发,中间零干预

钩子只在 **①循环出口(Stop)** 和 **②todo 完成** 这两个瞬间动手。Agent 干活的过程中(编辑文件、跑命令)钩子不插嘴。

- **不要**在 PostToolUse 里对每个编辑动作注入"建议"。那会把 TodoPro 变成全程唠叨的监工,违背"别太重"。
- 重的东西只发生在"它自己停下来"或"它自己宣告完成"这两个瞬间。
- 这条与原则 1 一起保证:**小任务零开销,大任务只在边界点有开销**。

### 原则 3:强制做决定,不是强制做完

"不让 Agent 出循环"的正确语义是**强制它做一个明确的选择**,而不是强制它把事干完。合法出口有四个(见决策 4),pause/abandon/acknowledge_stall 都是合法的。

- **不要**把"有 pending 就必须全完成才放行"当规则。那会把 Agent 困死在它走错方向的任务里。
- 本质:把"忘记维护 todo"这个**沉默失败**,变成"必须显式声明意图"的**有意识动作**。不替模型做决定,不让它无意识地漂出去。

### 原则 4:review 是建议,不是命令

完成时的独立 review,结果**全部先查实、均可忽略**。分档(CRITICAL/ISSUE/SUGGEST)是严重度标签帮主 Agent 分配注意力,不是"必须修 vs 可忽略"的硬分界。

- **不要**让 review 结果变成强制 TODO。模型会把每条意见都当必须执行,反而放大消耗——这正好违背原则 2。
- 子 agent 端约束:"基本能完成就只提建议,别钻牛角尖;但 CRITICAL(逻辑错/安全/数据丢失)即使基本完成也必须报。"
- 主 agent 端约束:"先客观查实确实有问题,再考虑针对当前需求修不修。均可忽略,不必全盘接受。"
- review 不由我们的脚本调 API 跑——改让**主 Agent 用其原生子 agent 机制**起 review。这避开了 API key 跨平台差异,且吃缓存。

### 原则 5:防死循环,每条阻断都有保险丝

每一类阻断都带熔断(烧断必放行),review 循环有硬上限。**数学上保证不死循环**。

- nudge 最多 2 次,第 3 次交还用户。
- review nudge 最多 2 次,第 3 次跳过。
- 单会话 review 硬上限 3 次,第 4 次直接放行。
- **不要**加新的阻断分支而不给它配保险丝。任何"阻断"都必须能在有限次后放行,否则会卡死用户。

---

## 三、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                     平台 hook(各平台一份)                       │
│  Claude Code: Stop/PostToolUse/SubagentStop (settings.json)     │
│  Codex:       stop/post_tool_use/subagent_stop (config.toml)    │
│  Hana:        turn_end/tool_result/agent_end (extensions/)      │
└────────────────────────────┬────────────────────────────────────┘
                             │ 归一化(各平台适配层做)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              平台无关核心逻辑(src/core/,一份跑三平台)          │
│                                                                 │
│  数据层:todo-store / session-state / touched-files / git-diff  │
│  判断层:decide-stop(Stop决策表) / run-stop(共享执行)        │
│  共享入口:run-post-tool-use / run-todopro-tool                 │
│  输出层:prompts(提示词模板) / cleanup(清理)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ 统一决策 {action, injectText, ...}
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              反归一化(各平台适配层做)→ 平台输出格式            │
│  Claude Code: {decision:"block", hookSpecificOutput.additionalContext} │
│  Codex:       exit 2 + stderr(作为 continuation_fragments)     │
│  Hana:        pi.sendUserMessage(text, {deliverAs:"followUp"})  │
└─────────────────────────────────────────────────────────────────┘
```

### 分层契约(改代码时务必遵守)

```
src/core/         ← 平台无关,一份跑三平台。绝不引用 platforms/。
src/platforms/*/  ← 薄适配层,只做 I/O 翻译(归一化输入+反归一化输出),
                     业务逻辑全调 core/。绝不在此写决策逻辑。
src/install/      ← init 引导程序,三平台各一段安装逻辑。
skills/todopro/   ← SKILL.md(模型发现入口)+ review-subagent-prompt.md(预置)。
tests/            ← closed-loop(Claude Code 闭环)+ cross-platform(一致性)。
```

**红线**:
- `src/core/` 里的任何文件**不得** `require('../platforms/...')`。核心逻辑平台无关。有跨平台一致性测试守着这条(见 tests/cross-platform.test.js 12.1)。
- `src/platforms/*/` 里的 hook 脚本**不得**自己实现决策逻辑,必须调 `core/run-stop` 或 `core/run-post-tool-use`。决策逻辑只有一份,在 `decide-stop.js`。
- 新增平台 = 新建 `src/platforms/<name>/`,写薄适配层调 core,在 `init.js` 加安装分支。核心逻辑不用动。

---

## 四、关键设计决策(逐条带"为什么")

### 决策 1:闸门信号 = "调用了 TodoPro 工具"

**选择**:用"Agent 主动选择了我们的增强 todo 工具"作为闸门,而非泛泛的"建没建 todo"。

**为什么**:这是比 opt-in 还强的同意动作。调用我们的工具本身已够强,不需要再叠加"还调用了编辑工具"这种组合信号(会让逻辑变复杂)。模型调了就是想要增强;没调就是裸跑。

**代价**:闸门信号变强 = 覆盖率下降。Claude Code 上模型可能图省事直接用内置 TodoWrite,整套机制不生效。**这是可接受的优雅退化**。

**否决的备选**:拦内置 TodoWrite,deny 并提示改用。否决理由:侵入性大,违背自主原则,用户不信任。

### 决策 2:工具形态 = 全量替换 + 扩展 status + 稳定 id

**选择**:模仿内置 TodoWrite 的全量替换语义,扩展 status 加 `paused`/`abandoned`,加稳定 `id` 字段。

**为什么**:
- 模型零学习成本(它已会 TodoWrite,三平台里 Claude Code/Codex 都是全量替换语义)。
- pause/abandon 作为 status 字段是一等公民。
- **稳定 id 是关键改进**:内置 TodoWrite 没有 id,全量替换时模型可能漏带某项或重排,钩子没法稳定追踪"哪一项变了"。我们加 id,全量替换语义不变,但钩子能 diff 出到底哪几项变了——这是"本轮有没有推进"判断的基础。

**schema**(`.todopro/todo.json`,唯一真相源):
```jsonc
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
    "status": "active" | "paused" | "abandoned" | "completed"
    // P1-H6:计数字段(nudge_count/review_nudge_count/review_done)不在此,
    //       由独立的 session-state.json 维护。todo.json.session 只留 status。
  }
}
```

保留内置的硬约束:**同一时刻最多 1 个 `in_progress`**(校验失败抛错,模型熟悉这条)。

**否决的备选**:路线 B(增量动作 add/check/pause/abandon)。否决理由:模型要学一套动词,三平台无对照,丧失零学习成本优势。

### 决策 3:存储 = JSON 真相源 + MD 只读镜像

**选择**:`.todopro/todo.json` 为唯一真相源(模型和钩子都写,全量替换);`.todopro/todo.md` 为钩子自动生成的只读镜像,供人和模型查看。

**为什么**:
- 纯 Markdown 的坑:模型编辑易出格式偏差,钩子解析要写正则/AST,三平台适配层各写各的——违背"核心逻辑共享、零依赖"。
- 纯 JSON 的坑:模型看着一行 JSON 不舒服,git 历史难看。
- 折中:JSON 是 schema 是真相,MD 是渲染。模型写 JSON,人看 MD,职责干净。

**红线**:`todo.md` 是只读镜像,模型**不应**直接编辑它。改 todo 只能改 `todo.json`(经 TodoPro 工具)。

**目录结构**:
```
.todopro/
  todo.json                 ← 唯一真相源(模型+钩子写)
  todo.md                   ← 只读镜像(钩子自动生成)
  requirement-summary.md    ← review 时主 agent 写,复写覆盖
  review-subagent-prompt.md ← 预置静态文件(我们提供,复用不删)
  touched-files.json        ← 钩子自动记
  session-state.json        ← 钩子维护(计数、轮标志)
```

### 决策 4:循环出口兜底 = 四选一,推进检测用轮标志

**选择**:Stop 钩子检测"本轮有没有发生过 TodoPro 工具调用"。没有 + 有 pending → 阻断注入,强制四选一。

**推进的定义**:对 todo 的任何写操作(check/add/update/delete 都算)——即"本轮有没有发生过 TodoPro 工具调用"。任何调用都算(写操作必然经过工具)。

**检测机制**:PostToolUse 钩子 matcher 锁定 `Bash`(Claude Code)/ `shell`(Codex),`run-post-tool-use.js` 的 `isTodoProCall` 从命令内容识别 `todopro-tool.js`(Hana 上则识别工具名 `TodoPro`)。匹配则置 `wrote_todo_this_round=true`;Stop 时读标志,放行后复位。零 LLM、纯事实判断。(详见决策 13——为什么不是 matcher:"TodoPro")

**四选一**(合法出口):
- **维护**:check 掉做完的 / add 新增(推进了,放行)
- **暂停** `pause`:整个 todo 挂起,停止监护直到恢复(**长期**,通常等用户/外部)
- **放弃** `abandon`:方向错了,显式撤销
- **知情停顿** `acknowledge_stall`:本轮 knowingly 不推进,放行本轮,下轮继续监护(**短期**)

**pause 与 acknowledge_stall 的区别**(别合并):pause 是"长期挂起、别再监护我了";acknowledge_stall 是"就这轮停一下,下轮接着干,继续监护"。不重叠。合并会导致模型没法表达"我就这轮停一下"这个常见意图。

**改进点(相对早期设想)**:原信号"有 pending + 最后一条消息无工具调用"会误伤正在干活(编辑了文件但最后没调工具)的轮次。新信号"本轮有没有推进 todo"精准命中"忘记维护 todo"这个真问题。

### 决策 5:review 不由脚本调 API,由主 Agent 用原生子 agent 机制起

**选择**:review 时,Stop 钩子只注入提示词,引导主 Agent 用其**原生**子 agent 机制(Claude Code Task / Codex subagent / Pi sampleText)起独立 review。我们只提供提示词文件,不提供"内部调 API 的 review 工具"。

**为什么**:
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

**关键约束**:
- 主 agent **不读大文件**(只写需求总结 + 给路径),子 agent 自己读一切,上下文彻底独立。
- 需求总结**复写覆盖不累积**(不与上次需求混)。
- `requirement-summary.md` **每次 review 都写**(即使第一次没异常也写),复写覆盖。

**否决的备选**:提供 TodoPro.review 工具,内部调 API。否决理由:跨平台 API key 问题,且多一条注入通道多一处出错。

### 决策 6:review 分档 = 全部先查实、均可忽略

**选择**:子 agent 输出按 CRITICAL/ISSUE/SUGGEST 分档,但**契约统一为"全部先查实,查实后按需求自行判断修不修,均可忽略"**。分档是严重度标签帮主 agent 分配注意力,不是"必须修 vs 可忽略"的硬分界。

**为什么**:
- 光跟主 agent 说"可忽略",它容易直接跳到"不修"(省事),把查实都省了,白 review。所以明确要求**先查实**。
- 但若强制 CRITICAL 必修,又违背"review 是建议不是命令"——模型会把每条当 TODO 执行,放大消耗。折中:全部强制查实,修不修自由。

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
| 全完成,未 review 且 review_total<3 | (review到期) | rv_nudge<2 | 阻断+注入 review 提示; ++ |
| 全完成,未 review 且 review_total<3 | (review到期) | rv_nudge≥2 | 放行+注入"review 跳过"(丝断) |
| 全完成,未 review 且 review_total≥3 | — | 硬上限 | 放行+注入"已达上限" |
| 全完成,已 review | — | — | 放行 |

**计数器复位规则**:
- `nudge` → 任何推进发生就归零(下轮重新给 2 次机会)
- `rv_nudge` → review 后若 agent 新增 todo(去修 review 发现的问题)则归零(给新一轮 review 机会)
- **硬上限**:单个会话最多 3 次 review。第 4 次到期的 review 直接放行+提示"已达 review 上限"。最后一道闸,保证 review 循环有界。
- **P0-1 修复(硬上限现在真能触发)**:review-completed 分支**不立即 cleanup**(保留 session-state.json,review_total_count 落盘)。新增 `review_done` 标志:review 完成 → 标记 review_done,放行但保留状态;下一轮 Stop 若 todos 仍全完成 + review_done → reviewed-exit(真正退出,cleanup)。若 agent 新增 todo 修 review 问题 → markTodoWritten 复位 review_done,重新走 review,review_total_count 累加。早期版本 review-completed 就 cleanup,review_total_count 被清零,硬上限形同虚设。

**子 agent 糊弄兜底**:用 SubagentStop 钩子记 `subagent_fired_this_round` 标志。review 轮结束时若该标志没亮(主 agent 没真起子 agent),算一次 rv_nudge。靠熔断兜底,不靠提示词硬约束(提示词在最近位置权重高,糊弄概率本就不大,但兜底值得加)。

**红线**:加新的阻断分支**必须**配保险丝。任何"阻断"都必须能在有限次后放行,否则会卡死用户。

### 决策 8:文件记录 = 钩子自动 + git diff 互补

**选择**:PostToolUse 钩子(锁定编辑类工具)在监护期间自动记碰过的文件到 `touched-files.json`,不依赖模型写。与 git diff 互补。

**为什么**:
- 让模型把改的文件写进 todo 增加模型负担、易漏。钩子自动记是事实,跟"事实判断不用 LLM"精神一致。
- touched-files 与 git diff 覆盖场景互补:
  - touched-files:记监护期间碰过的文件路径,含非 git 项目,含"读了但没改"的文件,无改动细节。
  - git diff:记相对基线的实际改动文本,只在 git 仓库有效,只含"改了"的,有完整改动内容。
- 子 agent 两样都读最稳;非 git 项目降级成只读文件清单。
- 即使主 agent 需求总结有信息损失,todo + diff 也能把事实补回来,review 质量下限有保障。

**只记编辑类工具**(Write/Edit/MultiEdit/Bash 写),不记读操作(Read/Grep/Glob)。读操作噪音大且对 review 价值低。

### 决策 9:清理 = 删,放行退出时触发

**选择**:review 满足(或熔断)且放行退出时,删运行时文件,不归档。

**删除**:`todo.json` / `todo.md` / `requirement-summary.md` / `touched-files.json` / `session-state.json`。
**保留**:`review-subagent-prompt.md`(预置静态,复用) + `README.md`(init 生成,说明文件职责)。

**触发时机**:放行退出的那一刻(**不是**"全完成"那一刻)。具体:
- reviewed-exit(全完成 + review_done,真正退出)→ cleanup
- nudge 熔断(交还用户)→ cleanup
- review 熔断/硬上限 → cleanup
- abandoned(session 级)→ cleanup
- 空 todos 或全单项 abandoned/paused(无有效待办,问题5+6 修复)→ cleanup
- **不 cleanup**:review-completed(保留 review_total_count 供硬上限,P0-1)

**为什么删不归档**:归档会攒文件,违背"零负担"。前后需求不混靠清理保证,不靠历史。

### 决策 10:核心脚本零依赖纯 Node

**选择**:核心脚本只用 Node 内置模块(`fs`/`path`/`crypto`/`child_process`/`os`),不引一个 npm 包。

**为什么**:
- 装时不用 `npm install`,放 .js 文件即跑。
- 不与用户项目依赖冲突。
- init 程序也因此简单。
- 核心脚本要干的活(读写 JSON、判状态、生成文本、跑 git diff、组装 review prompt、生成 hash)全都是 Node 内置能干的。

**红线**:**不得**在 `src/` 下任何文件引入 npm 依赖。有跨平台一致性测试守着(见 tests/cross-platform.test.js 12.3,扫描所有 require 断言只允许内置模块或内部相对路径)。需要新能力时,优先用内置模块组合实现;实在不行,把依赖局限在某个平台适配层(但仍尽量避免),并在本文件记录理由。

### 决策 11:跨平台 = 核心逻辑共享 + 双向薄适配层

**选择**:核心逻辑平台无关共享。各平台写薄适配层,**双向**:归一化事件输入(payload → 统一事件)+ 反归一化输出(统一决策 → 各平台字段)。

**统一内部事件**(适配层归一化后喂给核心):
```
{ event, hasSession, sessionStatus, todos, roundWroteTodo, roundSubagentFired }
```

**统一决策**(核心产出,适配层反归一化):
```
{ action: "allow"|"block", injectText, bumpNudge, bumpReviewNudge,
  markReviewDone, doCleanup, resetRoundFlags, reason }
```

各平台翻译:
- Claude Code:block → `{decision:"block", reason, hookSpecificOutput:{hookEventName:"Stop", additionalContext}}`,exit 0
- Codex:block → exit 2 + stderr(stderr 作为 continuation_fragments 注入)
- Hana:block → `pi.sendUserMessage(text, {deliverAs:"followUp"})` 触发新 turn

**红线**:三平台的决策逻辑**只有一份**(在 `decide-stop.js`)。适配层只翻译 I/O,不重复实现决策。共享执行逻辑在 `run-stop.js` / `run-post-tool-use.js` / `run-todopro-tool.js`。

**唯一不可用同一份逻辑的**:独立 LLM 调用——但决策 5 已让它由主 Agent 原生机制起,我们的脚本不调 API,这个问题消失。

### 决策 12:落地顺序 = Claude Code 先跑最小闭环

**选择**:先在 Claude Code 上跑通最小闭环(文档最全、`Stop`+`additionalContext` 语义最干净),验证"四选一+熔断+完成校验"闭环;再抽核心逻辑成平台无关脚本;再加 Codex;再包装成 Hana 插件。

**注意**:Claude Code 有内置 TodoWrite,最小闭环天然带着"模型可能用内置不用我们的"这个覆盖率问题——靠 SKILL.md description 缓解,不靠拦。

### 决策 13:工具可达性 = Bash 调脚本(非注册工具),出口用 action 字段

> ⚠️ 这是踩坑后的修复。早期实现假设存在一个名为 "TodoPro" 的注册工具,但 Claude Code/Codex 的工具来源只有内置工具 + MCP server,我们从没注册。导致整套机制在主目标平台上从未激活过。详见 tests/real-path.test.js 的来由。

**选择**:Claude Code/Codex 上,TodoPro **不是注册工具**,而是一个 Node 脚本(`todopro-tool.js`),模型用 **Bash 工具**调用它(`echo '<json>' | node todopro-tool.js`)。Hana 上才是真注册工具(`pi.registerTool`)。

**为什么不用 MCP**:
- MCP server 要实现 stdio 协议握手,违背"零依赖纯 Node"。
- 用户要额外配 MCP server,init 更重。
- Codex 的 MCP 支持成熟度待查。
- Bash 调脚本零依赖、init 轻,脚本已有。

**推进检测随之改变**:PostToolUse 的 matcher 从 `"TodoPro"` 改成 `"Bash"`(Codex 是 `shell`)。`run-post-tool-use.js` 的 `isTodoProCall` 从 Bash 命令内容里识别 `todopro-tool.js`(正则匹配脚本路径),区分"调 TodoPro"和"普通 bash"。普通 bash(如 npm test)不算推进。

**出口接口扩展**(同时修复的第二个断层):早期 `runTool` 只接受 `todos` 数组,模型没法表达 pause/abandon/acknowledge_stall。现在输入格式两种:
- 维护:`{"todos":[...]}`(全量替换)
- 三个出口:`{"action":"pause"}` / `{"action":"abandon"}` / `{"action":"acknowledge_stall"}`

`action` 映射:pause→session.status=paused,abandon→abandoned,acknowledge_stall→不改 session.status(只置推进标志放行本轮)。四个出口都置 `wrote_todo_this_round`(都算推进)。

**提示词占位替换**:prompts.js 里的提示词用 `<todopro-tool>` 占位(不写死平台路径,保持核心平台无关)。适配层调 `runStop(dir, toolPath)` 时传入实际脚本路径,`run-stop.js` 把占位替换成真实路径,模型拿到可用的命令。

**红线**:
- **不要**在 Claude Code/Codex 上假设有 "TodoPro" 注册工具。模型靠 Bash 调脚本。
- **不要**把 PostToolUse matcher 改回 `"TodoPro"`——那永远不触发。必须是 `Bash`/`shell`,靠命令内容识别。
- `isTodoProCall` 的正则 `/node\s+\S*todopro-tool\.js/` 是识别关键(P1-H4 收紧:要求 node 调用,不是字面出现,防 grep 误判),改脚本名要同步改正则。
- Hana 是例外:它用 `pi.registerTool` 注册了真工具(P0-H1 已接线:extensions/index.js 调 `registerTodoProTool(pi)`),`isTodoProCall` 也识别工具名 `TodoPro`。三条路径共存。
- **review_pending 限制**(P1-2 残留):review 引导后起的任何子 agent 都算 review 完成(钩子无法区分子 agent 用途)。靠 reviewGuide 提示词约束"本轮只起 review 子 agent"+ 熔断兜底。这是已知限制,不要试图在钩子层做用途区分(做不到)。

**测试教训**:tests/closed-loop.test.js 早期直接 `echo JSON | node todopro-tool.js` 调脚本,**绕过了"模型怎么调到工具"这层**,所以全绿但实际跑不通。tests/real-path.test.js 修复了这个断层:模拟模型用 Bash 工具调用(真实执行 + 触发 PostToolUse(Bash) 让钩子识别)。**加新功能时,测试必须走真实路径,不能绕过工具可达层。**

**另一个踩坑(已修)**:Hana 的 `resolveCore` 早期写 `path.join(__dirname, '..', '..', 'core', name)`,从 `extensions/` 出发 `..`×2 到了 `plugins/`(差一层),实际 core bundle 在 `plugins/todopro/core/`。部署后 `require` 找不到模块,插件加载即崩。正确是 `..`×1(`extensions/` → `plugins/todopro/`)+ `core`。`tools/todopro.js` 同样 bug 同样修。tests/cross-platform.test.js 12.4 守这条(部署后实测 resolveCore 路径)。**改 Hana 路径相关代码,必跑 12.4。**

---

## 五、平台钩子对照(改适配层时参考)

三平台事件语义高度对称,核心逻辑可共享。真正不可移植的只有"钩子配置怎么写进各平台配置文件"。

| 能力 | Claude Code | Codex | Pi/Hana |
|---|---|---|---|
| 拦截 turn 结束 | `Stop`(exit 2 / `decision:block` 阻断,`additionalContext` 续跑) | `stop`(`should_block`+`continuation_fragments`,**实现上 exit 2 + stderr**) | `turn_end` |
| 工具后注入 | `PostToolUse`(`additionalContext`) | `post_tool_use` | `tool_result` 事件 |
| 拦特定工具 | `PreToolUse` + matcher | `pre_tool_use` matcher | `tool_call` 事件 |
| 子 agent 结束 | `SubagentStop` | `subagent_stop` | `agent_end` |
| 内置 todo 工具 | `TodoWrite`(全量替换) | `update_plan`(全量替换) | 无 |
| 阻断+续跑机制 | JSON `decision:"block"`+`additionalContext`,exit 0 | exit 2 + stderr(stderr 当 continuation) | `sendUserMessage(text,{deliverAs:"followUp"})` 触发新 turn |

**关键差异(已踩坑)**:
- Codex 的 stop 阻断+续跑,最干净的方式是 **exit 2 + 把提示词写到 stderr**(Codex 把 stderr 内容作为 continuation_fragments 注入回对话)。不要用 JSON `decision:"block"`,那条路在 Codex 上 reason 作为 feedback 但续跑语义不如 stderr 直接。见 `src/platforms/codex/util.js` 的 `stopEmit`。
- Hana 的 `turn_end` **不能"阻止停止"**——它已经结束了。续跑靠 `sendUserMessage` 主动发一条消息触发新 turn。这等价于 Claude Code 的 block+additionalContext。
- Hana 的 `agent_end` 在主 agent 结束时也触发,需结合 `context.agentType` 判断是否在子 agent 内,避免主 agent 结束误置 `subagent_fired`。

**Skill 带不了钩子配置**:各平台的 Skill/技能机制只能带 SKILL.md + 脚本,**带不了钩子配置**。钩子配置在平台配置文件里:
- Claude Code:`.claude/settings.json` 的 `hooks` 字段
- Codex:`config.toml` 的 `[hooks]` 段
- Hana:full-access 插件自带 `extensions/`,装了就生效

因此"安装时必须有引导程序"(init.js)——它负责检测平台、把预制 hook 配置 merge 进对应配置文件、放好工具脚本和 SKILL.md、提示重载。这是跨平台唯一需要各写一份的部分,且是一次性安装逻辑。

---

## 六、代码组织规范

### 目录与职责

```
src/
├── core/                          # 平台无关(一份跑三平台)
│   ├── paths.js                   # .todopro/ 路径解析(TODOPRO_DIR 可覆盖,测试用)
│   ├── todo-store.js              # 全量替换+校验+稳定id+updated_at回填
│   ├── todo-md-mirror.js          # 只读 MD 镜像生成
│   ├── session-state.js           # 计数器+轮标志+熔断+硬上限
│   ├── touched-files.js           # 仅编辑类工具记录
│   ├── git-diff.js                # 非 git 降级返回空
│   ├── decide-stop.js             # Stop 决策表(纯函数,不吃 IO)
│   ├── prompts.js                 # 所有注入提示词模板(调措辞集中在此)
│   ├── cleanup.js                 # 删运行时文件保留预置
│   ├── run-stop.js                # 共享 Stop 执行(读状态→decide→副作用)
│   ├── run-post-tool-use.js       # 共享 PostToolUse 执行
│   └── run-todopro-tool.js        # 共享 TodoPro 工具入口
├── platforms/
│   ├── claude-code/               # 5 文件:util/stop-hook/post-tool-use/subagent-stop/todopro-tool + settings.hooks.json
│   ├── codex/                     # 5 文件:同结构,I/O 用 exit2+stderr
│   └── hana/                      # extensions/index.js + tools/todopro.js + manifest.json
└── install/
    └── init.js                    # 三平台引导(merge hooks+放脚本+SKILL+预置,幂等)
skills/todopro/
├── SKILL.md                       # 模型发现入口(description 是首要触发信号)
└── review-subagent-prompt.md      # 子 agent 审查规则(预置,复用不删)
tests/
├── closed-loop.test.js            # Claude Code 7 场景闭环
└── cross-platform.test.js         # 跨平台一致性 5 项
```

### 模块设计约定

- **`decide-stop.js` 是纯函数**:吃归一化事件,吐统一决策,**不直接做 IO**(不读写文件、不 exit)。副作用由 `run-stop.js` 执行。这样决策逻辑可单测、可在三平台共享。
- **`run-stop.js` / `run-post-tool-use.js` / `run-todopro-tool.js` 是共享执行层**:读状态 → 调 decide → 执行副作用(bump 计数/cleanup/reset flags)→ 返回决策。适配层只调它们,不重复这套逻辑。
- **副作用顺序**:`resetRoundFlags` 必须在 `cleanup` **之前**(见 `run-stop.js`)。否则 cleanup 删了 `session-state.json`,resetRoundFlags 又把它写回来。这是踩过的坑。
- **`session-state.write` 支持单参数**:`write(state)` 或 `write(dir, state)`。内部检测第一参数是对象则当 state。防止调用方漏传 dir 把 state 当 dir。
- **钩子失败必须降级放行**:所有 hook 脚本的 `catch` 块都 `exit 0`(Claude Code)或 `exit 0`(Codex),不阻断。钩子自身崩溃不能卡死用户。
- **`paths.js` 支持 `TODOPRO_DIR` 环境变量**:测试和自定义用。默认 `<cwd>/.todopro/`。

### 提示词措辞

所有注入主 agent 的文本集中在 `src/core/prompts.js`。改措辞只改这一个文件。原则:
- 标注来源("【TodoPro 监护】"),让模型明确提示来自哪。
- 注入量控制 ~1-2K,在用户可接受范围。
- review 引导必须明确:① 写需求总结(详细描述需求,不写实现方法)② 用原生子 agent ③ 只给文件路径不给内容 ④ 子 agent 自读 ⑤ 结果先查实均可忽略。
- 四选一必须明确四个出口及各自调用方式,且 pause/acknowledge_stall 的区别要说清。

### SKILL.md 规范

- `description` 是首要触发信号(模型 under-trigger 倾向,要写得偏 pushy)。
- 必须含:① 做什么 ② 何时触发(多步/多文件/要 review)③ 何时**不**用(小任务)④ 相比内置 todo 的增量。
- 触发线**偏严**:宁可漏掉中任务,别让小任务误触发重循环(有熔断兜底但每次 nudge 是钱)。
- body 解释 why(为何用全量替换、为何有 guard、review 为何可忽略),用 imperative 语气,例子优于规则。

---

## 七、测试

两套测试,零依赖(Node 内置 `assert`),改代码后都跑:

```bash
node tests/closed-loop.test.js      # Claude Code 7 场景闭环
node tests/cross-platform.test.js   # 跨平台一致性 5 项
```

### closed-loop.test.js(7 场景)
1. 小任务零开销:无 `.todopro` 时 Stop 放行
2. 建 todo 后本轮无推进 → 阻断+四选一
3. nudge 熔断:第 3 次放行交还用户+清理
4. 全完成 → review 引导 → 起子 agent → 放行+清理
5. review 熔断:连续不起子 agent → 跳过
6. 清理:删运行时文件保留 review-subagent-prompt
7. 优雅退化:用内置 todo 不触发任何机制

### cross-platform.test.js(5 项)
1. 核心脚本无平台分支(不 require platforms/)
2. 三平台适配层都 require 同一份 core
3. 同一状态下 Claude Code 与 Codex 决策一致(都阻断)
4. 两平台推进后均放行
5. 所有 .js 仅 require Node 内置或内部模块(零 npm 依赖)

### real-path.test.js(11 项)——真实路径,不绕过工具可达层
1-8:模型经 Bash 调用建 todo / 四选一 / acknowledge_stall / pause / abandon / 普通 bash 不算推进 / review 引导 / 优雅退化
9. 非 review 轮起的探索子 agent 不算 review 完成(仍阻断)
10. review 引导后起子 agent 算 review 完成(已知限制,提示词约束)
11. grep/cat 含 todopro-tool.js 字面字符串不算推进(正则要求 node 调用)

### hana-plugin.test.js(4 项)——Hana 插件真实 require(修元问题)
1. extensions/index.js 加载时调用 registerTool(P0-H1 接线验证)
2. handler 支持 todos 维护出口
3. handler 支持 action 出口(pause/abandon/acknowledge_stall)
4. schema 同时支持 todos 和 action(不互斥 required)

### touched-files.test.js(8 项)——extractFilePaths 单元测试
覆盖 Write/Edit/MultiEdit 的 file_path 提取 + apply_patch 的 patch 字符串提取(P1-1:+++ b/ 和 *** Add/Delete File 两种格式)+ isEditTool 识别 + 边界(无 input)。

**改代码后必跑这五套**(`closed-loop` + `cross-platform` + `real-path` + `hana-plugin` + `touched-files`)。加新平台或改决策逻辑,补对应测试。**真实路径测试(real-path / hana-plugin)不能省**——它们守着"模型真能调到工具"这层,closed-loop 测试绕过了这层会假绿。

**开发纪律**(reviewer 元建议):每修一个 bug,先写能复现原 bug 的失败测试,再修到绿。本轮修 P0-H1(先写 hana-plugin.test.js 复现"工具没注册"→ 修到绿)、P1-H4(先写 R11 复现"grep 误判推进"→ 修到绿)都遵循了这个纪律。不要直接改代码再补测试——那样测试只会验证你的修复,不会复现原 bug。

---

## 八、已知限制与开放问题(后续可做)

这些是**有意留白**,不是 bug。改前想清楚是否真的要做。

1. **review 不支持"每项完成都 review"**:当前默认只在"全部完成"触发一次。若某些长链路强依赖任务需要每步 review,后续做成可配阈值。当前非目标——与"切入要少"自洽。

2. **SKILL.md description 的精确措辞与触发线阈值**:预计超过 N 步 / 涉及多文件——经验值,实现后按模型和成本调。当前用"3+ 步 / 多文件 / 想要 review"。

3. **touched-files 记录范围**:当前只记编辑类工具(Write/Edit/MultiEdit/NotebookEdit/apply_patch),**不记 Bash/shell 写文件**(sed -i、echo > file 等),也不记读操作。原因:Bash 写太杂(可能跑测试、装包),噪音大;Bash 的文件改动靠 git diff 兜底。**注意:非 git 项目里,模型用 Bash 改的文件 touched-files.json 没有,review 子 agent 完全看不到——这是已知盲区**。若要补,matcher 加 Bash + extractFilePaths 从重定向提取(已有逻辑,只是 matcher 没配)。

4. **acknowledge_stall 与 pause 的提示词区分**:当前靠文字说明,实现后观察模型是否选对,调参。注意 acknowledge_stall 是轮级意图(经 action 调用,不改 session.status),不是会话级状态——若误设成 session.status,decide-stop 防御性当作 active 处理(不僵死)。

5. **pause 恢复**(P0-H3):pause 不是单向永久状态。模型 pause 后,再次用 `{todos:[...]}` 维护即自动恢复 active(todo-store.replace 检测:prevStatus=paused 且本次非 pause/abandon patch → 恢复 active)。早期版本 pause 后无法恢复(僵死),已修。

6. **Hana 适配层已接线但未实机验证**(P0-H1+H5):extensions/index.js 已调 `registerTodoProTool(pi)` 注册工具(P0-H1 修复),tests/hana-plugin.test.js 用 mock pi 真实 require 验证(P0-H5 修复元问题)。但 Hana 的 `agent_end` 在主 agent 也触发、`turn_end` 不能阻止停止等差异,仍需真实 Hana 环境跑一遍校准。Claude Code 和 Codex 已端到端验证。

7. **Codex 的 TOML hooks 配置格式**:init.js 追加的 `[[hooks.stop]]` 段基于动机文档 3.3 的 schema,实际 Codex 版本的 TOML 字段名可能微调,装时验证。路径用 TOML 字面字符串(单引号)包裹,含空格安全(P2-5 已修)。

8. **覆盖率**:走"用我们的工具才触发"路线,Claude Code 上模型用内置 TodoWrite 时整套机制不生效。这是接受的优雅退化。提高覆盖率靠 SKILL.md description,不靠拦内置 todo。

9. **Codex 放行提示对模型不可见**(P2-2):Codex 的 stop 钩子,阻断时 exit 2 + stderr(stderr 当续跑提示注入对话,模型可见 ✓);但**放行时**(熔断交还用户 / review 完成确认 / review 跳过)exit 0,提示词只进 stderr 日志,**模型看不到**。这是 Codex 的限制(exit 0 不注入对话),与 Claude Code(additionalContext 可见)行为不一致。接受——放行提示本质是给用户看的收尾,模型不需要据此行动。改的话要 exit 2 续跑一次只为送提示,代价大不划算。

10. **review-subagent-prompt.md 不入库**(P2-4):`.gitignore` 忽略 `.todopro/*`(除 README),所以 `.todopro/review-subagent-prompt.md` 不入库。源文件在 `skills/todopro/review-subagent-prompt.md`,**由 init 拷贝到 `.todopro/`**。新克隆者必须跑 init 才有这个文件。文档反复说"预置到 .todopro/"指的就是这个拷贝动作,不是入库。

11. **Hana 无等价行为测试**(P3-5 已部分修):tests/hana-plugin.test.js 用 mock pi 真实 require extensions/index.js,验证 registerTool 被调、handler 跑通 todos/action 出口。但这是 mock,真实 Pi 运行时的行为(事件触发时机、sendUserMessage 续跑)仍需实机验证。cross-platform.test.js 12.2 只验证 Claude Code 与 Codex 决策等价。所谓"三平台一致性"实际验证了两平台端到端 + Hana 的 mock 测试。

12. **review 子 agent 用途区分**(P1-2 残留已缓解):review 引导后(review_pending=true),起的子 agent **且 requirement-summary.md 已存在**才算 review 完成(SubagentStop 检查)。没写需求总结就起子 agent(跳步/探索)→ 不算,继续 nudge。这比"任何子 agent 都算"可靠:review 流程要求先写 requirement-summary.md。但仍有边角(写了 summary 后起探索子 agent 仍会被算),靠 reviewGuide 提示词约束"本轮只起 review 子 agent"+ 熔断兜底。tests/real-path.test.js R10/R10b 记录。

13. **isTodoProCall 正则局限**(N3):推进检测靠正则 `/node\s+.*?todopro-tool\.js/` 识别 shell 命令。优先防漏判(路径含空格→机制静默失效,后果严重),代价是 echo 文档字面串可能误判(true,概率低+熔断兜底)。正则解析 shell 命令固有不可靠,边角场景靠熔断兜底。

---

## 九、维护红线速查

改代码前,对照这张表。左边是"想做的事",右边是"能不能做、为什么"。

| 想做 | 能不能 | 为什么 |
|---|---|---|
| 拦内置 TodoWrite 提高覆盖率 | ❌ | 侵入性大,违背自主原则,用户不信任。靠 SKILL.md 吸引 |
| 假设 Claude Code/Codex 有 "TodoPro" 注册工具 | ❌ | 没有。模型靠 Bash 调脚本(决策 13)。matcher 必须是 Bash/shell |
| 把 PostToolUse matcher 改回 "TodoPro" | ❌ | 永远不触发。必须是 Bash/shell + 命令内容识别 |
| 测试绕过"模型怎么调到工具"这层 | ❌ | 必须走真实路径(tests/real-path.test.js)。直接调脚本会假绿 |
| 把任何子 agent 结束当 review 完成 | ❌ | 钩子层无法区分子 agent 用途。当前:review_pending 窗口内起子 agent + requirement-summary.md 存在才算 review(P1-2 残留修复)。仍有边角(见限制 12),靠提示词+熔断兜底 |
| 全量替换静默删除漏带项不给提示 | ❌ | P1-4 修复:removedIds.length > 0 时返回 warning。模型需看到才能确认是否有意 |
| 在 PostToolUse 对每个编辑注入建议 | ❌ | 违反原则 2(中间零干预)。只在边界点动手 |
| 让 review 的 CRITICAL 必须修 | ❌ | 违反原则 4。全部先查实均可忽略,否则放大消耗 |
| 加阻断分支但不配熔断 | ❌ | 违反原则 5。会卡死用户 |
| 在 src/core/ 引用 platforms/ | ❌ | 违反分层。核心平台无关,有测试守着 |
| 在适配层重写决策逻辑 | ❌ | 决策只有一份(decide-stop.js)。适配层只翻译 I/O |
| 引入 npm 依赖 | ❌(默认) | 零依赖是硬约束。有测试守着。实在要用先在本文件记理由 |
| 让 todo.md 可被模型直接编辑 | ❌ | 它是只读镜像。改 todo 走 todo.json |
| 合并 pause 和 acknowledge_stall | ❌ | 语义不同(长期挂起 vs 短期停一下)。合并丢意图 |
| 在干活过程中干预 Agent | ❌ | 违反原则 2。只在 Stop 和 todo 完成两个边界点 |
| 让 review 由脚本调 API | ❌ | 违反决策 5。改由主 Agent 原生子 agent 起,避 API key 问题 |
| 改 decide-stop 不跑测试 | ❌ | 改完必跑 closed-loop + cross-platform |
| 加新平台 | ✅ | 新建 src/platforms/<name>/,写薄适配层调 core,init.js 加分支。核心不动 |
| 调提示词措辞 | ✅ | 只改 src/core/prompts.js。注意注入量~1-2K |
| 调熔断阈值 | ✅ | 在 session-state.js 改常量(NUDGE_LIMIT/REVIEW_NUDGE_LIMIT/REVIEW_HARD_LIMIT)。文档同步 |
| 加新 review 分档 | ✅(谨慎) | 改 prompts + review-subagent-prompt.md。仍要"均可忽略" |
| 扩 touched-files 记读操作 | ✅(谨慎) | 改 touched-files.js 的 isEditTool。注意噪音 |

---

## 十、安装与使用

### 安装

```bash
git clone https://github.com/GGGuYu/todopro.git
node src/install/init.js
# ↑ 交互式选择平台(↑/↓导航,空格切换,回车确认),自动检测并预勾选
# 也可静默指定: node src/install/init.js --platform claude-code
# 或全量安装:  node src/install/init.js --platform all
# 重启平台 → hooks 生效
```

init 做的事:
1. 检测 Node(缺失报错退出)
2. **全局安装**:复制 `src/` + `skills/` 到 `~/.agents/skills/todopro/`(自包含,所有项目共享)
3. 检测平台并弹出交互式选择(或用 `--platform` 静默指定)
4. **Claude Code**:merge hooks 进 `.claude/settings.json`(**command 用全局绝对路径**,不依赖仓库在项目内;保留用户已有配置,幂等去重)、复制 SKILL.md 到 `.claude/skills/todopro/`、预置 `review-subagent-prompt.md` + README 到 `.todopro/`
5. **Codex**:追加 `[hooks]` 段到 `config.toml`(command 用全局绝对路径,幂等)、复制 SKILL.md、预置 review prompt
6. **Hana**:装 full-access 插件到 `${HANA_HOME}/plugins/todopro/`(manifest 复制;extensions/tools/core **软链到全局**,回退复制;skills 复制)、预置 review prompt
7. 提示重载

**`--update`**:`init --update` 只刷新全局安装(从仓库覆盖 `~/.agents/skills/todopro/`),不重配 hook。开发态更新代码后用。

**关键**:hooks 指向全局 `~/.agents/skills/todopro/`,**在任何项目目录都生效**,不依赖仓库在项目内。装一次,所有项目可用。

### 使用

模型在做多步/多文件任务时,看到 SKILL.md 的 description(暴露 review 增量),自主调用 TodoPro 工具。调用即开启监护。之后:
- 本轮没推进 todo 就停 → 被 nudge 四选一
- 全部完成 → 被引导起独立 review
- review 完成(或熔断)→ 放行 + 清理运行时文件

小任务(不调 TodoPro)零开销,与裸跑无异。

### .gitignore

`.todopro/` 运行时文件已 ignore(除 README.md)。`review-subagent-prompt.md` 源文件在 `skills/todopro/`,init 时拷贝到 `.todopro/`。

---

## 十一、相关文档

- `TODO-GATED-HARNESS-MOTIVATION.md` — 开任务前的完整调研与动机(HanaAgent/Pi/Claude Code/Codex 钩子能力盘点)
- `openspec/changes/todo-gated-harness/` — OpenSpec change(proposal/design/specs×7/tasks),设计决策的原始记录
- `.todopro/README.md` — 运行时目录各文件职责说明

改设计时,同步更新本文件 + OpenSpec design.md。两份不能脱节。
