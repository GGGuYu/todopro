// src/core/prompts.js
// 平台无关:注入提示词模板。所有注入主 agent 的文本集中在此,便于调措辞。
// 仅用 Node 内置模块(零依赖)。
//
// spec: loop-exit-guard(四选一/熔断)/ completion-review(review 引导/熔断/硬上限)
// design: 决策 6(分档均可忽略)/ 决策 4(四选一)
//
// 所有提示词都标注"这是 TodoPro 的监护提示",让模型明确来源。
// 注入量控制在 ~1-2K,在用户可接受范围。

// ─── 循环出口兜底:四选一 nudge ───
function nudgeFourWay(attempt) {
  return [
    '【TodoPro 监护】检测到本轮你没有推进 todo(未对 TodoPro todo 做任何写操作),但仍有未完成项。',
    '',
    '请从以下四个合法出口中选择一个,明确你的意图(不能什么都没选就退出):',
    '',
    '1. **维护**:用 TodoPro 工具 check 掉做完的项,或 add 新增项、update 调整。推进了即放行。',
    '2. **暂停**(pause):用 TodoPro 把 session.status 设为 `paused`——整个会话挂起,停止监护(通常用于等用户/外部条件)。',
    '3. **放弃**(abandon):用 TodoPro 把 session.status 设为 `abandoned`——方向错了,显式撤销本次需求。',
    '4. **知情停顿**(acknowledge_stall):本轮 knowingly 不推进。用 TodoPro 把 session.status 设为 `acknowledge_stall`——放行本轮,下轮继续监护(区别于 pause 的长期挂起)。',
    '',
    `(本次提醒第 ${attempt} 次,共 ${2} 次。超过将交还用户。)`,
  ].join('\n');
}

// ─── nudge 熔断:交还用户 ───
function nudgeCircuitBreak() {
  return [
    '【TodoPro 监护】已连续多次提醒未推进 todo,交还用户决定。',
    '',
    '如果你(用户)希望继续,请直接指示 agent 维护 todo 或继续干活;否则可忽略。',
  ].join('\n');
}

// ─── review 引导:引导主 agent 起原生子 agent ───
function reviewGuide(attempt) {
  return [
    '【TodoPro 监护】所有 todo 项已完成。请进行交付前的独立 review:',
    '',
    '**第 1 步**:把本次需求的【详细总结】写入 `.todopro/requirement-summary.md`:',
    '  - 详细描述需求本身(要解决什么问题、约束、验收标准)',
    '  - **不要**写实现方法(让 review 子 agent 自己据需求去审查,不被实现带偏)',
    '  - 复写覆盖整个文件,不要追加(避免与上次需求混淆)',
    '',
    '**第 2 步**:用你的原生 Task/subagent 机制起一个独立 review 子 agent,只给它两个文件路径(不要把内容塞给它):',
    '  - `.todopro/requirement-summary.md`(你刚写的需求总结)',
    '  - `.todopro/review-subagent-prompt.md`(预置的审查规则)',
    '',
    '子 agent 会自己读这两个文件 + `.todopro/todo.json` + `.todopro/touched-files.json` + `git diff`,',
    '在全新上下文中独立审查本次改动,输出 CRITICAL/ISSUE/SUGGEST 分档结果。',
    '',
    '收到结果后:**所有档先客观查实是否属实,再考虑针对当前需求修不修,均可忽略**。',
    '若要修复,用 TodoPro 新增 todo 去修;修完会触发新一轮 review。',
    '',
    `(本次 review 提醒第 ${attempt} 次,共 ${2} 次。超过将跳过 review。本会话最多 3 次 review。)`,
  ].join('\n');
}

// ─── review 完成:确认 ───
function reviewDoneAck() {
  return [
    '【TodoPro 监护】已完成本轮独立 review。本次需求监护结束,放行退出。',
    '',
    '运行时文件已清理。下次开新需求重新用 TodoPro 建 todo 即可。',
  ].join('\n');
}

// ─── review 熔断:跳过 ───
function reviewCircuitBreak() {
  return [
    '【TodoPro 监护】review 提醒已达上限,跳过本次 review,放行退出。',
    '',
    '运行时文件已清理。建议你(用户)事后自行检查本次改动质量。',
  ].join('\n');
}

// ─── review 硬上限 ───
function reviewHardLimit() {
  return [
    '【TodoPro 监护】本会话已完成 3 次 review,达到硬上限,不再触发 review,放行退出。',
    '',
    '运行时文件已清理。若仍需审查请开新需求。',
  ].join('\n');
}

module.exports = {
  nudgeFourWay,
  nudgeCircuitBreak,
  reviewGuide,
  reviewDoneAck,
  reviewCircuitBreak,
  reviewHardLimit,
};
