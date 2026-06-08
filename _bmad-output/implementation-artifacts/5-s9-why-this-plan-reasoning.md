# 5-S9 — Why this? Plan Reasoning

> **Folds:** story 5.13, PRD FR64  
> **Status:** done  
> **Epic:** 5 — Ambient Intelligence Layer

---

## Story

**As a parent** reviewing the weekly plan, when I tap "Why this?" on a PlanTile, I want to see a brief prose explanation of what shaped this week's plan — so I can trust Lumi's choices without having to dig.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | `PlanComposeTreeOutputSchema` accepts an optional `reasoning` string (max 600 chars). The planner prompt instructs the model to populate it. |
| AC2 | When a plan is committed, the `plan_reasoning` field in `brief_state.payload` is set to `output.reasoning` (or `null` if absent). |
| AC3 | When `brief_state` is refreshed for any reason OTHER than a new plan commit (swap, variation, pause), `plan_reasoning` carries forward from the previous `brief_state.payload` — it is never zeroed out by a non-commit refresh. |
| AC4 | `PlanTile` renders a "Why this?" ghost-text button when `onWhyThis` prop is provided; renders nothing when prop is absent. |
| AC5 | Clicking "Why this?" opens an inline reasoning panel in `BriefCanvas` showing the prose text and a dismiss control. |
| AC6 | The "Why this?" button is only wired to tiles when `payload.plan_reasoning` is non-null. |
| AC7 | `BriefStatePayloadSchema` round-trips with `plan_reasoning: null` (default) and a non-null string. |
| AC8 | No new DB migrations required — `plan_reasoning` lives entirely inside the existing `brief_state.payload` JSONB column. |

---

## Scope Reconciliation

The epic spec says:  
> "reads `audit_log.stages[]` for that plan → renders prose explanation citing memory nodes, cultural priors, pantry state"

**Codebase reality:** Pulling reasoning from `audit_log` at render time requires a new `AuditRepository.findPlanReasoningByPlanId()` method, an extra DB read in `refreshTree()`, and an `auditRepository` dep on `BriefStateComposer`. That's overhead for data that could instead be produced at plan-compose time (where the full context is available) and cached directly in `brief_state.payload`.

**Adopted approach:** The planner emits `reasoning` as a field in `PlanComposeTreeOutputSchema`. The plan-generation job threads it to `PlansService.commit()`, which passes it as an opt to `BriefStateComposer.refreshTree()`, where it is written to `payload.plan_reasoning` in the same upsert that writes tile summaries. On subsequent non-commit refreshes (swaps, variations, pauses), the value carries forward from `previousBrief`.

This matches the spec's intent ("explanation generated at plan-compose time and cached — never LLM-on-scroll"), is simpler, and avoids an additional auditing read path.

The `audit_log` correlation-id approach from the spec is deferred; if per-stage audit introspection is needed later (story 5.13+), it can be added without affecting AC.

---

## Implementation Tasks

### Task 1 — Contracts (`packages/contracts/src/plan.ts`)

**1a.** Add `reasoning` to `PlanComposeTreeOutputSchema`:
```ts
// After `degraded_reason`:
reasoning: z.string().max(600).optional(),
```

**1b.** Add `plan_reasoning` to `BriefStatePayloadSchema`:
```ts
// After `learning_moment_suppressed_until`:
plan_reasoning: z.string().nullable().default(null),
```

No changes to `BriefStateRowSchema` — `plan_reasoning` lives inside the `payload` field.

**Verify:** `pnpm --filter @hivekitchen/contracts test` still passes (contract schema tests in `plan.test.ts` should be extended — see Task 4).

---

### Task 2 — API: thread `reasoning` from orchestrator → `brief_state`

**2a. `apps/api/src/modules/plans/brief-state.composer.ts`**

Extend `refreshTree()` opts parameter:
```ts
// Before:
opts: { userInitiated?: boolean } = {}
// After:
opts: { userInitiated?: boolean; planReasoning?: string } = {}
```

In the `upsertInput.payload` block, add after `learning_moment_suppressed_until`:
```ts
// Slice 5-S9 — carry forward or set plan reasoning from commit opts.
plan_reasoning: opts.planReasoning ?? previousBrief?.payload?.plan_reasoning ?? null,
```

