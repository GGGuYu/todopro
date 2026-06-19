## ADDED Requirements

### Requirement: os-stronger init patches openspec-apply-change SKILL.md

The init script SHALL read `.claude/skills/openspec-apply-change/SKILL.md`, locate the `state: "all_done"` handling section, and replace the existing "congratulate, suggest archive" text with a review workflow block.

The review workflow block SHALL include:
- Instructions to check if `.todopro/review-guide.md` exists (boolean check, do not read content)
- If it does NOT exist: congratulate and suggest archive (unchanged behavior)
- If it EXISTS: write requirement summary, launch review subagent with file paths, evaluate findings, manage review cycles

#### Scenario: Init on a project with OpenSpec already installed

- **WHEN** user runs `os-stronger init` in a project where `openspec init` has already been run
- **THEN** the script patches `.claude/skills/openspec-apply-change/SKILL.md` to include the review workflow at the `all_done` branch
- **AND** creates `.todopro/review-guide.md` with subagent review rules
- **AND** creates `.claude/skills/os-stronger/SKILL.md` describing the enhancement

#### Scenario: Init is idempotent

- **WHEN** user runs `os-stronger init` a second time in the same project
- **THEN** the script detects existing patches and either skips or refreshes them
- **AND** does not duplicate injection text

#### Scenario: Init without OpenSpec installed

- **WHEN** user runs `os-stronger init` in a project where `openspec init` has NOT been run
- **THEN** the script reports an error with a clear message: "OpenSpec not found. Run `openspec init` first."
- **AND** exits without making changes

### Requirement: os-stronger init creates review-guide.md

The init script SHALL create `.todopro/review-guide.md` with content adapted from the existing `skills/todopro/review-subagent-prompt.md`.

The review guide SHALL include:
- Severity tiers: CRITICAL (functional correctness broken), ISSUE (functional concern but workable), SUGGEST (style/optimization, optional)
- Instruction to focus on functional correctness: "Does the implementation logic actually work? Is each task genuinely completed?"
- Anti-nitpicking guidance: "Do not block on style preferences, naming opinions, or minor optimizations"
- Explicit statement: "These findings are advisory. The main agent will independently judge whether each is true and worth fixing now."
- Output format specification for returning findings to the main agent

#### Scenario: Review guide content is correct

- **WHEN** `os-stronger init` creates `.todopro/review-guide.md`
- **THEN** the file contains all required sections (severity tiers, functional focus, anti-nitpicking, advisory notice, output format)
- **AND** the file is self-contained (subagent can understand its task by reading only this file)

### Requirement: os-stronger init creates the os-stronger SKILL.md

The init script SHALL create `.claude/skills/os-stronger/SKILL.md` describing what os-stronger is and when to use it.

The SKILL.md SHALL include:
- A description explaining that os-stronger enhances OpenSpec with independent review
- Instructions that the enhancement is automatically active once `os-stronger init` has been run
- A note that the agent should follow the review workflow when `openspec-apply-change` reports `all_done`

#### Scenario: SKILL.md is created

- **WHEN** `os-stronger init` runs successfully
- **THEN** `.claude/skills/os-stronger/SKILL.md` exists with valid YAML frontmatter and content
