# Story pre-4-s4: Document Stub→Real Slice Pattern in project-context.md

Status: done

## Story

As a developer agent implementing a multi-slice feature,
I want the stub→real slice pattern documented in `project-context.md`,
so that I apply it correctly when building features with 4+ tool slices rather than reinventing the approach or wiring everything in a single story.

## Context

The stub→real slice pattern was applied across Epic 2.5 (11 slices) and validated as a formal doctrine by PM decision in the Epic 2.5 retrospective. It was committed as Action #1 in that retro but never written down, because the commit condition was "next epic with 4+ tool slices" — a condition that never self-triggered. This story removes that condition and writes the documentation now, before Epic 6 (grocery) and Epic 7 (memory) — both of which will need this pattern.

**Source:** `_bmad-output/implementation-artifacts/epic-2.5-retro-2026-05-23.md` Action #1; Epic 3 retro `_bmad-output/implementation-artifacts/epic-3-retro-2026-05-25.md` item D1.

## Acceptance Criteria

1. **Given** `_bmad-output/project-context.md`,
   **When** a developer reads it before implementing a multi-slice feature,
   **Then** they find a clear description of the stub→real pattern with: what it is, when to use it, how to apply it, and a concrete example.

2. **Given** the new section,
   **When** it describes the pattern,
   **Then** it covers: (a) stub slice creates tool factory with deterministic/noop return, (b) each subsequent moment slice replaces one stub with real DB persistence, (c) contract lands in the stub slice enabling parallel review, (d) trigger condition (≥4 tool slices in one feature).

3. **Given** the updated file,
   **When** it is read end-to-end,
   **Then** the new section reads naturally alongside the existing architecture and workflow rules — no redundancy, no contradiction with existing content.

## Tasks / Subtasks

### Task 1 — Add "Implementation Patterns" section to `project-context.md` (AC: 1, 2, 3)

**File:** `_bmad-output/project-context.md`

Add a new top-level section **after the "Critical Don't-Miss Rules" section** (currently ending around line 376) and **before the "Usage Guidelines" section** (currently starting around line 387).

**Section to add:**

```markdown
## Implementation Patterns

### Stub→Real Slice Progression

**When to use:** Any feature that introduces ≥4 agent tool calls with separate DB persistence tables. Validated across Epic 2.5 (11 slices), adopted as doctrine.

**What it is:** The foundation slice (s1 or equivalent) creates all tool factories with stub implementations — deterministic return values, no real DB writes, correct Zod schemas. Each subsequent moment slice replaces exactly one stub with real DB persistence. The contract and tool interface land in the stub slice; real wiring lands per-slice.

**Why it works:**
- Contract-landing is decoupled from wiring — downstream consumers can build against the interface immediately
- Each subsequent slice is independently reviewable (one stub → one real implementation per PR)
- Parallel review is possible because the interface is stable from slice 1
- Rollback is cheaper — a bad DB implementation doesn't corrupt the tool interface

**How to apply:**
1. **Foundation slice** — define all tool Zod schemas, all tool factory functions, stub implementations returning deterministic UUIDs / empty arrays / success: true. Wire into orchestrator. Ship to review.
2. **Moment slices (one per tool)** — replace one stub with: migration, repository method, service call. The tool's Zod schema is unchanged. Ship each slice independently.
3. **Completion slice** — finalize gate logic that reads across all now-real tables (e.g., required-set completeness check).

**Example from Epic 2.5:**
- `2.5-s1` (foundation): created stub tool factories for `allergen.declare`, `cuisine.declare`, `bag.declare`, `favorite_lunch.add` with deterministic UUIDs
- `2.5-s6` through `2.5-s9` (moment slices): each replaced one stub with real DB persistence (`child_allergens`, `food_preferences`, `bag_composition_pattern`, `recipes`/`household_recipe_usage`)
- `2.5-s10` (completion): required-set gate reading across all now-real tables

**Do NOT apply when:** The feature has 1–3 tool calls, or all tool calls share one table (single migration + wiring is cleaner than staggered stubs).
```