No changes to `BriefStateComposerDeps`. No new repository dep.

**2b. `apps/api/src/modules/plans/plans.service.ts`**

Add `planReasoning?: string` as a 4th parameter to `commit()`:
```ts
async commit(
  input: CommitPlanTreeInput,
  requestId: string,
  regenerate: (rejections: GuardrailResult[]) => Promise<CommitPlanTreeInput>,
  planReasoning?: string,
): Promise<string>
```

In the `refreshTree()` call inside `commit()` (currently line ~210, no opts arg), add:
```ts
await this.briefStateComposer.refreshTree(
  current.household_id,
  weekId,
  requestId,
  { planReasoning: planReasoning ?? undefined },
);
```

> All other `refreshTree()` calls in `plans.service.ts` (swap, variation, pause) pass `{ userInitiated: true }` — no change needed; `planReasoning` defaults to undefined and carry-forward logic in the composer handles it.

**2c. `apps/api/src/jobs/plan-generation.job.ts`**

At the `commit()` call site (line ~375), add the 4th arg:
```ts
const committedPlanId = await fastify.plansService.commit(
  commitInput,
  request_id,
  async (rejections: GuardrailResult[]) => { ... },  // unchanged
  composeOutput.reasoning,  // ← new 4th arg
);
```

Note: `composeOutput` is the initial orchestrator output (line 340–360 area). On a guardrail regen, `lastAttemptComposeOutput` tracks the final plan output, but `reasoning` from the initial call is still used because `commit()`'s `refreshTree()` fires when the FINAL plan passes guardrails — by that point, the job has no channel to update the reasoning. This is an accepted limitation: the reasoning describes the initial planner's intent; allergen-driven regen may produce a slightly different plan, but the reasoning remains contextually relevant for typical weeks.

**2d. Planner prompt** — add `reasoning` instruction

File: `apps/api/src/agents/prompts/planner.prompt.ts` (or wherever the `plan.compose` tool schema is defined — search for `plan_id` + `prompt_version` to find the tool output spec).

In the `plan.compose` tool output description or system prompt, add to the reasoning field guidance:
```
reasoning (optional, ≤ 300 chars): 2-3 sentences citing the primary signals that shaped this week's choices —
e.g. memory nodes, cultural priors, pantry coverage, or allergen constraints. Plain prose, no bullet points,
no theatrical AI language. Omit if no distinct rationale exists.
```

> If the planner uses a Zod-validated tool output, the `reasoning` field is already added by Task 1a. Add the prose instruction to the system prompt / tool description so the model actually populates it.

---

### Task 3 — Web: "Why this?" button + reasoning panel

**3a. `apps/web/src/features/plan/PlanTile.tsx`**

Add to `PlanTileProps` interface:
```ts
onWhyThis?: () => void;
```

In the tile body — after the existing dish/recipe line, add a ghost-text button that is only rendered when `onWhyThis` is provided:
```tsx
{onWhyThis && (
  <button
    onClick={onWhyThis}
    className="text-xs text-honey-600 underline-offset-2 hover:underline mt-1 self-start"
  >
    Why this?
  </button>
)}
```

Exact placement: below the main recipe title, above any child-chip row. Keep it visually quiet (text-xs, honey-600 matches the Lumi accent tone from DESIGN.md).

**3b. `apps/web/src/features/plan/BriefCanvas.tsx`**

Add local state:
```ts
const [showReasoning, setShowReasoning] = useState(false);
```

Read `planReasoning` from payload:
```ts
const planReasoning = payload?.plan_reasoning ?? null;
```

In the `PlanTile` render call, add the `onWhyThis` prop:
```tsx
<PlanTile
  ...existing props...
  onWhyThis={planReasoning ? () => setShowReasoning(true) : undefined}
/>
```

Add a reasoning panel rendered conditionally below the tile grid and above the `PackerChip` / bottom section. Keep it inline — no modal, no drawer. A soft amber card:
```tsx
{showReasoning && planReasoning && (
  <div className="mt-4 rounded-xl bg-honey-50 border border-honey-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-honey-700 mb-1">Lumi's thinking</p>
        <p className="text-sm text-charcoal-700 leading-relaxed font-serif">{planReasoning}</p>
      </div>
      <button
        onClick={() => setShowReasoning(false)}
        className="shrink-0 text-honey-500 hover:text-honey-700 text-xs mt-0.5"
        aria-label="Close reasoning"
      >
        ✕
      </button>
    </div>
  </div>
)}
```

