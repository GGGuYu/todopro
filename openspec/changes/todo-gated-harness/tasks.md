## 1. 项目骨架与目录结构

- [x] 1.1 建立 `src/core/`(平台无关核心脚本)、`src/platforms/claude-code/`、`src/platforms/codex/`、`src/platforms/hana/`(各平台薄适配层)、`src/install/`(init 引导程序)、`skills/todopro/`(SKILL.md 与预置文件)目录
- [x] 1.2 定义 `.todopro/` 运行时目录结构与各文件职责(todo.json/todo.md/requirement-summary.md/review-subagent-prompt.md/touched-files.json/session-state.json)
- [x] 1.3 在仓库根添加 `.gitignore` 忽略 `.todopro/` 运行时文件(保留 review-subagent-prompt.md 等 prebuilt)

## 2. 核心数据层(平台无关,零依赖 Node)

- [x] 2.1 实现 `src/core/todo-store.js`:读写 `.todopro/todo.json`,全量替换语义,返回 oldTodos,校验"最多 1 个 in_progress",分配稳定 id(新增项给未使用 id),回填 updated_at
- [x] 2.2 实现 `src/core/todo-md-mirror.js`:`.todopro/todo.json` 变更后生成只读 `.todopro/todo.md` 镜像(checkbox 格式)
- [x] 2.3 实现 `src/core/session-state.js`:维护 session-state.json(session.status / review_done / nudge_count / review_nudge_count / wrote_todo_this_round / subagent_fired_this_round 等标志与计数,含复位逻辑)
- [x] 2.4 实现 `src/core/touched-files.js`:追加编辑过的文件路径到 touched-files.json(去重)
- [x] 2.5 实现 `src/core/git-diff.js`:用 child_process 跑 `git diff`,非 git 仓库时降级返回空

## 3. 核心判断逻辑(平台无关,Stop 钩子决策表)

- [ ] 3.1 定义统一内部事件表示 `{event, round_wrote_todo, session, todos}` 与统一决策表示 `{action: "allow"|"block", inject_text, reset_flags, do_cleanup}`
- [ ] 3.2 实现 `src/core/decide-stop.js`:Stop 钩子决策表(无会话/paused/abandoned→放行;有 pending+推进→放行;有 pending+没推进+nudge<2→阻断注入四选一;有 pending+没推进+nudge≥2→放行交还用户;全完成+未 review+rv_nudge<2→阻断注入 review;全完成+未 review+rv_nudge≥2→放行跳过;全完成+已 review→放行)
- [ ] 3.3 实现计数器复位逻辑(nudge→推进归零;rv_nudge→review 后新增 todo 归零;review 硬上限 3 次/会话)
- [ ] 3.4 实现子 agent 糊弄兜底:review 轮结束且 subagent_fired_this_round=false → rv_nudge++

## 4. 注入提示词模板(平台无关)

- [x] 4.1 编写四选一 nudge 提示词模板(说明本轮没推进 + 四个合法出口:维护/暂停/放弃/acknowledge_stall 及各自调用方式)
- [x] 4.2 编写熔断交还用户提示词模板(nudge≥2 / review 熔断 / review 硬上限 三种)
- [x] 4.3 编写 review 引导提示词模板(要求主 Agent 写详细需求总结到 requirement-summary.md 复写覆盖 + 用原生子 agent 机制起 review + 只给两个文件路径 + 子 agent 自读)
- [x] 4.4 预置 `skills/todopro/review-subagent-prompt.md`:子 agent 审查规则(CRITICAL/ISSUE/SUGGEST 分档定义、基本完成只提建议别钻牛角尖但 CRITICAL 必报、自读 requirement-summary/todo/touched-files/git diff、输出格式)

## 5. 清理逻辑(平台无关)

- [x] 5.1 实现 `src/core/cleanup.js`:放行退出时删除 todo.json/requirement-summary.md/touched-files.json/session-state.json,保留 review-subagent-prompt.md
- [x] 5.2 在 decide-stop 的"放行退出"分支挂上 do_cleanup 标志,由适配层在放行时调用

## 6. TodoPro SKILL.md

- [ ] 6.1 编写 `skills/todopro/SKILL.md`:description 暴露增量价值("比内置 todo 多提供完成时的独立 review 和漏洞复查,适合多步/多文件改造任务"),触发线偏严(预计超过 3 步/涉及多文件/有验证需求)
- [ ] 6.2 在 SKILL.md 写明 TodoPro 工具用法(全量替换、扩展 status、稳定 id、pause/abandon/acknowledge_stall 出口)

