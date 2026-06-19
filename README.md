<div align="center">

# TodoPro

**Todo-gated agent harness — give your AI coding agent a guardrail and an independent reviewer, only when the work is non-trivial.**

[现状](#现状) · [为什么](#为什么) · [工作原理](#工作原理) · [安装](#安装) · [平台支持](#平台支持) · [配置](#配置) · [开发](#开发) · [设计文档](#设计文档)

</div>

---

TodoPro is an opt-in enhancement for AI coding agents (Claude Code, Codex, HanaAgent). It replaces the built-in todo tool with one that **persists to disk**, **guards the loop exit** (won't let the agent silently drift away from an unfinished todo), and **runs an independent review** when all todos complete.

The key idea: **the heavy machinery only activates when the agent *chooses* to use TodoPro.** Small tasks (greetings, a git commit, a build) never touch it and run at zero overhead. The agent opts in by calling the TodoPro tool — that single action is the gate.

```
                    agent didn't call TodoPro          agent called TodoPro
                    (trivial task)                      (non-trivial task)
                              │                                │
                              ▼                                ▼
                       zero overhead                    guardrail engages
                       runs like bare agent             ┌────────────────┐
                                                      │ loop-exit guard │  ← can't silently abandon
                                                      │ completion      │  ← independent review
                                                      │   review        │     on all-done
                                                      │ file tracking   │  ← auto, for the reviewer
                                                      └────────────────┘
```

## 现状

> ⚠️ **Early / experimental.** The core loop is implemented and tested on Claude Code and Codex (simulated). The Hana adapter is written against the Pi SDK but not yet validated on a live Hana install. See [已知限制](#已知限制).

- ✅ Core logic (platform-agnostic, zero-dependency Node)
- ✅ Claude Code adapter — end-to-end tested (7/7 closed-loop scenarios)
- ✅ Codex adapter — end-to-end tested (exit-2 + stderr continuation semantics)
- ✅ Cross-platform consistency tests (5/5)
- ✅ `init` installer for all three platforms
- ⚠️ HanaAgent adapter — written, not yet validated on a live install
- 🧪 Real-task validation pending

## 为什么

Modern "heavy harness" CLI agents (Claude Code, Codex) get a lot of their reliability not from the model but from the **harness layer**: context compaction, todo-completion hooks, independent subagent review, behavior-constraining prompts. These make ordinary models stronger — at the cost of more tokens, and tied to a specific platform.

The "minimal harness" school (Pi / HanaAgent) keeps the skeleton complete and hooks wide open, but ships **none** of the guard/review strategies. Powerful and塑性强, but bare out of the box.

TodoPro asks: **can we make those strengthening mechanisms portable, and have them cost nothing on small tasks?**

The answer is the gate. Judging "is this task big" is expensive and unreliable (you'd need to predict intent). But **"did the agent itself reach for our tool" is free and accurate** — the agent's own judgment is the filter. Small tasks never trigger anything; large tasks get a guardrail and a review, because the agent asked for it.

## 工作原理

### 1. The gate: opt-in, not imposed

TodoPro's mechanisms activate **only after the agent calls the TodoPro tool**. It does **not** intercept the built-in todo (`TodoWrite` / `update_plan`). If the agent uses the built-in todo or none at all, TodoPro stays dormant — identical to a bare run.

This is an accepted **graceful degradation**: coverage depends on the agent choosing TodoPro, which we encourage via the [SKILL.md](skills/todopro/SKILL.md) description (exposing the review + guardrail as the incremental value), never by force.

### 2. Loop-exit guard: force a decision, not completion

When the agent tries to stop a turn but didn't advance the todo (no TodoPro write this turn) and there are pending items, TodoPro blocks the exit and asks the agent to pick one of four explicit exits:

| Exit | Meaning |
|---|---|
| **Maintain** | Check off what's done, or add/adjust items (advancing releases you) |
| **Pause** (`paused`) | Suspend the whole session — guard leaves you alone until you resume (long-term, e.g. waiting on the user) |
| **Abandon** (`abandoned`) | Withdraw this requirement — direction was wrong |
| **Acknowledge stall** | Knowingly didn't advance *this one turn*; released for this turn, guard resumes next turn (short-term) |

The point: turn "forgot to maintain the todo" (a silent failure) into an explicit, conscious choice. The agent is never forced to **finish** — pause/abandon/acknowledge are all legitimate. It's only forced to **pick one** rather than drift out silently.

Circuit breaker: max 2 nudges, then control returns to the user.

### 3. Completion review: an independent second opinion

When all todos are complete, TodoPro asks the agent to run an independent review:

1. The agent writes a **detailed requirement summary** to `.todopro/requirement-summary.md` (what the requirement was — *not* how it was implemented).
2. The agent spawns a **subagent using its native mechanism** (Claude Code `Task`, Codex subagent, Pi `sampleText`), giving it only **two file paths**.
3. The subagent reads those files + `todo.json` + `touched-files.json` + `git diff` in a **fresh context** (completely independent of the agent's possibly-300K-token history) and reviews the work against the requirement.
4. Findings come back tiered as **CRITICAL / ISSUE / SUGGEST**.

Crucially: **all findings are verify-first, then ignore-able.** The tiers are attention labels, not "must-fix vs ignore" boundaries. The agent verifies each finding objectively, then decides whether to fix *for this requirement* — any tier may be ignored. The reviewer is told: if the work basically satisfies the requirement, only make suggestions; but CRITICAL issues (logic errors, security, data loss) must be reported even when basically done.

The agent is **not** forced to mechanically act on every finding (that would balloon tokens). It's forced to **verify first**.

Why this design (not "script calls the API to run review"): it avoids cross-platform API-key differences, and the agent's "requirement summary" generation hits the prompt cache (based on existing conversation) — only the summary is newly computed.

Circuit breakers: max 2 review-nudges, and a hard cap of **3 reviews per session**. The main agent can't get stuck in a review→fix→review loop.

### 4. File tracking: automatic, for the reviewer

While the guard is active, a PostToolUse hook (matching edit-class tools only) automatically records touched file paths to `.todopro/touched-files.json`. This is a **fact** recorded by the hook, not the agent's responsibility. The reviewer reads it alongside `git diff` — the two are complementary (touched-files covers non-git projects and read-but-not-modified files; git diff has the actual change content).

### 5. Cleanup: delete, on exit

When the session finally exits (review done or circuit-broken), TodoPro deletes the runtime files (`todo.json`, `todo.md`, `requirement-summary.md`, `touched-files.json`, `session-state.json`) so consecutive requirements don't mix. The pre-written `review-subagent-prompt.md` is kept for reuse.

## 安装

### 前置

- **Node.js ≥ 18** (TodoPro uses only built-in modules — no `npm install`, no dependency conflicts with your project)

### 一行安装

```bash
git clone <repo-url> todopro && cd todopro
node src/install/init.js
```

首次运行会弹出**交互式多选提示**，自动检测当前环境中的平台并预勾选，用 ↑/↓ 导航、空格切换、回车确认即可一键安装。

也可用 `--platform` 静默指定（适用于 CI / 自动化）：

```bash
node src/install/init.js --platform claude-code   # 单平台
node src/install/init.js --platform all            # 全部平台
```

安装后**重启/重载**你的 Agent 平台以使 hooks 生效。

### `init` 做了什么

| 平台 | 动作 |
|---|---|
| **Claude Code** | Merges hooks into `.claude/settings.json` (preserves your existing config, idempotent), places `SKILL.md` at `.claude/skills/todopro/`, pre-writes `review-subagent-prompt.md` to `.todopro/` |
| **Codex** | Appends a `[hooks]` block to `config.toml` (marked, idempotent), places `SKILL.md`, pre-writes the review prompt |
| **Hana** | Installs a full-access plugin to `${HANA_HOME}/plugins/todopro/` (manifest + extensions + tools + skills + bundled core), pre-writes the review prompt. Requires enabling "允许全权插件" in Hana settings |

`init` is **idempotent** — running it twice won't duplicate hook entries.

### 交互式选择

不带 `--platform` 参数时，`init` 弹出交互式多选提示：

```
  TodoPro init

  ✓ Node v26.3.0 已安装

  已检测到: Claude Code

  ? 请选择要安装的平台 (↑/↓ 导航, 空格切换, 回车确认):
    ❯ ◼ Claude Code         ✓ 已检测到
      ◻ Codex
      ◻ Hana
    (↑/↓ 导航, 空格切换, 回车确认, a 全选/取消, Ctrl+C 退出)
```

- 自动检测当前环境已安装的平台并**默认勾选**
- 未检测到的平台也可手动选择（适合跨环境部署）
- 选多个平台会依次串行安装
- 按 `a` 全选/取消，`Ctrl+C` 优雅退出

## 使用

After install, the agent discovers TodoPro via the `SKILL.md` description. On non-trivial tasks (3+ steps, multiple files, or wanting a pre-delivery review), it calls the TodoPro tool itself — that's the gate engaging.

You don't configure anything per-task. Either:
- **Let the agent decide** — it'll reach for TodoPro when the task is big enough (the description is written to make this likely), or
- **Tell it** — "use TodoPro for this" / "this is a multi-file change, track it with TodoPro"

Small tasks (a greeting, a single edit, `git commit`, a build) — the agent won't call TodoPro, and nothing happens. Zero overhead.

### TodoPro tool semantics

Identical to the built-in `TodoWrite` — **full-replace**: every call sends the complete todo list, overwriting the previous one. The agent already knows how to use it. Extensions:

- **Status**: `pending` · `in_progress` · `completed` (built-in) + `paused` · `abandoned` (TodoPro)
- **Stable `id`** per item (e.g. `t1`, `t2`) — keep the id when modifying an item so the guard can diff what changed. New items get an id assigned automatically.
- **Constraint**: at most one `in_progress` at a time (same as built-in).

## 平台支持

| Platform | Adapter | Internal todo | Status |
|---|---|---|---|
| **Claude Code** | `Stop` / `PostToolUse` / `SubagentStop` hooks (`settings.json`) | `TodoWrite` | ✅ tested |
| **Codex** | `stop` / `post_tool_use` / `subagent_stop` hooks (`config.toml`) | `update_plan` | ✅ tested |
| **HanaAgent** | Pi SDK events `turn_end` / `tool_result` / `agent_end` (full-access plugin) | none | ⚠️ written, not yet validated live |

The core logic is **one codebase** running on all three. Each platform only contributes a thin adapter that translates its hook I/O into a common event/decision format. See [AGENTS.md](AGENTS.md) §三 for the architecture.

## 配置

### 熔断阈值

In `src/core/session-state.js`:

```js
const NUDGE_LIMIT = 2;          // loop-exit nudges before returning control to user
const REVIEW_NUDGE_LIMIT = 2;   // review nudges before skipping review
const REVIEW_HARD_LIMIT = 3;    // hard cap on reviews per session
```

These are empirical defaults. Tune per model and cost tolerance — there's no universal number.

### 运行时目录

`.todopro/` holds the runtime state (gitignored except the pre-written prompt). Per-file purpose is documented in [`.todopro/README.md`](.todopro/README.md). Override the location with the `TODOPRO_DIR` env var (useful for testing).

## 开发

```bash
# 跑测试(零依赖,只用 Node 内置 assert)
node tests/closed-loop.test.js      # Claude Code 7 场景闭环
node tests/cross-platform.test.js   # 跨平台一致性 5 项
```

### 项目结构

```
src/
├── core/            # 平台无关核心(一份跑三平台,零 npm 依赖)
├── platforms/       # 薄适配层(claude-code / codex / hana),只做 I/O 翻译
└── install/         # init 引导程序
skills/todopro/      # SKILL.md(模型发现入口)+ review-subagent-prompt.md(预置)
tests/               # closed-loop + cross-platform
```

**改代码前必读 [AGENTS.md](AGENTS.md)** — 它记录了每个设计决定的"为什么"和不能乱改的红线。

### 加新平台

1. 新建 `src/platforms/<name>/`,写薄适配层(归一化 hook payload → 调 `core/run-stop` → 反归一化决策为平台输出格式)
2. 在 `src/install/init.js` 加安装分支
3. 核心逻辑**不用动**(平台无关)
4. 补跨平台测试

## 设计文档

| 文档 | 给谁看 | 内容 |
|---|---|---|
| **[AGENTS.md](AGENTS.md)** | 维护者(人或 agent) | 设计原则、12 项决策来龙去脉、分层契约、维护红线速查 |
| [TODO-GATED-HARNESS-MOTIVATION.md](TODO-GATED-HARNESS-MOTIVATION.md) | 想了解背景的人 | 开任务前的完整调研(HanaAgent/Pi/Claude Code/Codex 钩子能力盘点) |
| [openspec/changes/todo-gated-harness/](openspec/changes/todo-gated-harness/) | 维护者 | OpenSpec change(proposal / design / specs×7 / tasks),设计决策原始记录 |
| [skills/todopro/SKILL.md](skills/todopro/SKILL.md) | AI agent | 模型发现入口,触发条件与工具用法 |
| [.todopro/README.md](.todopro/README.md) | 维护者 | 运行时目录各文件职责 |

## 已知限制

- **Coverage is opt-in.** On Claude Code, if the agent uses the built-in `TodoWrite` instead of TodoPro, none of the machinery engages. Accepted graceful degradation — we improve coverage via the SKILL.md description, never by intercepting the built-in tool.
- **Review fires once on all-complete** (not per-item). Per-step review is a possible future config; currently out of scope to keep interventions minimal.
- **Hana adapter not yet validated live.** The `extensions/index.js` is written against Pi SDK event signatures but Hana's `agent_end` fires for the main agent too, and `turn_end` can't "block" — these need calibrating on a real Hana install.
- **Codex TOML hook format** is based on the schema documented at implementation time; verify against your Codex version on install.
- **SKILL.md trigger thresholds** ("3+ steps / multiple files") are empirical and may need tuning per model.

## 设计原则速览

1. **Gate = opt-in.** Mechanisms activate only when the agent calls TodoPro. Never intercept the built-in todo.
2. **Two boundary points only.** Hooks fire at loop-exit and todo-completion. Zero intervention mid-work.
3. **Force a decision, not completion.** pause/abandon/acknowledge are all legitimate exits. The agent must pick one, not drift out silently.
4. **Review is advice, not command.** All findings verify-first, all ignore-able. Tiers are attention labels.
5. **Every block has a fuse.** Circuit breakers on every blocking branch; hard cap on reviews. Mathematically un-loopable.

> Full rationale in [AGENTS.md](AGENTS.md) §二.

## License

MIT