Import `useState` if not already imported. The panel is dismissed by the ✕ button; it does NOT auto-dismiss on navigation (that state is local to `BriefCanvas`).

> Do NOT close the panel when a different tile's "Why this?" is tapped — the panel shows household-level plan reasoning (not tile-specific), so all tiles share the same text.

---

### Task 4 — Tests

#### 4a. Contract tests (`packages/contracts/src/plan.test.ts`)

Add to the existing `BriefStatePayloadSchema` describe block:
```ts
it('defaults plan_reasoning to null when absent', () => {
  const result = BriefStatePayloadSchema.parse({});
  expect(result.plan_reasoning).toBeNull();
});

it('round-trips a non-null plan_reasoning', () => {
  const result = BriefStatePayloadSchema.parse({ plan_reasoning: 'Lumi chose pasta for continuity.' });
  expect(result.plan_reasoning).toBe('Lumi chose pasta for continuity.');
});
```

Add to the existing `PlanComposeTreeOutputSchema` describe block (or create one):
```ts
it('accepts optional reasoning within 600 chars', () => {
  const out = PlanComposeTreeOutputSchema.parse({
    plan_id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    week_of: '2026-06-09',
    main_assignments: [/* minimal valid */],
    days: [/* minimal valid */],
    prompt_version: 'v1',
    reasoning: 'Pasta Mon+Tue for batch-prep; peanut-free swap for Isla.',
  });
  expect(out.reasoning).toBeDefined();
});

it('rejects reasoning longer than 600 chars', () => {
  expect(() =>
    PlanComposeTreeOutputSchema.parse({
      ...minimalValidPlanOutput,
      reasoning: 'x'.repeat(601),
    })
  ).toThrow();
});
```

#### 4b. Composer unit tests (`apps/api/src/modules/plans/brief-state.composer.tree.test.ts`)

Add to the `BriefStateComposer.refreshTree` describe block:

```ts
it('sets plan_reasoning from opts.planReasoning when provided', async () => {
  const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
  const { composer, mocks } = buildDeps({ plan });
  await composer.refreshTree(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID, {
    planReasoning: 'Batch-prep pasta chosen for the week.',
  });
  const upsertCall = mocks.upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null } };
  expect(upsertCall.payload.plan_reasoning).toBe('Batch-prep pasta chosen for the week.');
});

it('carries forward plan_reasoning from previousBrief when opts has none', async () => {
  const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
  const previousBrief = {
    payload: {
      tile_summaries: [],
      plan_state: null,
      plan_state_set_at: null,
      plan_state_message: null,
      plan_reasoning: 'Carried forward reasoning.',
    },
  };
  const { composer, mocks } = buildDeps({ plan, previousBrief });
  await composer.refreshTree(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);
  const upsertCall = mocks.upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null } };
  expect(upsertCall.payload.plan_reasoning).toBe('Carried forward reasoning.');
});

it('sets plan_reasoning to null when opts has none and previousBrief has none', async () => {
  const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
  const { composer, mocks } = buildDeps({ plan, previousBrief: null });
  await composer.refreshTree(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);
  const upsertCall = mocks.upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null } };
  expect(upsertCall.payload.plan_reasoning).toBeNull();
});
```

> The existing `buildDeps()` `previousBrief` shape may need `plan_reasoning` added:  
> `previousBrief?: { payload: { tile_summaries: []; plan_state: null; plan_state_set_at: null; plan_state_message: null; plan_reasoning?: string | null; } } | null`

#### 4c. Web tests

**`apps/web/src/features/plan/PlanTile.test.tsx`** (new file, or add to existing if it exists):
```tsx
it('renders "Why this?" button when onWhyThis is provided', () => {
  render(<PlanTile summary={minimalSummary} onWhyThis={() => {}} />);
  expect(screen.getByRole('button', { name: /why this/i })).toBeInTheDocument();
});

it('does not render "Why this?" button when onWhyThis is absent', () => {
  render(<PlanTile summary={minimalSummary} />);
  expect(screen.queryByRole('button', { name: /why this/i })).toBeNull();
});

it('calls onWhyThis when the button is clicked', async () => {
  const onWhyThis = vi.fn();
  render(<PlanTile summary={minimalSummary} onWhyThis={onWhyThis} />);
  await userEvent.click(screen.getByRole('button', { name: /why this/i }));
  expect(onWhyThis).toHaveBeenCalledTimes(1);
});
```

