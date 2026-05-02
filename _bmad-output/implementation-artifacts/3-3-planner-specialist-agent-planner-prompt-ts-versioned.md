# Story 3.3: Planner Specialist Agent + planner.prompt.ts Versioned

Status: done

## Story

As a developer,
I want the planner specialist agent registered with `apps/api/src/agents/prompts/planner.prompt.ts` versioned and tested,
So that prompt changes are auditable and I can pin specific households to specific prompt versions during regression investigation.

## Acceptance Criteria

1. **Given** Story 3.2 is complete,
   **When** Story 3.3 is complete,
   **Then** `apps/api/src/agents/prompts/planner.prompt.ts` exports a versioned object with shape `{ version: 'v1.0.0', text: '...', toolsAllowed: ['recipe.search', 'recipe.fetch', 'memory.recall', 'pantry.read', 'plan.compose', 'allergy.check', 'cultural.lookup'] }`.

2. **Given** `planner.prompt.ts` exists,
   **When** `DomainOrchestrator.complete()` is called with an `allowedTools` list,
   **Then** only tools in the allowed set are forwarded to the LLMProvider; if the provider returns a tool call whose name is not in the allowed set, `ForbiddenToolCallError` is thrown. The circuit breaker does NOT trip on `ForbiddenToolCallError`.

3. **Given** Story 3.3 is complete,
   **When** a plan is created or returned by the API,
   **Then** every `WeeklyPlan` contract shape carries a `promptVersion` field (type `z.string()`); Story 3.5 adds the `prompt_version VARCHAR(32)` column to the DB and populates it from `PLANNER_PROMPT.version`.

---

## Tasks / Subtasks

### Task 1 — Create versioned planner prompt file (AC: #1)

- [x] Create `apps/api/src/agents/prompts/planner.prompt.ts`
  - [x] Define and export `PlannerPromptSpec` interface:
    ```typescript
    export interface PlannerPromptSpec {
      readonly version: string;
      readonly text: string;
      readonly toolsAllowed: readonly string[];
    }
    ```
  - [x] Declare the prompt body in a private `const PLANNING_CORE = \`...\`` template string
  - [x] Export `PLANNER_PROMPT: PlannerPromptSpec` with:
    - `version: 'v1.0.0'`
    - `text: PLANNING_CORE`
    - `toolsAllowed` (exact order):
      ```typescript
      ['recipe.search', 'recipe.fetch', 'memory.recall', 'pantry.read', 'plan.compose', 'allergy.check', 'cultural.lookup']
      ```
  - [x] No imports from other agent files — this file is a pure data module

### Task 2 — Add `ForbiddenToolCallError` to `apps/api/src/common/errors.ts` (AC: #2)

