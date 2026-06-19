---
name: todopro
description: Enhanced todo tool for multi-step, multi-file change tasks. Use instead of the built-in todo tool when a task involves 3+ steps, modifies multiple files, or benefits from an independent review before delivery. Provides loop-exit guarding (prevents forgetting to maintain todos) and an independent subagent review of the completed work against the original requirement. Use for non-trivial implementation tasks, refactors spanning multiple files, or any work where you want a second-pass check before finishing. Do NOT use for trivial tasks (greetings, single-file edits, git commit, build/install) — those should use the built-in todo tool or none at all.
---

# TodoPro — todo-gated agent harness

## When to use this skill

Use TodoPro **instead of** the built-in todo tool when the task is non-trivial:

- **3+ steps** of real work, or
- **modifies multiple files**, or
- you want an **independent review** of the completed work against the requirement before delivering.

Do **not** use TodoPro for trivial tasks — greetings, single-line fixes, `git commit`, build/install commands. Those gain nothing from the guard and review, and the built-in todo tool (or no todo at all) is the right choice. TodoPro's mechanism only activates when you call the TodoPro tool, so opting in is your choice — but once you opt in, the guard holds you accountable.

## What TodoPro gives you beyond the built-in todo

| Capability | Built-in todo | TodoPro |
|---|---|---|
| Track steps | yes | yes (same full-replace semantics, zero learning cost) |
| Persists to disk | no (ephemeral) | yes (`.todopro/todo.json`) |
| Loop-exit guard | no | **yes** — if you stop without advancing the todo, you're nudged to pick a clear exit (maintain / pause / abandon / acknowledge-stall) |
| Independent review on completion | no | **yes** — when all todos complete, an independent subagent reviews your work against the requirement |
| File tracking | no | **yes** — files you edit during the guarded session are auto-recorded for the reviewer |

The guard and review only fire **after you choose to use TodoPro**. They never fire for tasks where you used the built-in todo or no todo.

## The TodoPro tool

TodoPro uses **full-replace semantics** — identical to the built-in `TodoWrite`. Every call sends the complete todo list; the new list overwrites the previous one. You already know how to use it.

### Status values

Each todo has a `status`. The first three match the built-in tool; the last two are TodoPro extensions:

- `pending` — not started
- `in_progress` — currently working (at most **one** todo may be `in_progress` at a time)
- `completed` — done
- `paused` — paused the whole session (long-term; the guard stops until you resume). Use when waiting on the user or an external condition.
- `abandoned` — cancelled this requirement (direction was wrong, or no longer needed). Use to explicitly withdraw.

### Stable ids

Each todo has a stable `id` (e.g. `t1`, `t2`). **Keep the id when you modify an item** — this lets the guard track which items actually changed across your full-replace calls. New items get an id assigned automatically; just omit `id` for them.

### Example call

First call (create the list):

```json
[
  { "id": "t1", "content": "Add the /export endpoint", "status": "in_progress", "priority": "high" },
  { "id": "t2", "content": "Wire up the CSV serializer", "status": "pending", "priority": "high" },
  { "id": "t3", "content": "Add tests for export", "status": "pending", "priority": "medium" }
]
```

Later, after finishing t1 (send the **whole** list again, keeping ids):

```json
[
  { "id": "t1", "content": "Add the /export endpoint", "status": "completed", "priority": "high" },
  { "id": "t2", "content": "Wire up the CSV serializer", "status": "in_progress", "priority": "high" },
  { "id": "t3", "content": "Add tests for export", "status": "pending", "priority": "medium" }
]
```

## What the guard does (so you're not surprised)

Once you've created a TodoPro list, the guard watches two boundary points — and **only** those two. It never interrupts you mid-work.

1. **When you try to stop without advancing the todo.** If you stop a turn but didn't touch the TodoPro todo this turn (no check, no add, no update) and there are still pending items, you'll get a nudge asking you to pick one of four clear exits:
   - **Maintain** — check off what's done, or add/adjust items (advancing the todo releases you)
   - **Pause** (`paused`) — the whole session suspends; the guard leaves you alone until you resume
   - **Abandon** (`abandoned`) — you're withdrawing this requirement
   - **Acknowledge stall** — you knowingly didn't advance this one turn; you're released for this turn but the guard resumes next turn (unlike pause, this is short-term)

   The point is to turn "forgot to maintain the todo" (a silent failure) into an explicit choice. You're not forced to *finish* — pause/abandon/acknowledge are all legitimate exits. You're only forced to *pick one*.

2. **When all todos complete.** The guard asks you to run an independent review: write a detailed requirement summary to `.todopro/requirement-summary.md`, then spawn a subagent (using your native Task/subagent mechanism) that reads the summary plus the pre-written `.todopro/review-subagent-prompt.md` and independently reviews your work. The reviewer outputs CRITICAL/ISSUE/SUGGEST findings — **all of which you verify first, then decide whether to fix; all are ignorable**. If you fix things by adding new todos, a fresh review round triggers.

Both guards have circuit breakers (max 2 nudges each, then control returns to the user) and there's a hard cap of 3 reviews per session, so you can never get stuck in a loop.

## A note on the review

The review is a *second opinion*, not a command. The reviewer is told: if the work basically satisfies the requirement, only make suggestions — don't nitpick — but CRITICAL issues (logic errors, security, data loss) must be reported even when the work is basically done.

Your job on receiving the review: **verify each finding objectively first** (is it actually true?), then decide whether it's worth fixing *for this requirement*. You may ignore any finding. Don't mechanically act on every suggestion — that wastes tokens. But don't dismiss a CRITICAL without checking it.

## Installation

TodoPro requires a one-time init per platform (Claude Code / Codex / Hana) to install the hooks. Run:

```bash
node src/install/init.js --platform claude-code
```

(Replace the platform as needed.) The init merges hook config into the platform's config file, places the core scripts, and installs this skill so the model can discover and use it. Reload the platform after init for hooks to take effect.