**`apps/web/src/features/plan/BriefCanvas.test.tsx`** — add to existing test file:
```tsx
it('passes onWhyThis to PlanTile when plan_reasoning is non-null', () => {
  // render BriefCanvas with a mocked brief where payload.plan_reasoning = 'test'
  // assert PlanTile receives a non-undefined onWhyThis prop
});

it('shows reasoning panel when Why this? is clicked', async () => {
  // render BriefCanvas with plan_reasoning populated
  // click the "Why this?" button on a PlanTile
  // assert "Lumi's thinking" heading and the reasoning text appear
});

it('dismisses reasoning panel on ✕ click', async () => {
  // open the panel, then click ✕, assert it disappears
});
```

> BriefCanvas tests may require heavy mocking of stores and SSE — keep new tests scoped to the reasoning panel behavior. Reuse the existing test scaffold from the 5-S8 `LumiCallout` tests.

---

## Dev Notes

### Critical: `previousBrief` shape in tests

`buildDeps()` in `brief-state.composer.tree.test.ts` currently types `previousBrief` narrowly:
```ts
previousBrief?: {
  payload: {
    tile_summaries: [];
    plan_state: null;
    plan_state_set_at: null;
    plan_state_message: null;
  };
} | null;
```

Add `plan_reasoning?: string | null` to this type so the new carry-forward tests can pass a `previousBrief` with a non-null reasoning value without TS complaints.

### `commit()` parameter order

`PlansService.commit()` currently takes 3 params. The 4th param is optional (`planReasoning?: string`). TypeScript callers that currently pass 3 args remain valid — no migration of existing call sites.

The only call site that SHOULD pass reasoning is the plan-generation job (`plan-generation.job.ts`). All other callers of `commit()` (if any) leave it undefined, and the carry-forward logic in the composer handles the null case.

### Planner prompt location

Search for `plan.compose` or `planCompose` in `apps/api/src/agents/` to find the exact file containing the tool spec. The planner may use an inline tool definition — add `reasoning` to the schema description string, not a separate prompt file, to keep it co-located with the output schema.

### `BaseRepository` has no logger field

Per 5-S8 dev notes: if you add any helper in `AuditRepository` for future use, note that `BaseRepository` exposes no logger. Use `console.warn` sparingly, or accept that audit reads are silent on error.

### Do NOT double-encode `planReasoning`

`hkFetch` auto-JSON-stringifies the request body. If `reasoning` is a string it will be correctly serialized in any JSONB payload — do not manually `JSON.stringify()` it.

### Refresh race: swaps during generation

If a swap fires between plan commit and the `refreshTree()` call in `commit()`, the swap's `refreshTree()` runs with `{ userInitiated: true }` (no `planReasoning`). The carry-forward logic means the `plan_reasoning` set by commit will be preserved as long as the swap's `refreshTree()` reads a `previousBrief` that already has the reasoning. In practice, `commit()` writes `plan_reasoning` then the swap overwrites it via carry-forward — safe.

### Reasoning is household-level, not tile-specific

All tiles share the same "Why this?" button and open the same panel. The reasoning describes the week as a whole, not a specific day. This is intentional and reflected in the UI spec: one inline panel per canvas, not per tile.

### 5-S8 pattern applies: `payload?.plan_reasoning ?? null`

When reading `brief_state.payload.plan_reasoning` on the frontend, always use `payload?.plan_reasoning ?? null`. Older `brief_state` rows written before this slice will not have the field; Zod's `.default(null)` handles it on the API side, but frontend code may encounter raw JSONB before re-serialization.

---

## Source File Map

