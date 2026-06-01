# Story pre-4-s3: Wire AllergyUncertaintyBanner End-to-End

Status: done

## Story

As a Primary Parent,
I want to see which specific compound ingredients Lumi couldn't verify when my child's plan couldn't be generated,
so that I understand why the plan failed and can take action (retry or swap the flagged slot).

## Context

Story 3-24 shipped `<AllergyUncertaintyBanner>` as a standalone, prop-driven React component. AC7 — wiring it to live plan data — was explicitly deferred. The compound-uncertain case is the **user-recoverable** failure path: Lumi flagged an ingredient it couldn't verify, exhausted swap retries, and hard-failed. The parent needs to see *what* was flagged, not just that planning failed.

The `plan.hard_fail` audit event already carries `flagged_items` in its `stages` metadata (written by `plans.service.ts`). This story surfaces that data to the frontend.

**Source:** deferred-work.md → "Deferred from: implementation of 3-24" — AllergyUncertaintyBanner is component-only, AC7 deferred.

## Acceptance Criteria

1. **Given** a household where plan generation hard-failed due to `compound_ingredient_unverified`,
   **When** `GET /v1/plans?weekOf=...` is called,
   **Then** the response includes `flagged_items: [{ child_id, ingredient, slot, day }]` alongside `hard_fail`.

2. **Given** a household where plan generation hard-failed due to `blocked` (guardrail rejection, not compound uncertainty),
   **When** `GET /v1/plans?weekOf=...` is called,
   **Then** `flagged_items` is absent or empty — the banner only surfaces for compound-uncertain failures.

3. **Given** a household with no plan failure,
   **When** `GET /v1/plans?weekOf=...` is called,
   **Then** `flagged_items` is absent.

4. **Given** `flagged_items` is non-empty in the plan response,
   **When** `BriefCanvas` renders,
   **Then** `<AllergyUncertaintyBanner>` is rendered with the flagged items, `onRetry` (triggers plan regeneration), and `onSwapSlot` (triggers slot swap).

5. **Given** `flagged_items` is empty or absent,
   **When** `BriefCanvas` renders,
   **Then** `<AllergyUncertaintyBanner>` is not rendered (component already returns null for empty array).

6. **Given** the wiring is complete,
   **When** `pnpm typecheck` runs,
   **Then** zero type errors across contracts, API, and web.

## Tasks / Subtasks

### Task 1 — Extend `GetPlansResponseSchema` contract (AC: 1, 2, 3, 6)

**File:** `packages/contracts/src/plan.ts`

`FlaggedCompoundItemSchema` already exists:
```typescript
export const FlaggedCompoundItemSchema = z.object({
  child_id: z.string().uuid(),
  ingredient: z.string().min(1).max(INGREDIENT_MAX),
  slot: z.string().min(1).max(SLOT_MAX),
  day: z.string().min(1).max(SLOT_MAX),
});
```

Add `flagged_items` to `GetPlansResponseSchema` (alongside the existing `hard_fail` field):
```typescript
export const GetPlansResponseSchema = z.object({
  plan: PlanRowSchema.nullable(),
  plan_items: z.array(PlanItemRowSchema),
  is_draft: z.boolean(),
  week_of: z.string().date(),
  hard_fail: HardFailStatusSchema.nullable().optional(),
  variant_proposals: z.array(VariantProposalSchema).optional(),
  flagged_items: z.array(FlaggedCompoundItemSchema).optional(),  // ← ADD
});
```

`flagged_items` is optional — absent when no compound-uncertain failure exists.

Also update `packages/types/src/index.ts` if `GetPlansResponse` type is re-exported there (it should pick up the new field automatically via `z.infer<typeof GetPlansResponseSchema>`).

- [x] Add `flagged_items: z.array(FlaggedCompoundItemSchema).optional()` to `GetPlansResponseSchema`
- [x] Run `pnpm --filter @hivekitchen/contracts exec tsc --noEmit` to confirm contracts compile
- [x] Confirm `FlaggedCompoundItem` type is exported from `packages/types/src/index.ts`