## 7. Claude Code 适配层(首选最小闭环平台)

- [x] 7.1 实现 `src/platforms/claude-code/stop-hook.js`:读 Claude Code Stop payload → 归一化事件 → 调 decide-stop → 反归一化为 exit 2 + additionalContext(或 exit 0 放行)
- [x] 7.2 实现 `src/platforms/claude-code/post-tool-use.js`:matcher 锁定 TodoPro 工具 → 置 wrote_todo_this_round;matcher 锁定编辑类工具 → 记 touched-files
- [x] 7.3 实现 `src/platforms/claude-code/subagent-stop.js`:置 subagent_fired_this_round=true
- [x] 7.4 实现 TodoPro 工具入口(Claude Code 自定义工具或 SKILL 引导的脚本调用):接收全量 todos → 调 todo-store 写盘 → 生成 MD 镜像 → 返回 oldTodos
- [x] 7.5 编写 `.claude/settings.json` 的 hooks 配置片段(Stop/PostToolUse/SubagentStop 指向对应脚本)

## 8. Claude Code 最小闭环验证

- [x] 8.1 验证小任务零开销:不调 TodoPro 工具时,所有钩子不触发,与裸跑无异
- [x] 8.2 验证循环出口兜底:建 TodoPro todo 后中途停止不维护 → 阻断注入四选一;选维护 → 放行;选 pause/abandon/acknowledge_stall → 放行
- [x] 8.3 验证 nudge 熔断:连续 2 次不推进 → 第 3 次交还用户放行
- [x] 8.4 验证完成 review:全部 completed → 阻断注入 review 引导 → 主 Agent 起原生子 agent → 子 agent 自读文件 + git diff → 分档输出回主 Agent
- [x] 8.5 验证 review 熔断与硬上限:子 agent 糊弄不起 → rv_nudge++ → 熔断;连续 3 次 review 后第 4 次直接放行
- [x] 8.6 验证清理:放行退出后 .todopro/ 运行时文件被删,review-subagent-prompt.md 保留
- [x] 8.7 验证优雅退化:模型用内置 TodoWrite 不用 TodoPro 时,机制完全不触发

## 9. Codex 适配层

- [ ] 9.1 实现 `src/platforms/codex/stop-hook.js`:Codex `stop` 事件 → 归一化 → decide-stop → `should_block`+`block_reason`+`continuation_fragments`
- [ ] 9.2 实现 Codex post_tool_use 适配(TodoPro matcher 置标志、编辑类 matcher 记 touched-files)与 subagent_stop 适配
- [ ] 9.3 实现 Codex 的 TodoPro 工具入口(Codex 自定义工具机制)
- [ ] 9.4 编写 `config.toml` 的 `[hooks]` 配置片段

## 10. Hana(Pi)适配层

- [ ] 10.1 实现 Hana full-access 插件 `extensions/`:turn_end/tool_call/tool_result/agent_end 事件接入 → 归一化 → decide-stop → context.afterUser 注入
- [ ] 10.2 实现 Hana 的 TodoPro 工具入口(restricted 插件 `tools/`)
- [ ] 10.3 复用同一份核心脚本(验证 sampleText 路径与原生子 agent 机制在 Pi 上可用)

## 11. init 引导程序

- [ ] 11.1 实现 `src/install/init.js`:检测平台(存在 .claude/ / codex config / hana 插件目录),接受 `--platform` 参数跳过自动检测
- [ ] 11.2 实现 Claude Code 安装:merge hooks 进 .claude/settings.json(不覆盖用户已有),放核心脚本与适配层,放 SKILL.md 到技能目录
- [ ] 11.3 实现 Codex 安装:merge `[hooks]` 进 config.toml,放脚本与 SKILL.md
- [ ] 11.4 实现 Hana 安装:装 full-access 插件(extensions/) + restricted 插件(tools/、skills/)
- [ ] 11.5 init 完成后输出重载提示("请重启/重载以使钩子生效")
- [ ] 11.6 init 检测 Node 存在性,缺失则报错退出

## 12. 跨平台一致性验证

- [ ] 12.1 验证核心脚本三平台共用同一份(无平台特定分支)
- [ ] 12.2 验证三平台归一化事件与反归一化输出契约一致(同一决策在三平台产生等价行为)
- [ ] 12.3 验证三平台均零 npm 依赖(纯 node 内置模块运行)