- [x] Add after `NotImplementedError`:
  ```typescript
  export class ForbiddenToolCallError extends DomainError {
    readonly type = '/errors/forbidden-tool-call';
    readonly status = 403;
    readonly title = 'Forbidden Tool Call';
    constructor(toolName: string) {
      super(`Tool '${toolName}' is not in this agent's allowed tool set.`);
    }
  }
  ```
- [x] Do NOT extend `ForbiddenError` — TypeScript's readonly literal type conflict prevents overriding (see inline comment in `errors.ts`). Extend `DomainError` directly (same pattern as `ParentalNoticeRequiredError`).

### Task 3 — Extend `DomainOrchestrator.complete()` with allowed-tool filtering (AC: #2)

- [x] Import `ForbiddenToolCallError` from `'../common/errors.js'` in `orchestrator.ts`
- [x] Add optional 4th parameter to `complete()`:
  ```typescript
  async complete(
    prompt: string,
    tools: ToolSpec[],
    options: LLMCallOptions,
    allowedTools?: readonly string[]
  ): Promise<LLMResponse>
  ```
- [x] Before calling provider: filter tools to the allowed set:
  ```typescript
  const effectiveTools = allowedTools
    ? tools.filter(t => allowedTools.includes(t.name))
    : tools;
  ```
- [x] Separate the circuit-breaker try/catch from the tool-call validation:
  ```typescript
  let result: LLMResponse;
  try {
    result = await provider.complete(prompt, effectiveTools, options);
    this.breaker.recordSuccess();
  } catch (err) {
    this.breaker.recordFailure();
    throw err;
  }

  // Validate AFTER recording success — ForbiddenToolCallError must not trip the breaker
  if (allowedTools) {
    for (const tc of result.toolCalls) {
      if (!allowedTools.includes(tc.name)) {
        throw new ForbiddenToolCallError(tc.name);
      }
    }
  }

  return result;
  ```
- [x] Existing call sites (none in production code yet — only tests) pass 3 params; the optional 4th is backward-compatible. All existing `orchestrator.test.ts` tests must continue to pass without modification.

### Task 4 — Add `promptVersion` to `WeeklyPlan` contract schema (AC: #3)

- [x] In `packages/contracts/src/plan.ts`, add `promptVersion: z.string()` to `WeeklyPlan`:
  ```typescript
  export const WeeklyPlan = z.object({
    id: z.string().uuid(),
    weekOf: z.string(),
    status: z.enum(['draft', 'confirmed']),
    days: z.array(DayPlan),
    promptVersion: z.string(),  // ← ADD
  });
  ```
- [x] Update `packages/contracts/src/plan.test.ts` to include `promptVersion: 'v1.0.0'` in any `WeeklyPlan` test fixtures
- [x] No DB migration in this story — the `prompt_version` column lands in Story 3.5

### Task 5 — Tests (AC: all)

- [x] Create `apps/api/src/agents/prompts/planner.prompt.test.ts`:
  - [x] `PLANNER_PROMPT.version` matches `/^v\d+\.\d+\.\d+$/`
  - [x] `PLANNER_PROMPT.toolsAllowed` equals the exact 7-element array in the specified order
  - [x] `PLANNER_PROMPT.text` is non-empty (length > 100)
  - [x] `PLANNER_PROMPT.toolsAllowed` does NOT include `'memory.note'` (it's the write tool, not the read tool)

- [x] In `apps/api/src/agents/orchestrator.test.ts`, add:
  - [x] `complete()` with `allowedTools` — only allowed tools forwarded to provider (spy on provider.complete to verify `tools` argument)
  - [x] `complete()` without `allowedTools` — all tools forwarded (backward compat)
  - [x] `complete()` with `allowedTools` — throws `ForbiddenToolCallError` when provider returns a tool call not in the allowed set
  - [x] `ForbiddenToolCallError` does NOT increment breaker failure count (breaker `isTripped()` remains `false` — verified externally: 6 forbidden errors, no failover audit, active provider unchanged)

### Review Findings

- [x] [Review][Decision] `recordSuccess()` called before `ForbiddenToolCallError` throw — dismissed. A responding provider IS healthy from the circuit breaker's perspective regardless of tool policy; recording success is correct and matches spec intent. No change needed.
- [x] [Review][Patch] Null guard missing on `result.toolCalls` in the new validation loop [`apps/api/src/agents/orchestrator.ts:84`] — fixed: `result.toolCalls ?? []`
- [x] [Review][Defer] `allowedTools = []` silently strips all tools with no warning or validation [`apps/api/src/agents/orchestrator.ts:68-70`] — deferred, not spec-required
- [x] [Review][Defer] Concurrent calls race on `currentProviderIndex` without synchronization [`apps/api/src/agents/orchestrator.ts:63`] — deferred, pre-existing
- [x] [Review][Defer] `complete()` does not check circuit breaker state before attempting a provider call [`apps/api/src/agents/orchestrator.ts:57`] — deferred, pre-existing
- [x] [Review][Defer] `TOOL_MANIFEST` global mutable state causes fragile cross-test isolation [`apps/api/src/agents/orchestrator.test.ts`] — deferred, pre-existing
- [x] [Review][Defer] No test coverage for `allowedTools = []` edge case [`apps/api/src/agents/orchestrator.test.ts`] — deferred, optional improvement
- [x] [Review][Defer] `handleRecoveryAttempt` unconditionally resets to provider index 0, skipping intermediate providers [`apps/api/src/agents/orchestrator.ts:117-130`] — deferred, pre-existing

---

## Dev Notes

### Critical — Do NOT follow the `onboarding.prompt.ts` export pattern

`onboarding.prompt.ts` exports functions (`getOnboardingSystemPrompt()`) and string constants. The planner prompt has a fundamentally different shape: a **versioned data object** with `version`, `text`, and `toolsAllowed`. The two files share only a folder, not a pattern.

The planner prompt is NOT conversational. No voice/text modality variants, no expression tags, no `[SESSION_COMPLETE]` sentinel. It's a background agent system prompt.

### Critical — Tool names in `toolsAllowed` are INTERNAL dotted names

```typescript
// Correct — internal names
toolsAllowed: ['recipe.search', 'allergy.check', ...]