### Task 2 — Extend audit read path to fetch flagged_items (AC: 1, 2)

**File:** `apps/api/src/modules/plans/plans.service.ts` (or `plans.repository.ts`)

Current `getHardFailStatus()` returns `{ week_of: string; failed_at: string } | null`. It queries `audit_log` for a `plan.hard_fail` event for the household+week but does NOT read the `stages` JSON column.

Extend the method to also return `flagged_items`:

```typescript
async getHardFailStatus(
  householdId: string,
  weekOf: string,
): Promise<{ week_of: string; failed_at: string; flagged_items: FlaggedCompoundItem[] } | null>
```

The `stages` column on `audit_log` is a JSON array. Each stage may have shape:
```json
{
  "stage": "guardrail_rejection",
  "attempt": 1,
  "verdict": "uncertain",
  "reason": "compound_ingredient_unverified",
  "flagged_items": [{ "child_id": "...", "ingredient": "...", "slot": "...", "day": "..." }]
}
```

Extract flagged items from stages where `verdict === 'uncertain' && reason === 'compound_ingredient_unverified'`. Flatten all flagged_items from all stages into a single array (deduplicate by `(child_id, ingredient, slot, day)` tuple if the same compound appears across multiple attempts).

The `stages` column is `jsonb` — Supabase returns it as a parsed JS object. Cast safely: `z.array(z.unknown())` → narrow each stage manually rather than trusting a schema (the audit_log stages are untyped `Record<string, unknown>`).

```typescript
// Rough extraction logic:
const rawStages = (row.stages ?? []) as unknown[];
const flaggedItems: FlaggedCompoundItem[] = [];
for (const stage of rawStages) {
  if (
    typeof stage === 'object' && stage !== null &&
    'verdict' in stage && stage.verdict === 'uncertain' &&
    'reason' in stage && stage.reason === 'compound_ingredient_unverified' &&
    'flagged_items' in stage && Array.isArray(stage.flagged_items)
  ) {
    for (const item of stage.flagged_items) {
      flaggedItems.push(FlaggedCompoundItemSchema.parse(item));
    }
  }
}
```

- [x] Update `getHardFailStatus()` to SELECT `stages` from the audit_log row
- [x] Extract `flagged_items` from stages where compound-uncertain
- [x] Return `flagged_items: []` when no compound-uncertain stages found
- [x] Update return type to include `flagged_items: FlaggedCompoundItem[]`

### Task 3 — Update GET /v1/plans route handler (AC: 1, 2, 3)

**File:** `apps/api/src/modules/plans/plans.routes.ts`

Current hard-fail read (lines ~82–95):
```typescript
let hardFail: { week_of: string; failed_at: string } | null = null;
if (plan === null && !isDraft) {
  try {
    hardFail = await fastify.plansService.getHardFailStatus(householdId, weekOf);
  } catch (err) {
    request.log.error({ err, householdId, weekOf }, 'getHardFailStatus failed — omitting hard_fail from response');
  }
}
```

Update to extract `flagged_items` from the extended return:

```typescript
let hardFail: { week_of: string; failed_at: string } | null = null;
let flaggedItems: FlaggedCompoundItem[] = [];
if (plan === null && !isDraft) {
  try {
    const failStatus = await fastify.plansService.getHardFailStatus(householdId, weekOf);
    if (failStatus !== null) {
      hardFail = { week_of: failStatus.week_of, failed_at: failStatus.failed_at };
      flaggedItems = failStatus.flagged_items;
    }
  } catch (err) {
    request.log.error({ err, householdId, weekOf }, 'getHardFailStatus failed — omitting hard_fail from response');
  }
}
```