| File | Change |
|------|--------|
| `packages/contracts/src/plan.ts` | Add `reasoning?` to `PlanComposeTreeOutputSchema`; add `plan_reasoning` to `BriefStatePayloadSchema` |
| `packages/contracts/src/plan.test.ts` | New contract tests for both schema changes |
| `apps/api/src/modules/plans/brief-state.composer.ts` | Extend `refreshTree()` opts with `planReasoning?`; write `plan_reasoning` in payload (carry-forward pattern) |
| `apps/api/src/modules/plans/plans.service.ts` | Add `planReasoning?` 4th param to `commit()`; pass to `refreshTree()` opts |
| `apps/api/src/jobs/plan-generation.job.ts` | Pass `composeOutput.reasoning` as 4th arg to `plansService.commit()` |
| `apps/api/src/agents/prompts/*.ts` (planner) | Add `reasoning` field prose instruction to planner system prompt / tool description |
| `apps/web/src/features/plan/PlanTile.tsx` | Add `onWhyThis?: () => void` prop + "Why this?" ghost button |
| `apps/web/src/features/plan/BriefCanvas.tsx` | Read `plan_reasoning`, wire `onWhyThis` to tiles, render inline reasoning panel |
| `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` | New `refreshTree` tests: opts.planReasoning set, carry-forward, null baseline |
| `apps/web/src/features/plan/LumiCallout.test.tsx` | No change (exists from 5-S8) — reference for BriefCanvas test patterns |
| `apps/web/src/features/plan/BriefCanvas.test.tsx` | New reasoning panel tests |
| `apps/web/src/features/plan/PlanTile.test.tsx` | New "Why this?" button tests (file may be new) |
| `packages/types/src/index.ts` | No change — types are derived from contracts automatically |

**Files NOT touched:**
- `audit.repository.ts` — no new audit read path (reasoning stored in brief_state.payload directly)
- `audit.types.ts` — no new audit event type
- Any migration files — `plan_reasoning` lives in existing JSONB column

---

## Test Baselines (inherited from 5-S8 done state)

| Suite | Passing | Failing | Skipped |
|-------|---------|---------|---------|
| API (`pnpm --filter @hivekitchen/api test`) | 1727 | 20 | 13 |
| Web (`pnpm --filter @hivekitchen/web test`) | 537 | 2 | — |
| Contracts (`pnpm --filter @hivekitchen/contracts test`) | 708 | 7 | — |

**Typecheck baselines:**

| Package | Errors |
|---------|--------|
| `apps/api` | 12 |
| `apps/web` | 7 |
| `packages/contracts` + `packages/types` | 1 |

> Passing count will increase. Failing / skipped must not regress. Typecheck error counts must not increase.

---

## Done Definition

- [x] `pnpm --filter @hivekitchen/contracts test` passes with new `plan_reasoning` + `reasoning` tests — 727p/7f (+5; 7f = baseline)
- [x] `pnpm --filter @hivekitchen/api test` passes with new composer carry-forward tests — 1766p/20f/13skip (+3; 20f = baseline)
- [x] `pnpm --filter @hivekitchen/web test` passes with new PlanTile + BriefCanvas reasoning panel tests — 551p/2f (+6; 2f = baseline 5-S3 debt)
- [x] Typecheck counts do not increase from baseline — api 12 · web 7 · contracts 1 · types 1 (unchanged)
- [ ] Manual smoke: generate a plan → `brief_state.payload.plan_reasoning` is non-null in DB *(USER-SIDE — live stack)*
- [ ] Manual smoke: "Why this?" button visible on PlanTile → click → inline amber panel appears → ✕ dismisses *(USER-SIDE — covered by web tests; live confirm)*
- [ ] Manual smoke: swap a Main → `refreshTree()` fires → `plan_reasoning` is preserved (carry-forward) *(USER-SIDE — live stack)*
- [ ] Manual smoke: household with no plan → no "Why this?" button (planReasoning null → onWhyThis undefined) *(USER-SIDE — covered by web test; live confirm)*

---

## Dev Agent Record

### Status
review — implemented 2026-06-08. No DB migration (lives in existing `brief_state.payload` JSONB). No new deps.