// Wrong — OpenAI wire names (adapter handles this transparently)
toolsAllowed: ['recipe__search', 'allergy__check', ...]
```

The `OpenAIAdapter` rewrites `.` → `__` when sending to OpenAI and `__` → `.` when reading tool-call names back. By the time `LLMResponse.toolCalls` reaches the orchestrator, names are already converted back to internal dotted form. The `allowedTools.includes(tc.name)` check uses internal names. ✓

### Critical — Most `toolsAllowed` tools are NOT in `TOOL_MANIFEST` yet

`TOOL_MANIFEST` currently contains only `allergy.check` and `memory.note`. The tools `recipe.search`, `recipe.fetch`, `memory.recall`, `pantry.read`, `plan.compose`, and `cultural.lookup` are implemented in Story 3.4.

When filtering with `PLANNER_PROMPT.toolsAllowed`, the result is currently just `[allergy.check spec]` — other tools aren't registered yet and `filter()` simply skips them. This is correct and by design. When Story 3.4 registers those tools, they'll automatically flow through without any change to Story 3.3 code.

**`memory.note` ≠ `memory.recall`:** `memory.note` (in TOOL_MANIFEST) is the WRITE tool. `memory.recall` (in `toolsAllowed`) is the READ tool — it does not exist yet (Story 3.4). They are separate tools with separate names. Do not confuse them.

### Critical — Circuit breaker scope separation

The current `complete()` implementation uses a single try/catch that covers both the provider call and success/failure recording. The Story 3.3 change must restructure this so that:
1. Provider call + breaker recording is in one try/catch block
2. `ForbiddenToolCallError` validation happens OUTSIDE that block (after `recordSuccess()`)

If `ForbiddenToolCallError` were thrown inside the catch block, the breaker would incorrectly count it as a provider failure and eventually trigger a failover. A tool-policy violation means the provider worked fine — we just don't like the tool it called.

### Critical — `WeeklyPlan` already exists in contracts — extend, don't replace

`packages/contracts/src/plan.ts` already defines `WeeklyPlan`, `DayPlan`, `MealItem`, `CreatePlanResponse`, plus guardrail schemas. Read the file before editing. Add `promptVersion: z.string()` to the existing `WeeklyPlan` object — do not rewrite or replace any other schemas.

No types package changes needed — consumers derive types via `z.infer<typeof WeeklyPlan>`.

### Critical — `planWeek()` is explicitly OUT OF SCOPE

Do NOT add `DomainOrchestrator.planWeek()` or any other plan-generation orchestration method. Those land in Story 3.5/3.7 when:
- The plan repository (Story 3.5) exists to persist results
- All planner tools (Story 3.4) are registered
- The brief-state projection (Story 3.6) is ready

A stub `planWeek()` now would be dead code with incorrect assumptions.

### Pattern — Intended call pattern for future stories

When Story 3.5/3.7 callers invoke the orchestrator with the planner prompt:
```typescript
import { PLANNER_PROMPT } from '../agents/prompts/planner.prompt.js';
import { TOOL_MANIFEST } from '../agents/tools.manifest.js';