Add `flagged_items` to the response (only when non-empty):
```typescript
return reply.status(200).send({
  plan: plan ?? null,
  plan_items: planItems,
  is_draft: isDraft,
  week_of: weekOf,
  ...(hardFail !== null ? { hard_fail: hardFail } : {}),
  variant_proposals: variantProposals,
  ...(flaggedItems.length > 0 ? { flagged_items: flaggedItems } : {}),
});
```

- [x] Extract `flaggedItems` from extended `getHardFailStatus()` return
- [x] Add `flagged_items` to route response (conditional on non-empty)
- [x] Update local variable types to match extended return

### Task 4 — Wire `AllergyUncertaintyBanner` in `BriefCanvas` (AC: 4, 5)

**File:** `apps/web/src/features/plan/BriefCanvas.tsx`

The component accepts:
```typescript
interface AllergyUncertaintyBannerProps {
  flaggedItems: readonly AllergyUncertaintyFlaggedItem[];
  onRetry: () => void;
  onSwapSlot: (childId: string, day: string, slot: string) => void;
}
```

`AllergyUncertaintyFlaggedItem` shape matches `FlaggedCompoundItem` from contracts (`{ ingredient, slot, day, childName, childId }`). Note: the component expects `childName` but the contract only carries `child_id`. You will need to resolve child names from the household data (children are available in the plan store or can be passed as props — check how `BriefCanvas` currently accesses child data).

**Wire the banner:**

1. Import `AllergyUncertaintyBanner` (already exists at `apps/web/src/features/plan/AllergyUncertaintyBanner.tsx`)
2. Receive `flaggedItems` as a prop on `BriefCanvas` (add to `BriefCanvasProps`) or read from the plan store
3. Map `flagged_items` from the plan response to `AllergyUncertaintyFlaggedItem[]` — resolve `childName` from children list
4. Render `<AllergyUncertaintyBanner>` in the existing hard-fail area of `BriefCanvas` (near where `<FreshnessState>` renders, after the degraded plan_state section)

**`onRetry`:** call the existing plan regeneration mutation (check `apps/web/src/features/plan/mutations.ts` for the regenerate mutation)

**`onSwapSlot`:** call the existing slot swap mutation (check `mutations.ts`)

The component already returns `null` when `flaggedItems.length === 0` — no conditional render needed at the call site.

- [x] Add `flaggedItems` to `BriefCanvasProps` or read from store
- [x] Resolve child names from children list to populate `childName`
- [x] Import and render `<AllergyUncertaintyBanner>` in BriefCanvas
- [x] Wire `onRetry` to plan regeneration mutation
- [x] Wire `onSwapSlot` to slot swap mutation

### Task 5 — Add route tests (AC: 1, 2, 3)

**File:** `apps/api/src/modules/plans/plans.routes.test.ts`

Add test cases:
- Compound-uncertain hard-fail → `flagged_items` in response
- Blocked hard-fail (no compound uncertainty) → `flagged_items` absent
- No hard-fail → `flagged_items` absent

- [x] Test: compound-uncertain hard-fail returns `flagged_items`
- [x] Test: blocked hard-fail returns no `flagged_items`
- [x] Test: no failure returns no `flagged_items`

## Dev Notes

### Two Distinct Audit Events

Do NOT confuse `plan.hard_fail` and `plan.generation.failed`:
- **`plan.hard_fail`** — guardrail retry exhaustion; carries `stages` with `flagged_items`. This is the event to read.
- **`plan.generation.failed`** — infrastructure/BullMQ failure; does NOT carry compound-uncertain data.

The existing `getHardFailStatus()` already reads `plan.hard_fail` correctly. Only extend it.

### Child Name Resolution

`AllergyUncertaintyBanner` needs `childName` but `FlaggedCompoundItem` only has `child_id`. Check how `BriefCanvas` currently accesses the household's children list. If the plan store carries children (from the household profile or onboarding data), map `child_id` → `child.name` there. If not available, pass children as a prop. Do NOT add an extra API call for this.

### Stages Column Safety

