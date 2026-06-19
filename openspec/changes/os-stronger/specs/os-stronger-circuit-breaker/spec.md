## ADDED Requirements

### Requirement: Review cycle counting via tasks.md markers

The main agent SHALL determine the current review cycle number by scanning tasks.md for task lines matching the pattern `Review N Fix -`. The cycle number N SHALL be the highest integer found in such markers, or 1 if no markers exist.

#### Scenario: First review cycle

- **WHEN** no `Review N Fix` markers exist in tasks.md
- **THEN** the current review cycle is determined to be Review 1

#### Scenario: Second review cycle

- **WHEN** tasks.md contains `Review 1 Fix` markers but no `Review 2 Fix` markers
- **THEN** the current review cycle is determined to be Review 2

### Requirement: Max 2 review cycles

The review workflow SHALL run at most 2 cycles. After Review 2 completes (all Review 2 Fix tasks are done), the agent SHALL suggest archiving regardless of whether any issues remain.

#### Scenario: Review 2 is the final cycle

- **WHEN** the agent determines the current cycle is Review 2
- **THEN** the agent includes in the subagent prompt: "This is the final review cycle. Only flag CRITICAL issues that would break functionality."
- **AND** after fixing Review 2 tasks, suggests archiving without triggering another review

#### Scenario: Review 1 finds no issues worth fixing

- **WHEN** Review 1 completes and the main agent determines no findings are worth immediate fix
- **THEN** the agent suggests archiving immediately
- **AND** no Review 2 cycle is triggered

#### Scenario: Review 2 finds issues but circuit breaks

- **WHEN** Review 2 finds issues that would warrant fixes
- **THEN** the main agent creates `Review 2 Fix` tasks and completes them
- **AND** after completion, suggests archiving
- **AND** does NOT trigger a Review 3 cycle

### Requirement: Fix task naming convention

Fix tasks created from review findings SHALL follow the naming pattern: `Review N Fix - <brief description>`.

#### Scenario: Fix task format

- **WHEN** a finding is accepted as true and worth fixing
- **THEN** the task is written as `- [ ] Review 1 Fix - Missing error handling in auth module`
- **AND** the pattern `Review \d+ Fix` is used for cycle counting
