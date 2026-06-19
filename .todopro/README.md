# `.todopro/` 运行时目录

本目录由 TodoPro 在监护期间生成,会话放行退出时自动清理(除预置静态文件)。
源文件在 `skills/todopro/`,init 时拷贝/生成到此。

| 文件 | 谁写 | 职责 | 清理时 |
|---|---|---|---|
| `todo.json` | 模型(经 TodoPro 工具全量替换)+ 钩子回填 updated_at | 唯一真相源。完整 todo 列表 + session.status | 删 |
| `todo.md` | 钩子自动生成 | todo.json 的只读 Markdown 镜像 | 删 |
| `requirement-summary.md` | 主 Agent(review 时写) | 详细需求总结,不写实现方法。复写覆盖 | 删 |
| `review-subagent-prompt.md` | 预置(init 拷贝) | review 子 agent 审查规则。复用不删 | **保留** |
| `touched-files.json` | PostToolUse 钩子自动 | 监护期间被编辑类工具碰过的文件路径 | 删 |
| `session-state.json` | 钩子维护 | 会话级状态(计数、轮标志、review_done) | 删 |

> 此文件由 `init` 自动生成,不入库(.gitignore 忽略 .todopro/* 但保留 README)。
> 仓库中保留此文件是为了让 clone 后直接可读;init 会覆盖更新。