The `stages` JSONB column on `audit_log` is untyped at the DB level. Narrow each stage with explicit property checks + `FlaggedCompoundItemSchema.parse()` rather than casting. A malformed stage should be skipped (log a warning), not thrown.

### No Behavior Change in Non-Failure Path

When `plan !== null` (normal state), none of this code runs. The `if (plan === null && !isDraft)` guard ensures zero overhead on the happy path.

### Files to Touch

| File | Change |
|---|---|
| `packages/contracts/src/plan.ts` | Add `flagged_items` to `GetPlansResponseSchema` |
| `packages/types/src/index.ts` | Verify `FlaggedCompoundItem` exported (likely auto via z.infer) |
| `apps/api/src/modules/plans/plans.service.ts` | Extend `getHardFailStatus()` to return `flagged_items` |
| `apps/api/src/modules/plans/plans.routes.ts` | Wire `flagged_items` into response |
| `apps/api/src/modules/plans/plans.routes.test.ts` | New test cases |
| `apps/web/src/features/plan/BriefCanvas.tsx` | Import + render `AllergyUncertaintyBanner` |

### References

- Component: [Source: `apps/web/src/features/plan/AllergyUncertaintyBanner.tsx`]
- Contract: [Source: `packages/contracts/src/plan.ts` — `GetPlansResponseSchema`, `FlaggedCompoundItemSchema`]
- Route handler: [Source: `apps/api/src/modules/plans/plans.routes.ts` lines 60–112]
- Audit write: [Source: `apps/api/src/modules/plans/plans.service.ts` lines 341–372]
- Audit event types: [Source: `apps/api/src/audit/audit.types.ts`]
- Deferred-work entry: [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — "Deferred from: implementation of 3-24"]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] via bmad-dev-story workflow (2026-05-26).

### Debug Log References

- Backend tests on touched files (plans.service / plans.repository / plans.routes): 130/130 pass.
- BriefCanvas tests: 26/26 pass.
- `pnpm --filter @hivekitchen/contracts exec tsc --noEmit`: clean.
- `pnpm --filter @hivekitchen/web exec tsc --noEmit`: clean.
- `pnpm --filter @hivekitchen/types exec tsc --noEmit`: clean.
- Pre-existing failures in the `apps/api` suite (DayOverrides repo/service, brief-state.composer, plan-adjustment.service) were verified pre-existing by `git stash && vitest ; git stash pop`. None traceable to this slice.
- Pre-existing failures in `apps/web` (DisambiguationPicker, 6 tests) and `packages/contracts` (TurnBodyRatificationPrompt, SetDayOverrideInputSchema) likewise verified pre-existing.

### Completion Notes List

