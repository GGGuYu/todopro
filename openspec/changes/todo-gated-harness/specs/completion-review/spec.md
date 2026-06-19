## ADDED Requirements

### Requirement: 全部完成时触发 review
系统 SHALL 在检测到所有 todo 项均为 completed(无 pending/in_progress/paused)且本会话尚未 review 时,在 Stop 钩子注入提示引导主 Agent 起独立 review。

#### Scenario: 全部完成触发 review 注入
- **WHEN** Stop 钩子触发,所有 todo 项为 completed,session.review_done=false
- **THEN** 系统 SHALL 阻断退出并注入 review 引导提示词

### Requirement: review 由主 Agent 用原生子 agent 机制起
系统 SHALL 通过注入提示词引导主 Agent 使用其原生 Task/subagent 机制起 review 子 agent,不提供"内部调 API 的 review 工具"。

#### Scenario: 主 Agent 起原生子 agent
- **WHEN** 主 Agent 收到 review 注入提示
- **THEN** 主 Agent SHALL 用其平台原生子 agent 机制(Claude Code Task / Codex subagent / Pi sampleText)起一个独立 review,而非调用本系统提供的内部 API 工具

### Requirement: 主 Agent 只写需求总结不读大文件
系统 SHALL 要求主 Agent 仅完成两件事:写需求总结文件 + 调原生起子 agent;主 Agent 全程不读 review-subagent-prompt.md,以避免上下文膨胀。

#### Scenario: 主 Agent 写需求总结
- **WHEN** 主 Agent 处理 review 注入提示
- **THEN** 主 Agent SHALL 将详细需求总结写入 `.todopro/requirement-summary.md`,详细描述需求本身但**不写实现方法**,复写覆盖不追加

#### Scenario: 主 Agent 给子 agent 文件路径而非内容
- **WHEN** 主 Agent 起子 agent
- **THEN** 主 Agent SHALL 只传给子 agent 两个文件路径(`.todopro/requirement-summary.md` 与 `.todopro/review-subagent-prompt.md`),不把文件内容塞进子 agent 上下文

### Requirement: 子 agent 全新上下文自读一切
review 子 agent SHALL 在与主 Agent 完全无关的全新上下文中运行,自己读取所需文件。

#### Scenario: 子 agent 自读所需信息
- **WHEN** review 子 agent 启动
- **THEN** 子 agent SHALL 自行读取:requirement-summary.md / review-subagent-prompt.md / todo.json / touched-files.json / git diff,不依赖主 Agent 传递内容

### Requirement: 需求总结复写覆盖不累积
系统 SHALL 要求每次 review 都重写 `.todopro/requirement-summary.md`,复写覆盖,不与上次需求混。

#### Scenario: 复写覆盖
- **WHEN** 主 Agent 写需求总结
- **THEN** 系统 SHALL 覆盖文件原内容,不追加;确保前后需求不混淆

### Requirement: review 结果分档且全部先查实均可忽略
review 子 agent SHALL 输出按 CRITICAL/ISSUE/SUGGEST 分档的结果。主 Agent SHALL 对所有档先客观查实,查实后按当前需求自行判断修不修,**均可忽略**。分档是严重度标签帮主 Agent 分配注意力,不是"必须修 vs 可忽略"的硬分界。

#### Scenario: 子 agent 分档输出
- **WHEN** review 子 agent 完成审查
- **THEN** 子 agent SHALL 将发现按 CRITICAL(逻辑错/安全/数据丢失)/ISSUE(客观事实性问题)/SUGGEST(建议性)分档输出

#### Scenario: 主 agent 先查实再判修
- **WHEN** 主 Agent 收到分档 review 结果
- **THEN** 主 Agent SHALL 先客观查实每条是否属实,再考虑针对当前需求修不修,任何档均可忽略

#### Scenario: 子 agent 不钻牛角尖
- **WHEN** review 子 agent 判断需求基本能完成
- **THEN** 子 agent SHALL 只提建议(SUGGEST),不钻牛角尖;但 CRITICAL 级问题即使基本完成也必须报

### Requirement: review nudge 熔断
系统 SHALL 对 review nudge 次数设上限:最多自动 nudge 2 次。

#### Scenario: review 熔断跳过
- **WHEN** 同一会话 review_nudge_count 已达 2,且 review 仍未完成
- **THEN** 系统 SHALL 放行退出并注入"review 已跳过"提示

#### Scenario: review 后新增 todo 则 review 计数归零
- **WHEN** review 完成后 Agent 新增 todo(去修 review 发现的问题)
- **THEN** 系统 SHALL 将 review_nudge_count 归零,给新一轮 review 机会

### Requirement: 单会话 review 硬上限
系统 SHALL 对单个会话的 review 总次数设硬上限 3 次,作为防死循环最后一道闸。

#### Scenario: 达硬上限直接放行
- **WHEN** 单会话已完成 3 次 review,第 4 次 review 到期
- **THEN** 系统 SHALL 直接放行退出并注入"已达 review 上限"提示,不再触发 review

### Requirement: 子 agent 糊弄兜底
系统 SHALL 通过 SubagentStop 钩子记录 `subagent_fired_this_round` 标志;review 轮结束时若该标志未亮(主 Agent 未真起子 agent),SHALL 算一次 rv_nudge。

#### Scenario: 主 Agent 糊弄不起子 agent
- **WHEN** review 轮结束,subagent_fired_this_round=false
- **THEN** 系统 SHALL 视为一次 review nudge(rv_nudge++),靠熔断兜底
