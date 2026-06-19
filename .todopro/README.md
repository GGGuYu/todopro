# `.todopro/` 运行时目录

本目录由 TodoPro 在监护期间生成,会话放行退出时自动清理(除预置静态文件)。
已加入 `.gitignore`(除 `review-subagent-prompt.md` 源文件在 `skills/todopro/`,init 时拷贝到此)。

## 文件职责

| 文件 | 谁写 | 职责 | 清理时 |
|---|---|---|---|
| `todo.json` | 模型(经 TodoPro 工具全量替换)+ 钩子回填 `updated_at` | **唯一真相源**。完整 todo 列表 + session 状态。schema 见 design.md 决策 2 | 删 |
| `todo.md` | 钩子自动生成 | `todo.json` 的只读 Markdown 镜像,供人和模型查看。模型不应直接编辑 | 删 |
| `requirement-summary.md` | 主 Agent(review 时写) | 详细需求总结,**不写实现方法**。复写覆盖不追加。供 review 子 agent 读 | 删 |
| `review-subagent-prompt.md` | **我们预置**(init 时拷贝) | review 子 agent 的审查规则(CRITICAL/ISSUE/SUGGEST 分档、自读清单、输出格式)。复用不删 | **保留** |
| `touched-files.json` | PostToolUse 钩子自动 | 监护期间被编辑类工具碰过的文件路径清单(去重)。事实记录,不依赖模型 | 删 |
| `session-state.json` | 钩子维护 | 会话级状态:`session.status` / `review_done` / `nudge_count` / `review_nudge_count` / `wrote_todo_this_round` / `subagent_fired_this_round` / `review_total_count` | 删 |

## 生命周期

```
Agent 调用 TodoPro 工具(add 第一项)
  → 创建 .todopro/,写入 todo.json + session-state.json(status=active)
  → 开启监护

监护期间
  → 每次 TodoPro 调用:更新 todo.json,生成 todo.md,PostToolUse 置 wrote_todo_this_round
  → 每次编辑类工具:PostToolUse 追加 touched-files.json
  → 每次子 agent 调用:SubagentStop 置 subagent_fired_this_round
  → 每次 Stop:decide-stop 决策(放行/阻断注入四选一/阻断注入 review)

放行退出(review 满足或熔断)
  → cleanup 删除 todo.json/todo.md/requirement-summary.md/touched-files.json/session-state.json
  → 保留 review-subagent-prompt.md
  → .todopro/ 下一次会话从空开始
```