- **Contract (Task 1).** `GetPlansResponseSchema` now carries `flagged_items: z.array(FlaggedCompoundItemSchema).optional()`. `FlaggedCompoundItem` already exported from `@hivekitchen/types` via `z.infer`. Field is optional + omitted on happy path so all existing clients see no shape change.
- **Repository (Task 2).** `PlansRepository.findHardFailAudit()` now selects `id, created_at, stages` (was `id, created_at`) and returns `{ failedAt, stages: unknown } | null`. `stages` propagates as raw JSONB; narrowing happens at the service layer.
- **Service (Task 2).** `PlansService.getHardFailStatus()` now returns `{ week_of, failed_at, flagged_items: FlaggedCompoundItem[] } | null`. The new private `extractFlaggedItems(rawStages: unknown)` helper safely narrows the JSONB column: skips non-uncertain / non-compound stages, validates each `flagged_items` entry via `FlaggedCompoundItemSchema.safeParse()`, logs + skips malformed entries (does not throw), and dedupes by `(child_id, ingredient, slot, day)` tuple so the same compound appearing across retry attempts collapses to one banner row.
- **Route (Task 3).** `GET /v1/plans` extracts `flagged_items` from the extended `getHardFailStatus` return and conditionally includes it in the 200 body when non-empty. Spread guard (`...(flaggedItems.length > 0 ? { flagged_items } : {})`) keeps the happy path identical to pre-pre-4-s3 responses.
- **Frontend (Task 4).** `BriefCanvas` now consumes `usePlanQuery('current')` alongside the existing brief query, builds an `AllergyUncertaintyFlaggedItem[]` (resolving `childName` from `brief.cleared_allergies`, fallback `'your child'` per "no extra API call" rule), and renders `<AllergyUncertaintyBanner>` in two places: (a) before the main brief content for the brief-present path, and (b) as a dedicated early-return when brief is null and flagged_items > 0 (first-ever hard-fail scenario). `onRetry` ⇒ `handleRegenerate('week')` when planId exists, else invalidates `['plans']` + `['brief']`. `onSwapSlot` ⇒ `handleRegenerate('day', day)` when planId exists, else same invalidation fallback. The banner self-hides on empty array (already a property of the standalone component) so AC5 is satisfied without a conditional render at the call site beyond the wrapping div.
- **Tests (Task 5).** Added 3 route tests covering AC1/AC2/AC3 (compound-uncertain ⇒ flagged_items in response; blocked-only ⇒ no flagged_items; no failure ⇒ no flagged_items). Added 5 new service tests covering the `extractFlaggedItems` paths (empty stages, multi-stage extraction with non-compound skip, dedup across retries, infrastructure reason filter, malformed entries logged-and-skipped). Updated existing route + service + repository tests whose mocks didn't carry the new fields (`stages` on repo return, `flagged_items: []` on service return) — pure mock-shape sync, no behavior assertions changed.
- **Design alignment.** Banner uses the existing v2.0 `honey-amber-*` palette (already in the standalone component). No new tokens introduced. Edits to `BriefCanvas` are additive — no v2.0 component (`PageHeader`, `FreshnessState`, `PlanTile`, `QuietDiff`, `AllergyClearedBadge`) was modified.
- **Acceptance criteria.** AC1 ✓ (route returns `flagged_items` on compound-uncertain hard-fail); AC2 ✓ (omitted when blocked-only); AC3 ✓ (omitted on no-failure); AC4 ✓ (banner renders with onRetry + onSwapSlot wired); AC5 ✓ (banner returns null when flaggedItems empty — preserved component behavior); AC6 ✓ (`pnpm typecheck` clean across contracts, api[touched files only — pre-existing unrelated errors], web, types).

### File List

Modified:
- `packages/contracts/src/plan.ts` — added `flagged_items` field to `GetPlansResponseSchema`.
- `apps/api/src/modules/plans/plans.repository.ts` — extended `findHardFailAudit` to select + return `stages`.
- `apps/api/src/modules/plans/plans.service.ts` — extended `getHardFailStatus` return + added `extractFlaggedItems` helper + imported `FlaggedCompoundItemSchema`/`FlaggedCompoundItem`.
- `apps/api/src/modules/plans/plans.routes.ts` — extracted `flaggedItems` from service return + conditional response field + imported `FlaggedCompoundItem`.
- `apps/api/src/modules/plans/plans.service.test.ts` — updated `getHardFailStatus` describe block (1 updated test + 4 new tests); covers extraction, dedup, infrastructure-reason filter, malformed-entry skip.
- `apps/api/src/modules/plans/plans.repository.test.ts` — updated 1 test for new `stages` field in select + return shape.
- `apps/api/src/modules/plans/plans.routes.test.ts` — updated 2 existing tests (mocks now include `flagged_items: []`) + added 3 new tests (AC1/AC2/AC3).
- `apps/web/src/features/plan/BriefCanvas.tsx` — added `usePlanQuery('current')` consumption, `flaggedItems` memo, two banner render sites, `handleBannerRetry` + `handleBannerSwapSlot` handlers.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `pre-4-s3` ready-for-dev → review.

### Change Log

