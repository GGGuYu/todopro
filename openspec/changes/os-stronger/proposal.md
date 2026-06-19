## Why

OpenSpec's apply-change workflow ends at "all tasks complete → suggest archive" with no quality gate. An agent can mark tasks `[x]` and declare victory even when the implementation has gaps — missed edge cases, incomplete task fulfillment, or logic errors. This is especially risky for multi-step, multi-file changes where the agent may lose context across turns. We need an independent review step that fits naturally into the OpenSpec workflow without platform hooks, without external dependencies, and without burdening the main agent's context window.

## What Changes

- **New SKILL.md (`os-stronger`)**: A companion skill that teaches the agent to run an independent subagent review after all OpenSpec tasks complete, before archiving.
- **New `os-stronger init` script**: A Node script that enhances an OpenSpec-initialized project by:
  1. Creating `.todopro/review-guide.md` — subagent review rules (reused from TodoPro's existing review-subagent-prompt.md)
  2. Patching `openspec-apply-change/SKILL.md` — injecting a review step at the `state: "all_done"` branch
  3. Patching `openspec-propose/SKILL.md` — suggesting a review reminder in generated tasks.md
- **Review workflow**: Main agent writes a requirement summary, launches a subagent with review instructions and file paths, then evaluates subagent findings against its own judgment.
- **Circuit breaker**: Max 2 review cycles, tracked via `Review N Fix` markers in tasks.md. If Review 2 completes, archive regardless — prevents infinite loops on inherently complex changes.
- **Non-mandatory findings**: Subagent marks each finding with severity (CRITICAL/ISSUE/SUGGEST). Main agent independently judges whether each finding is actually true and worth fixing immediately. Findings that are deferred or rejected do not block archiving.

## Capabilities

### New Capabilities

- `os-stronger-init`: The init script that patches OpenSpec skills and creates the review infrastructure. Zero dependencies, pure Node.js, works on any project with OpenSpec already initialized.
- `os-stronger-review`: The review workflow itself — requirement summary writing, subagent launch with path-based instructions, finding evaluation by main agent, fix-task creation with cycle tracking.
- `os-stronger-circuit-breaker`: Review cycle counting via tasks.md markers. Max 2 cycles. If review passes on any cycle (no findings worth immediate fix), archive immediately. If Review 2 completes with unresolved findings, archive with a warning.

### Modified Capabilities

None — os-stronger is purely additive. It does not modify OpenSpec's core behavior; existing projects without `os-stronger init` run identically.

## Impact

- Affected files: `.claude/skills/openspec-apply-change/SKILL.md` (patched), `.claude/skills/openspec-propose/SKILL.md` (patched), `.claude/skills/os-stronger/SKILL.md` (new), `.todopro/review-guide.md` (new)
- Reuses: `skills/todopro/review-subagent-prompt.md` content for review-guide.md
- No external dependencies. No changes to OpenSpec CLI. No platform hooks.
- User must run `os-stronger init` once per project (after `openspec init`). Re-run after `openspec update` if patches are overwritten.
