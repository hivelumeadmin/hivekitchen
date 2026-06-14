# Story 5-S11: Adaptive Lumi Tone / Length

Status: done

> **Folds:** story 5.10 (full), PRD FR61, FR63 partial
> **Epic:** 5 — Household Coordination & Ambient Intelligence

---

## Story

As a parent talking to Lumi at different times of day,
I want her tone and response length to match the moment,
so that Sunday evening check-ins feel warm and reflective while Tuesday morning queries get quick, efficient answers.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | A new `getTimeOfDayBand(date: Date): TimeOfDayBand` helper (UTC hour) classifies the current moment: `morning` (05–11), `afternoon` (12–16), `evening` (17–21), `night` (22–04). |
| AC2 | `LumiAgentRespondInput` gains an optional `conversationalContext?: { timeOfDayBand: TimeOfDayBand }` field. |
| AC3 | `LumiAgent.buildSystemPrompt()` appends a `# Conversational Context` section when `conversationalContext` is present, containing the band and its associated length/tone instruction (see AC4–AC5). |
| AC4 | For `morning` and `afternoon` bands, the section reads: `"The parent is likely in a hurry. Keep your reply to one or two sentences — direct and warm, not terse."` |
| AC5 | For `evening` and `night` bands, the section reads: `"The parent has time to reflect. A warm 2–4 sentence reply is welcome — be specific to this family, not generic."` |
| AC6 | The existing base persona, surface prompt, household snapshot, current surface, and recent actions sections are NOT modified — only the new section varies. |
| AC7 | `submitTextTurn()` in `lumi.service.ts` computes `timeOfDayBand` server-side (`getTimeOfDayBand(new Date())`) and passes it as `conversationalContext` to `agent.respond()`. |
| AC8 | `processVoiceUtterance()` in `lumi.service.ts` also computes and passes `conversationalContext` so voice turns receive the same tone adaptation. |
| AC9 | Unit tests cover: `getTimeOfDayBand` boundary cases (04:59→`night`, 05:00→`morning`, 11:59→`morning`, 12:00→`afternoon`, 17:00→`evening`, 22:00→`night`); `buildSystemPrompt` contains the morning instruction when band is `morning`; contains the evening instruction when band is `evening`; prompt is unaffected when `conversationalContext` is absent. |
| AC10 | No DB migration. No changes to `LumiContextSignal` or any contract in `packages/contracts`. |

---

## Scope Notes

### What this slice ships

- **`apps/api/src/common/time-of-day.ts`** (new) — `TimeOfDayBand` type + `getTimeOfDayBand()` helper
- **`apps/api/src/agents/lumi.agent.ts`** — `conversationalContext` field on `LumiAgentRespondInput`; `buildSystemPrompt()` extended with `# Conversational Context` block
- **`apps/api/src/modules/lumi/lumi.service.ts`** — `conversationalContext` injected in `submitTextTurn()` and `processVoiceUtterance()`
- **Unit tests** for the helper and the prompt injection

### What is explicitly deferred

- **`last_active_at` / days-since-last-activity** — spec mentioned this field; deferred because no `last_active_at` column exists on the `households` table yet and the value-add is much smaller than time-of-day. Tracked as D-5S11-1.
- **Household timezone awareness** — time-of-day band uses UTC as a proxy; per-household tz is an Epic 8 feature. Band is a soft heuristic, not precision logic.
- **Per-surface tone overrides** — the surface prompt already carries surface-specific instructions; this slice adds a time layer on top, not per-surface divergence.

---

## Implementation Tasks

### Task 1 — `time-of-day.ts` helper

**File:** `apps/api/src/common/time-of-day.ts` (new)

```typescript
export type TimeOfDayBand = 'morning' | 'afternoon' | 'evening' | 'night';

export function getTimeOfDayBand(date: Date): TimeOfDayBand {
  const hour = date.getUTCHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}
```

No dependencies. Pure function — easy to unit test.

**Test file:** `apps/api/src/common/time-of-day.test.ts`
- Boundary cases from AC9: 04:59, 05:00, 11:59, 12:00, 16:59, 17:00, 21:59, 22:00, 23:59, 00:00

---

### Task 2 — Extend `LumiAgentRespondInput`

**File:** `apps/api/src/agents/lumi.agent.ts`

Add to the interface (after `modality`):

```typescript
conversationalContext?: {
  timeOfDayBand: TimeOfDayBand;
};
```

Import `TimeOfDayBand` from `../../common/time-of-day.js`.

---

### Task 3 — Extend `buildSystemPrompt()`

**File:** `apps/api/src/agents/lumi.agent.ts`

After the existing `# Recent Actions` block (lines 123–131), append:

```typescript
if (input.conversationalContext !== undefined) {
  const { timeOfDayBand } = input.conversationalContext;
  const instruction =
    timeOfDayBand === 'morning' || timeOfDayBand === 'afternoon'
      ? 'The parent is likely in a hurry. Keep your reply to one or two sentences — direct and warm, not terse.'
      : 'The parent has time to reflect. A warm 2–4 sentence reply is welcome — be specific to this family, not generic.';
  parts.push(`\n# Conversational Context\nTime of day: ${timeOfDayBand}\n${instruction}`);
}
```

---

### Task 4 — Inject context in `submitTextTurn()`

**File:** `apps/api/src/modules/lumi/lumi.service.ts`

In the `agent.respond(...)` call (currently lines 464–471), add:

```typescript
conversationalContext: { timeOfDayBand: getTimeOfDayBand(new Date()) },
```

Import `getTimeOfDayBand` from `../../common/time-of-day.js`.

---

### Task 5 — Inject context in `processVoiceUtterance()`

**File:** `apps/api/src/modules/lumi/lumi.service.ts`

Locate the `submitTextTurn(...)` call inside `processVoiceUtterance()`. The call already passes `contextSignal`, `modality: 'voice'`, and `userId`. No structural changes needed — `submitTextTurn` now derives `timeOfDayBand` internally (Task 4 handles it at the call site). No separate injection needed here because `processVoiceUtterance` delegates to `submitTextTurn`.

_Verify:_ confirm `processVoiceUtterance` calls `this.submitTextTurn(...)`. If it calls `agent.respond()` directly (not via `submitTextTurn`), add the same injection there.

---

### Task 6 — Unit tests for `buildSystemPrompt`

**File:** `apps/api/src/agents/lumi.agent.test.ts` (create if not present) or add to existing lumi agent test

Tests to add:
- `conversationalContext: { timeOfDayBand: 'morning' }` → prompt contains "in a hurry" / "one or two sentences"
- `conversationalContext: { timeOfDayBand: 'evening' }` → prompt contains "time to reflect" / "2–4 sentence"
- `conversationalContext` absent → prompt does NOT contain "# Conversational Context"
- Existing sections (surface, snapshot, recent actions) appear in correct order regardless of band

---

## Dev Notes

### Architecture fit

- **Agent is stateless** — `buildSystemPrompt()` is called fresh per turn; no caching risk.
- **No contract changes** — `conversationalContext` is added to the internal `LumiAgentRespondInput` interface only, not to any Zod schema in `packages/contracts`. The frontend never sends this field.
- **`LUMI_MAX_TOKENS = 400`** is unchanged — the prompt instruction is directional guidance, not a token cap. The model may occasionally exceed 2 sentences in the morning; that is acceptable.
- **Warm not casual, concise not terse** — wording in AC4 is intentional. See `docs/AI Principles.md`: Lumi's baseline character must not shift, only the length.
- **No changes to surface prompts** — surface instructions already handle planning vs. cooking vs. recap context. Time-of-day sits above surface context as a length modifier only.

### Source tree components to touch

| File | Change |
|------|--------|
| `apps/api/src/common/time-of-day.ts` | New — helper + type |
| `apps/api/src/common/time-of-day.test.ts` | New — boundary tests |
| `apps/api/src/agents/lumi.agent.ts` | Interface + `buildSystemPrompt` |
| `apps/api/src/modules/lumi/lumi.service.ts` | `submitTextTurn` call site |

No migration. No frontend changes. No contract changes.

### Testing standards

- **Unit only** — E2E tests cannot assert LLM tone variation without a live model. The unit tests assert prompt string content, which is the meaningful contract here.
- **Deterministic test inputs** — pass an explicit `Date` object (e.g., `new Date('2026-06-07T06:00:00Z')`) rather than `new Date()`.
- Pattern from prior stories: spy on or replace `this.openai.chat.completions.create` to capture the `messages[0].content` (system prompt) and assert on its substring.

### Project Structure Notes

- `time-of-day.ts` goes in `apps/api/src/common/` alongside `voice-tier.ts` (the pattern established in 5-S16 for shared domain helpers).
- `lumi.agent.ts` is the single source of truth for the system prompt. No prompt logic lives in `lumi.service.ts`.

### References

- [Source: _bmad-output/planning-artifacts/epic-5-vertical-slices.md — Story 5.10/5-S11]
- [Source: _bmad-output/planning-artifacts/prd.md — FR61, FR63]
- [Source: docs/AI Principles.md — tone guidelines ("warm not casual, concise not terse")]
- [Source: apps/api/src/agents/lumi.agent.ts — `buildSystemPrompt`, lines 104–134]
- [Source: apps/api/src/modules/lumi/lumi.service.ts — `submitTextTurn`, lines 421–471]
- [Source: apps/api/src/common/voice-tier.ts — pattern for common helpers]

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Tasks Completed

- [x] Task 1 — `time-of-day.ts` helper + boundary tests
- [x] Task 2 — `conversationalContext` field on `LumiAgentRespondInput`
- [x] Task 3 — `# Conversational Context` block in `buildSystemPrompt()`
- [x] Task 4 — inject `conversationalContext` in `submitTextTurn()`
- [x] Task 5 — verified `processVoiceUtterance()` delegates to `submitTextTurn()` (no separate injection)
- [x] Task 6 — `buildSystemPrompt` prompt-injection unit tests