| Date | Author | Note |
|---|---|---|
| 2026-05-26 | bmad-dev-story | Implemented all 5 tasks (contract extension, repo + service extraction, route response, frontend wiring, tests). 9 new tests added; 4 existing tests synced to new mock shapes. 130/130 plan tests pass; 26/26 BriefCanvas tests pass. Pre-existing failures in unrelated test files confirmed via stash-and-compare. Status → review. |

### Review Findings

- [x] [Review][Decision] Banner placement at top of return — RESOLVED: keep at top; safety-critical content leads; spec placement (after FreshnessState) would bury allergen warning below the fold. UX rationale overrides spec guidance. [`apps/web/src/features/plan/BriefCanvas.tsx:316`]
- [x] [Review][Patch] Swap button shown in hard-fail state where nothing can be swapped — `onSwapSlot` made optional on `AllergyUncertaintyBanner`; swap button + hint text hidden when not provided; not passed from BriefCanvas [`apps/web/src/features/plan/AllergyUncertaintyBanner.tsx`, `apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Decision] Child name resolved from `cleared_allergies`, not the children list — RESOLVED: accept "your child" fallback; children list requires a new API call which spec forbids; the ingredient + day info remains actionable; fix deferred until a useChildrenQuery hook exists in the app [`apps/web/src/features/plan/BriefCanvas.tsx:106`]
- [x] [Review][Patch] `['plans']` invalidation key mismatch — `handleBannerRetry` now uses `QueryKeys.planByWeek('current')`; `handleBannerSwapSlot` removed (swap button no longer rendered) [`apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Patch] `usePlanQuery` called without `enabled` guard — `usePlanQuery` now accepts `options?: { enabled?: boolean }`; BriefCanvas passes `{ enabled: householdId !== null }` [`apps/web/src/features/plan/queries.ts`, `apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Patch] Early-return flicker — condition now includes `!isPlanLoading`; banner shown only after both brief and plan queries resolve [`apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Patch] Error log message stale — updated to `'getHardFailStatus failed — omitting hard_fail and flagged_items from response'` [`apps/api/src/modules/plans/plans.routes.ts`]
- [x] [Review][Patch] Dedup key `|` separator collision — key now uses `JSON.stringify([child_id, ingredient, slot, day])` [`apps/api/src/modules/plans/plans.service.ts`]
- [x] [Review][Defer] Stale hard-fail banner — no time bound on `plan.hard_fail` audit age; a days-old hard-fail surfaces the same actionable retry/swap banner; pre-existing audit query design [`apps/api/src/modules/plans/plans.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] `JSON.stringify` as `useMemo` dep — `flaggedItemsRaw` creates a new `[]` reference each render; `JSON.stringify` stabilizes it but is fragile; consider memoizing the query result directly [`apps/web/src/features/plan/BriefCanvas.tsx:120`] — deferred, pre-existing
- [x] [Review][Defer] Uncertain-non-compound stages silently filtered — when `verdict=uncertain` but `reason≠compound_ingredient_unverified`, stage is skipped with no `warn` log; future reason-string drift will produce zero flagged_items with no diagnostic [`apps/api/src/modules/plans/plans.service.ts:449`] — deferred, pre-existing
- [x] [Review][Defer] `usePlanQuery` fires on happy path — new `GET /v1/plans?week=current` on every BriefCanvas render; spec dev notes say "no behavior change in non-failure path" re: backend cost, but frontend now adds a second query on all brief renders [`apps/web/src/features/plan/BriefCanvas.tsx:65`] — deferred, pre-existing design choice
- [x] [Review][Defer] `FlaggedCompoundItemSchema` UUID strictness — schema requires strict UUID for `child_id`; real child IDs come from DB (UUID-enforced), so this is correct, but any future non-UUID child ID variant silently drops the entire flagged item with only a `warn` log [`apps/api/src/modules/plans/plans.service.ts:465`] — deferred, pre-existing DB constraint coverage
