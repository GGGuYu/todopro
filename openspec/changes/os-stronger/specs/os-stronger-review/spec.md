## ADDED Requirements

### Requirement: Main agent writes requirement summary before review

When the patched `openspec-apply-change` reaches `state: "all_done"` and `.todopro/review-guide.md` exists, the main agent SHALL write a requirement summary to `.todopro/requirement-summary.md` before launching the review subagent.

The requirement summary SHALL describe:
- What the change was supposed to accomplish (from proposal/design)
- The scope of changes made
- Any known limitations or areas needing attention

#### Scenario: Main agent writes summary before first review

- **WHEN** all OpenSpec tasks are complete and review-guide.md exists
- **THEN** the main agent writes `.todopro/requirement-summary.md` with the change's purpose and scope
- **AND** does NOT read review-guide.md (only checks its existence)

#### Scenario: Main agent reuses existing summary on subsequent review cycles

- **WHEN** a second review cycle is triggered (Review 2)
- **THEN** the main agent may update the existing `.todopro/requirement-summary.md` if scope changed
- **AND** does not need to rewrite it from scratch

### Requirement: Main agent launches review subagent with paths

The main agent SHALL launch a review subagent and instruct it to read specific files by path. The main agent SHALL NOT inline the content of these files into the subagent prompt.

Files to reference by path:
- `.todopro/review-guide.md` — review rules and output format
- `.todopro/requirement-summary.md` — what to check against
- `openspec/changes/<name>/tasks.md` — what was done
- Git diff of the working directory — what actually changed

#### Scenario: Subagent receives path-based instructions

- **WHEN** the main agent launches a review subagent
- **THEN** the subagent prompt contains file paths, not file contents
- **AND** the subagent reads each file independently

#### Scenario: Main agent's context is not bloated

- **WHEN** the review workflow is triggered
- **THEN** the main agent does NOT read the contents of review-guide.md into its own context
- **AND** the main agent's context window remains lean for the review turn

### Requirement: Main agent evaluates subagent findings independently

When the review subagent returns findings, the main agent SHALL evaluate each finding against its own knowledge of the codebase. The main agent SHALL judge:
1. Whether the finding is actually true (factual accuracy)
2. Whether the finding is worth fixing immediately (urgency vs. cost of delay)

Findings that are untrue or not worth immediate fix SHALL NOT generate new tasks.

#### Scenario: Main agent accepts and acts on valid findings

- **WHEN** subagent returns a finding that the main agent confirms is true AND worth fixing now
- **THEN** the main agent creates a new task in tasks.md: `- [ ] Review N Fix - <description>`
- **AND** resolves the finding before continuing

#### Scenario: Main agent rejects a false or trivial finding

- **WHEN** subagent returns a finding that the main agent determines is incorrect or too minor
- **THEN** the main agent does NOT create a fix task
- **AND** may note the rejection in its response to the user

### Requirement: Review subagent uses severity tiers

The review subagent SHALL classify each finding using three severity tiers as defined in review-guide.md:
- **CRITICAL**: Functional correctness is broken. The implementation does not work as described in the requirement.
- **ISSUE**: Functional concern exists but the implementation is workable. May cause problems in edge cases.
- **SUGGEST**: Style, optimization, or improvement idea. Optional.

#### Scenario: Subagent properly classifies findings

- **WHEN** subagent reviews the change
- **THEN** each finding is tagged with exactly one severity tier
- **AND** CRITICAL findings are reserved for actual functional breaks, not style preferences
