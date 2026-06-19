## 1. 核心文件创建

- [ ] 1.1 创建 `.claude/skills/os-stronger/SKILL.md`：说明 os-stronger 是什么、何时触发、review 流程概述。YAML frontmatter 包含 name/description。
- [ ] 1.2 创建 `.todopro/review-guide.md`：子 agent 审查规则。复用 `skills/todopro/review-subagent-prompt.md` 内容，调整为：severity 分档（CRITICAL/ISSUE/SUGGEST）、功能正确性优先、反钻牛角尖指引、advisory 声明（"main agent 自行判断是否属实+是否值得立即修"）、输出格式。

## 2. Init 脚本（os-stronger-init.js）

- [ ] 2.1 实现 `os-stronger-init.js` 主流程：检查 OpenSpec 已安装 → 备份原文件 → 调用 patcher → 创建 review-guide.md → 创建 SKILL.md → 报告结果。零 npm 依赖，纯 Node。
- [ ] 2.2 实现 `patchApplyChange(skillPath)` 函数：读取 `openspec-apply-change/SKILL.md`，定位 `state: "all_done"` 所在行，将 "congratulate, suggest archive" 替换为 review workflow block。替换文本包含：检查 `.todopro/review-guide.md` 是否存在 → 是则写 requirement summary → 起子 agent（甩路径不读内容）→ 评估 findings → 建 Review N Fix task → cycle counting → archive 判断。若已打过补丁则跳过（幂等）。
- [ ] 2.3 实现 `patchPropose(skillPath)` 函数：读取 `openspec-propose/SKILL.md`，在 tasks.md 模板说明中追加一句提示："如果项目已启用 os-stronger，最后一条 task 建议提醒 agent 全部完成后走 review 流程"。若已打过补丁则跳过（幂等）。
- [ ] 2.4 实现 `--restore` 标志：从备份恢复原始 OpenSpec skill 文件，删除 `.todopro/review-guide.md` 和 `.claude/skills/os-stronger/`。

## 3. Review workflow 提示词（注入到 apply-change 的文本）

- [ ] 3.1 编写 review workflow 注入文本：包含完整的分步指令——写 requirement summary、起 review 子 agent（指定要读的文件路径）、评估子 agent findings、建 fix task、cycle 计数、archive 判断。
- [ ] 3.2 注入文本包含 Review 2 熔断说明和示例：明确 "如果 task 已经是 Review 2 Fix → 这是最后一轮，修完直接 archive，不再 review"。
- [ ] 3.3 注入文本包含 fix task 命名格式示例：`Review 1 Fix - Missing error handling in auth module`、`Review 2 Fix - Token refresh not implemented`。

## 4. 测试

- [ ] 4.1 单元测试：`patchApplyChange` 函数对模拟 SKILL.md 文本的替换正确性（原文本 → 期待输出）。
- [ ] 4.2 单元测试：`patchPropose` 函数替换正确性。
- [ ] 4.3 幂等性测试：对已打过补丁的文件再次运行，确认不会重复注入。
- [ ] 4.4 `--restore` 测试：打补丁 → restore → 验证文件恢复原样。
- [ ] 4.5 错误场景测试：OpenSpec 未安装时 `os-stronger init` 报错退出。

## 5. 文档

- [ ] 5.1 更新 AGENTS.md：新增 os-stronger 设计决策（patch-based hook、路径传递、circuit breaker）。
- [ ] 5.2 更新 README.md：添加 os-stronger 使用说明（`os-stronger init` / `--restore`）。