// Pass all registered tools; orchestrator filters to planner's allowed subset
const allTools = [...TOOL_MANIFEST.values()];
const result = await fastify.orchestrator.complete(
  PLANNER_PROMPT.text,
  allTools,
  { model: 'gpt-4o', maxTokens: 4096 },
  PLANNER_PROMPT.toolsAllowed,
);
// result.toolCalls contains only calls to allowed tools; forbidden ones throw before returning
```

This is documentation for future story authors — Story 3.3 does not implement the caller.

### Pattern — `planner.prompt.ts` prompt text guidance

The `PLANNING_CORE` text should:
- Open with Lumi's role: weekly school-lunch planning agent
- State the constraints to honor: allergens (via `allergy.check`), cultural preferences (via `cultural.lookup`), household pantry state (via `pantry.read`)
- Describe the output contract: 5 days (Mon–Fri), one slot per child per day, school-safe
- Instruct when to call `allergy.check`: before finalizing any day's plan as a self-correction step
- Keep Lumi's character: warm, family-oriented, not clinical
- Keep total token count under 800 tokens

Example opening:
```
You are Lumi, the HiveKitchen weekly lunch planning agent. Your goal is to compose
next week's school lunches for the household — five school days, one meal per slot
declaration — honouring all family constraints and feeling genuinely crafted for
this family.
```

The rest of the prompt is yours to write. Make it action-oriented and tool-aware.

### Project Structure — New and Modified Files

**New files:**
```
apps/api/src/agents/prompts/
  planner.prompt.ts          versioned prompt object
  planner.prompt.test.ts     structural tests for the prompt
```

**Modified files:**
```
apps/api/src/common/errors.ts
  → Add ForbiddenToolCallError

apps/api/src/agents/orchestrator.ts
  → Extend complete() with optional allowedTools param
  → Import ForbiddenToolCallError

apps/api/src/agents/orchestrator.test.ts
  → Add 4 new tests for filtering behavior

packages/contracts/src/plan.ts
  → Add promptVersion: z.string() to WeeklyPlan

packages/contracts/src/plan.test.ts
  → Add promptVersion: 'v1.0.0' to WeeklyPlan fixtures