### Debug Log References

None.

### Completion Notes List

- **AC1** — `getTimeOfDayBand(date)` classifies by `date.getUTCHours()`: morning 05–11, afternoon 12–16, evening 17–21, night 22–04. Pure function, no deps.
- **AC2** — `LumiAgentRespondInput` gains optional `conversationalContext?: { timeOfDayBand: TimeOfDayBand }` (imported via `import type` from `../common/time-of-day.js`).
- **AC3–AC5** — `buildSystemPrompt()` appends `# Conversational Context\nTime of day: <band>\n<instruction>` only when `conversationalContext` is present. Morning/afternoon → "likely in a hurry … one or two sentences"; evening/night → "time to reflect … 2–4 sentence". Verbatim strings from AC4/AC5.
- **AC6** — the new block is appended AFTER the existing persona/surface/snapshot/current-surface/recent-actions blocks; an ordering test asserts persona < snapshot < recent-actions < context. No existing block was modified.
- **AC7** — `submitTextTurn()` passes `conversationalContext: { timeOfDayBand: getTimeOfDayBand(new Date()) }` into `agent.respond()`.
- **AC8** — `processVoiceUtterance()` calls `this.submitTextTurn({ … modality: 'voice' })` (lumi.service.ts:357), so voice turns inherit the same band derivation. No `agent.respond()` is called directly in `processVoiceUtterance`, so no separate injection was needed (matches Task 5 verify branch).
- **AC9** — 10 boundary cases in `time-of-day.test.ts` (04:59→night, 05:00→morning, 11:59→morning, 12:00→afternoon, 16:59→afternoon, 17:00→evening, 21:59→evening, 22:00→night, 23:59→night, 00:00→night); morning + afternoon + evening + night prompt-injection tests, plus an "absent" test asserting `# Conversational Context` is not present.
- **AC10** — no migration, no `packages/contracts` change, no `LumiContextSignal` change. `conversationalContext` lives only on the internal `LumiAgentRespondInput` interface.
- **Verification** — touched-file typecheck clean; remaining typecheck errors (API 12 + contracts 1) are the documented pre-existing baseline, none in touched files. Targeted suites: `time-of-day.test.ts` + `lumi.agent.test.ts` = 36 pass. Full API suite: 1829 pass / 20 fail / 13 skip — the 20 failures are the documented pre-existing baseline (auth.routes, catalog-seed, children.repository, extra-library, households.routes, lunch-link, memory.service, plan-adjustment, audit-parity, onboarding.tools, brief-state.composer.tree), none in touched files. ESLint clean on all touched files. No new dependencies.

### File List

- `apps/api/src/common/time-of-day.ts` (new)
- `apps/api/src/common/time-of-day.test.ts` (new)
- `apps/api/src/agents/lumi.agent.ts` (modified — `conversationalContext` field + `buildSystemPrompt` block)
- `apps/api/src/agents/lumi.agent.test.ts` (modified — 6 new conversational-context tests)
- `apps/api/src/modules/lumi/lumi.service.ts` (modified — import + `submitTextTurn` injection)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status tracking)

### Change Log

| Date | Change |
|------|--------|
| 2026-06-09 | Implemented 5-S11 adaptive Lumi tone/length: `getTimeOfDayBand` helper, `conversationalContext` on `LumiAgentRespondInput`, `# Conversational Context` prompt block, server-side band injection in `submitTextTurn` (voice inherits via delegation). +16 unit tests. No migration/contract/dep changes. Status → review. |

---

### Review Findings

- [x] [Review][Defer] `new Date()` inline in `submitTextTurn` makes service-layer testing time-dependent — deferred; design choice consistent with `getWeekStart(new Date())` codebase pattern; no correctness impact. [`apps/api/src/modules/lumi/lumi.service.ts`]
- [x] [Review][Defer] No service-level integration test verifying `submitTextTurn` propagates `conversationalContext` to `agent.respond` — deferred; story explicitly scoped to unit-only tests; wiring is a one-liner; components are independently tested. [`apps/api/src/modules/lumi/lumi.service.ts`]