- [x] Add "Implementation Patterns" section after "Critical Don't-Miss Rules" (before "Usage Guidelines")
- [x] Include the stub→real subsection with all four points: what, why, how, example
- [x] Confirm the section does not duplicate or contradict existing content in the file
- [x] Update the `Last Updated` line at the bottom of the file to `2026-05-25`

## Dev Notes

### File Location

`_bmad-output/project-context.md` — this is the primary AI agent context file read by the bmad-create-story and bmad-dev-story agents before all implementation work.

### Exact Insertion Point

After the line `**Anti-patterns to actively reject**` block ends (around line 376), before `---` separator and `## Usage Guidelines` heading (around line 387). The new section sits between the rules content and the usage guidelines.

### No Code Changes

This story touches only `_bmad-output/project-context.md`. No TypeScript, no migrations, no test files.

### Style Guide for the File

The existing file uses `##` for top-level sections, `###` for subsections, bold for emphasis, bullet lists for enumerated rules. Match this style exactly. The file uses no emojis in the main content. Keep the tone direct and prescriptive (imperative mood for rules, plain description for patterns).

### References

- Pattern origin: [Source: `_bmad-output/implementation-artifacts/epic-2.5-retro-2026-05-23.md` — "What Went Well #2: Stub→real migration pattern"]
- Action item: [Source: `_bmad-output/implementation-artifacts/epic-2.5-retro-2026-05-23.md` — Action #1]
- Insertion location: [Source: `_bmad-output/project-context.md` lines ~376–387]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Sonnet 4.6) via Claude Code, bmad-dev-story workflow.

### Debug Log References

None — documentation-only change, no code or test execution.

### Completion Notes List

- Inserted the new `## Implementation Patterns` section between the existing `---` separator (after "Critical Don't-Miss Rules") and `## Usage Guidelines`. The new section has its own trailing `---` separator so the section pattern (heading → content → `---`) stays consistent.
- Section content matches the story's task spec verbatim — same headings, same emphasis, same example. No paraphrasing.
- Style guide adherence verified: `##` top-level + `###` subsection, bold-emphasis labels, numbered list for the "How to apply" procedure, bullet lists for "Why it works" and the Epic 2.5 example, no emojis.
- Redundancy check (grep for `stub|slice|tool factor`): the only other mentions are `slice` in the Zustand selector rule (line 133) and `stubbed OpenAI responses` in the agent test rule (line 191). Both are unrelated concepts; no overlap or contradiction with the new section.
- `Last Updated` field at the bottom changed from `2026-04-23` → `2026-05-25` to reflect the doctrine-write date per the story.

### File List

- `_bmad-output/project-context.md` — modified (new "Implementation Patterns" section + Last Updated bump)
- `_bmad-output/implementation-artifacts/pre-4-s4-stub-real-pattern-documentation.md` — modified (status, task checkboxes, Dev Agent Record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (pre-4-s4 status transitions)

### Review Findings

- [x] [Review][Patch] Example 2.5-s9 table reference is post-migration retroactive — `recipes`/`household_recipe_usage` reflects the 2.6-s1 migration outcome, not what 2.5-s9 actually wired; 2.5-s9 shipped `FavoriteLunchesRepository` against `favorite_lunches`; the slash notation also implies one slice touched two tables, contradicting the "one stub per slice" description [_bmad-output/project-context.md, Implementation Patterns section]
- [x] [Review][Patch] Completion slice step 3 appears mandatory by numbered structure but not all features have cross-table gate logic — add "if the feature requires a cross-table completeness gate" qualifier so agents don't invent unnecessary gate checks [_bmad-output/project-context.md, How to apply step 3]
- [x] [Review][Defer] Partial table-sharing edge case not covered in trigger condition — "≥4 tool calls with separate DB persistence tables" is undefined when N tools share K<N tables; the "Do NOT apply when" addresses the all-share extreme but not partial-share; covered by general migration invariants in the file — deferred, pre-existing
- [x] [Review][Defer] FK-dependency migration ordering gap — pattern does not address the case where two stubs share a foreign-key dependency making independent per-slice deployments operationally impossible; general migration rules in the file provide the guard — deferred, pre-existing

## Change Log

| Date       | Change                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-05-26 | Documented the stub→real slice progression pattern in `project-context.md` (Epic 2.5 retro Action #1). Doc-only, no code. |