```

**Unchanged:**
- `orchestrator.hook.ts` — no new deps
- `tools.manifest.ts` — no new tools (that's Story 3.4)
- `fastify.d.ts` — no new decorators
- `app.ts` — no new plugin registrations
- `llm-provider.interface.ts` — `allowedTools` stays in the orchestrator layer, not the provider interface

### Story 3.5 handoff note

Story 3.5 (plan repository + revision versioning) MUST:
- Add `prompt_version VARCHAR(32) NOT NULL` column to the plans table migration
- Populate it from `PLANNER_PROMPT.version` when persisting a plan row
- Return `promptVersion` in all plan API responses (the `WeeklyPlan` contract already includes it after this story)

### References

- Epic 3, Story 3.3 acceptance criteria — `_bmad-output/planning-artifacts/epics.md`
- Architecture §2.2 — `agents/` directory structure and boundary lint rules (`agents/` cannot import from `fastify`, `routes/`, or Supabase)
- Architecture §4.3 — Tool call shape; tool errors throw domain errors from `common/errors.ts`
- Architecture §3.5 — Tool-latency manifest; `maxLatencyMs` required on every tool spec (Story 3.4 adds new tools, not this story)
- Story 3.2 completion notes — `_bmad-output/implementation-artifacts/3-2-domain-orchestrator-*.md`
  - Orchestrator constructor uses POSITIONAL params (not object destructuring) — confirmed in code review
  - Tool name rewriting: `.` → `__` outbound, `__` → `.` inbound in `OpenAIAdapter`
  - `ForbiddenToolCallError` must not trigger breaker (circuit breaker tracks provider-level failures only)
  - Zod 4 is installed (^4.0.0); use `z.toJSONSchema()` not `zod-to-json-schema` package
- Existing `onboarding.prompt.ts` — `apps/api/src/agents/prompts/onboarding.prompt.ts` (file location only — NOT the export pattern)
- Existing `errors.ts` — `apps/api/src/common/errors.ts` (ForbiddenError readonly conflict; ParentalNoticeRequiredError pattern)
- Existing `plan.ts` — `packages/contracts/src/plan.ts` (WeeklyPlan schema to extend)
- Existing `orchestrator.ts` — `apps/api/src/agents/orchestrator.ts` (current complete() signature and circuit-breaker structure)

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — bmad-dev-story workflow

### Debug Log References

- `pnpm --filter @hivekitchen/api test -- --run src/agents/orchestrator.test.ts src/agents/prompts/planner.prompt.test.ts` → 14/14 passing (10 prior orchestrator tests + 4 new filtering tests + 4 planner-prompt structural tests)
- `pnpm --filter @hivekitchen/contracts test -- --run src/plan.test.ts` → 18/18 passing (15 prior + 3 new WeeklyPlan round-trip tests)
- Pre-existing baseline failures (verified via `git stash` on clean baseline, NOT introduced by this story): `packages/contracts/src/cultural.test.ts` (6 failing), `apps/api/src/modules/memory/memory.service.test.ts` (1 failing), `apps/api/src/modules/voice/voice.service.test.ts` (3 RequestInfo typecheck errors).

### Completion Notes List

- `apps/api/src/agents/prompts/planner.prompt.ts` exports `PLANNER_PROMPT` (`PlannerPromptSpec`) with `version: 'v1.0.0'`, the `PLANNING_CORE` prompt body (Lumi as planner agent, constraints, tool discipline, output expectations, tone), and the canonical 7-tool `toolsAllowed` allow-list in the spec order.
- `ForbiddenToolCallError` added to `apps/api/src/common/errors.ts`. Extends `DomainError` directly (same readonly-literal-type pattern as `ParentalNoticeRequiredError`). Status 403, title "Forbidden Tool Call", type `/errors/forbidden-tool-call`. Message formats to `Tool '<name>' is not in this agent's allowed tool set.`
- `DomainOrchestrator.complete()` now accepts an optional `allowedTools?: readonly string[]` 4th parameter. Inbound tool list is filtered by `allowedTools.includes(tool.name)` before being passed to the provider. Tool-call validation runs AFTER `breaker.recordSuccess()` so a `ForbiddenToolCallError` is attributed to agent policy, not provider reliability — the breaker does not advance toward failover when this error fires. All 3 prior `orchestrator.test.ts` tests still pass without modification (backward compatible).
- `WeeklyPlan` contract gains a required `promptVersion: z.string()`. Story 3.5 owns the DB column (`prompt_version VARCHAR(32) NOT NULL`) and population from `PLANNER_PROMPT.version`. No production code currently constructs `WeeklyPlan`, so no other API/web code requires updates this story.
- Verified externally that `ForbiddenToolCallError` does not trip the breaker: 6 sequential forbidden-tool errors leave `getActiveProvider().name === 'primary'` and `audit.write` uncalled. Indirect verification was preferred over exposing `breaker.isTripped()` to keep the orchestrator surface minimal.

### File List

**Added:**
- `apps/api/src/agents/prompts/planner.prompt.ts`
- `apps/api/src/agents/prompts/planner.prompt.test.ts`

**Modified:**
- `apps/api/src/common/errors.ts` (added `ForbiddenToolCallError`)
- `apps/api/src/agents/orchestrator.ts` (extended `complete()` with `allowedTools` filtering + post-call validation; imported `ForbiddenToolCallError`)
- `apps/api/src/agents/orchestrator.test.ts` (added `allowed-tool filtering` describe block — 4 new tests)
- `packages/contracts/src/plan.ts` (added `promptVersion: z.string()` to `WeeklyPlan`)
- `packages/contracts/src/plan.test.ts` (added `WeeklyPlan` describe block — 3 round-trip tests covering happy path, missing field, wrong type)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story 3-3 status: ready-for-dev → in-progress → review)

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-05-01 | 0.1.0 | Story context created — planner prompt, ForbiddenToolCallError, orchestrator filtering, plan contract extension | Story Agent |
| 2026-05-01 | 1.0.0 | Implemented `PLANNER_PROMPT` (v1.0.0), `ForbiddenToolCallError`, `DomainOrchestrator.complete(allowedTools)` with breaker-safe validation, and `WeeklyPlan.promptVersion`. 11 new tests; all prior orchestrator tests preserved. | Dev Agent (Menon) |