### Implementation Plan (as executed)
Built bottom-up, verifying each layer:
1. **Contracts** — `PlanComposeTreeOutputSchema.reasoning?` (≤600) + `BriefStatePayloadSchema.plan_reasoning` (nullable, default null). Verified plan.test 12p (+5).
2. **API** — `refreshTree()` opts `planReasoning?` with carry-forward; `PlansService.commit()` 4th param; `plan-generation.job` passes `composeOutput.reasoning`; planner prompt `reasoning` instruction. Verified composer/tools/prompt 33p.
3. **API tool boundary (added reconciliation #1)** — threaded `reasoning` through `plan.compose`.
4. **Web** — `PlanTile.onWhyThis?` ghost button (stopPropagation); `BriefCanvas` reads `plan_reasoning`, wires `onWhyThis`, renders inline amber panel. Verified PlanTile+BriefCanvas 65p (+6).

### Reconciliation decisions (deviations from the slice spec, with rationale)
1. **`reasoning` threaded across the `plan.compose` tool boundary (NOT in the story).** The story assumed `composeOutput.reasoning` would be populated from Task 1a + 2d alone. But `plan.compose` parses its args with `PlanComposeTreeInputSchema` — which has **no** `reasoning` field — so the planner's reasoning was stripped *before* the orchestrator's output parse, leaving `composeOutput.reasoning` always `undefined` (feature inert). Fix: in `plan.tools.ts` `fn`, recover `reasoning` from the raw tool args and merge it into the output (defensively `.slice(0, 600)` so a long rationale can never fail the whole `plan.compose` call). This is the missing link that makes AC1→AC2 actually work end-to-end. `PlanComposeTreeInputSchema` left unchanged (reasoning is planner *metadata*, not structural plan input).
2. **Design tokens are `honey-amber-*` / `fg`, not `honey-*` / `charcoal-*`.** The story's snippets used `text-honey-600`, `bg-honey-50`, `text-charcoal-700` — none of those resolve. The design system exposes `honey-amber-{50..800}` (see `AllergyUncertaintyBanner`, the existing amber card) and uses `fg` for body text (no `charcoal` token). Used `text-honey-amber-600` (button), `bg-honey-amber-50 / border-honey-amber-200 / text-honey-amber-700 / text-honey-amber-500` (panel), `text-fg` (body).
3. **`PlanTile.test.tsx` already existed** (story said "file may be new") — appended the 3 Why-this tests to it. Added a `stopPropagation` assertion (the story's plain snippet would let a click bubble to the tile's `onSwapIntent`; the impl stops it, so the test asserts `onSwapIntent` is NOT called).
4. **Fixture top-up.** `plan_reasoning` is a required (defaulted) field on the output type, so two pre-existing payload fixtures (`apps/api/test/factories/index.ts` `buildBriefState`, web `BriefCanvas.test.tsx` `makeBrief`) needed `plan_reasoning: null` added to keep typecheck at baseline.

### Completion Notes
- All 8 ACs satisfied. AC1/AC2 verified end-to-end via the tool-boundary fix (reconciliation #1). AC3 carry-forward + AC8 no-migration verified by the composer unit tests. AC4–AC6 verified by PlanTile/BriefCanvas tests; AC7 by contract tests.
- The `commit()` 4th param is optional → all existing 3-arg callers (swap/variation/pause paths) stay valid; only `plan-generation.job` passes reasoning. Non-commit refreshes carry the value forward (never zeroed).
- Accepted limitation (per story): on a guardrail regen, the *initial* compose output's reasoning is cached (the job has no channel to update it post-regen); contextually relevant for typical weeks.

### Test Results (vs. current HEAD baseline = commit c783157)
| Suite | Baseline | After 5-S9 | Δ | Failing |
|-------|----------|-----------|---|---------|
| Contracts | 722p / 7f | 727p / 7f | +5 | 7 (pre-existing) |
| API | 1763p / 20f / 13skip | 1766p / 20f / 13skip | +3 | 20 (pre-existing) |
| Web | 545p / 2f | 551p / 2f | +6 | 2 (pre-existing 5-S3 debt) |

**Typecheck:** api 12 · web 7 · contracts 1 · types 1 — all unchanged from baseline; zero new errors in any touched file.

### File List
**Modified:**
- `packages/contracts/src/plan.ts` (+`reasoning?` on `PlanComposeTreeOutputSchema`; +`plan_reasoning` on `BriefStatePayloadSchema`)
- `packages/contracts/src/plan.test.ts` (+5 tests)
- `apps/api/src/modules/plans/brief-state.composer.ts` (refreshTree opts `planReasoning?` + carry-forward write)
- `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` (+3 carry-forward tests; widened `previousBrief` type)
- `apps/api/src/modules/plans/plans.service.ts` (commit 4th param → refreshTree opts)
- `apps/api/src/jobs/plan-generation.job.ts` (pass `composeOutput.reasoning`)
- `apps/api/src/agents/prompts/planner.prompt.ts` (reasoning field instruction)
- `apps/api/src/agents/tools/plan.tools.ts` (thread reasoning across the tool boundary — reconciliation #1)
- `apps/api/test/factories/index.ts` (`plan_reasoning: null` in `buildBriefState`)
- `apps/web/src/features/plan/PlanTile.tsx` (`onWhyThis?` prop + ghost button)
- `apps/web/src/features/plan/PlanTile.test.tsx` (+3 tests)
- `apps/web/src/features/plan/BriefCanvas.tsx` (read `plan_reasoning`, wire `onWhyThis`, inline amber panel)
- `apps/web/src/features/plan/BriefCanvas.test.tsx` (+3 tests; `plan_reasoning: null` in `makeBrief`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status → in-progress → review)

**No new files. No migration. No new dependencies.**

### Change Log
- 2026-06-08 — Implemented 5-S9 "Why this?" plan reasoning end-to-end (contracts + composer carry-forward + commit/job wiring + planner prompt + plan.compose tool-boundary threading + PlanTile button + BriefCanvas inline panel). All 8 ACs met; suites green at baselines (+5 contracts / +3 API / +6 web); zero new typecheck errors. Status → review.

---

### Review Findings

- [x] [Review][Patch] Prompt says ≤300 chars but schema enforces max(600) — align prompt instruction to match schema cap [`apps/api/src/agents/prompts/planner.prompt.ts:130`]
- [x] [Review][Patch] AC2 violation: absent reasoning on commit carries forward previous plan's reasoning instead of null — use `null` as explicit clear sentinel (pass `composeOutput.reasoning ?? null` in job; update composer to treat `null` as override vs `undefined` as carry-forward) [`apps/api/src/jobs/plan-generation.job.ts:443`, `apps/api/src/modules/plans/brief-state.composer.ts:345`]
- [x] [Review][Patch] `showReasoning` never resets when `planReasoning` changes — panel reopens automatically when a new plan with reasoning is committed; add `useEffect(() => { setShowReasoning(false); }, [planReasoning])` [`apps/web/src/features/plan/BriefCanvas.tsx:125`]
- [x] [Review][Patch] No test asserting `respondToLearningMoment` preserves `plan_reasoning` (AC3 path through 5-S8 `...current.payload` spread) — add a targeted unit test [`apps/api/src/modules/plans/brief-state.composer.ts:115-128`]
- [x] [Review][Defer] Stale reasoning shown when guardrail regen fires [`apps/api/src/jobs/plan-generation.job.ts:436`] — deferred, documented accepted limitation in story spec (initial compose reasoning used even if regen changes the plan; contextually relevant for typical weeks)
- [x] [Review][Defer] Non-string `reasoning` from LLM silently dropped with no log [`apps/api/src/agents/tools/plan.tools.ts:33`] — deferred, LLM non-string emission is low probability; add logger.warn in a future hardening pass
- [x] [Review][Defer] Stale `plan_reasoning` could persist across week rollover via non-plan `refreshTree` calls — deferred, AC3 by-design carry-forward; requires a future TTL or week-change reset strategy
- [x] [Review][Defer] `rawReasoning.slice(0, 600)` may truncate at a UTF-16 surrogate boundary on emoji-heavy input [`apps/api/src/agents/tools/plan.tools.ts:37`] — deferred, low probability in prose reasoning text
- [x] [Review][Defer] Five identical "Why this?" button labels — no per-tile disambiguation for screen readers [`apps/web/src/features/plan/PlanTile.tsx:220`] — deferred, household-level reasoning is spec intent; add `aria-label="Why this plan?"` with day context if accessibility audit flags it
- [x] [Review][Defer] `BriefStatePayloadSchema.plan_reasoning` has no `max()` guard unlike `PlanComposeTreeOutputSchema.reasoning` [`packages/contracts/src/plan.ts:276`] — deferred, defense-in-depth; add when field is written from non-planner paths
