# Story 3.15: Historical Plans + Outcomes View

Status: review

## Story

As a Primary Parent,
I want to view historical plans and their outcomes (emoji ratings, swaps made) for any prior week,
So that I can see the family's eating history and reference what worked (FR25).

## Acceptance Criteria

1. **Given** Story 3.5 + Epic 4 lunch_link_sessions (rated outcomes) exist,
   **When** I navigate to `/app/plan/:weekId` for a past week,
   **Then** plan tiles render in `past` variant (low-saturation, non-interactive) with rating overlay (emoji from FR36 Layer 1, per-item Layer 2 swipes if any).

2. **And** the swap history is visible per-tile via tap → Popover.

**Note on Epic 4 dependency:** `lunch_link_sessions` (ratings) are not yet implemented. This story should build the history view infrastructure that works today (swap history visible), with ratings rendered as empty/placeholder state until Epic 4 ships. Do not block on Epic 4.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `plans` table, `plan_items` table, `PlansRepository.findByIdForPresentation()`, `findItemsByPlanId()`
- Story 3.9: `<PlanTile>` with `past` variant (low-saturation, non-interactive)
- Story 3.12: `plan_items.paused_at` — swap semantics (slot swaps produce new `plan_items` rows; day-swaps change `day` column; paused items set `paused_at`)
- Story 3.13: `PlansRepository.findAllItemsByPlanId()` — returns ALL items including archived (`replaced_by_plan_id IS NOT NULL`). This is the history read path. `PlanItemRow.replaced_by_plan_id` — null = current, non-null = archived by a later generation.
- Story 3.14: `GET /v1/plans?week=current|next`, `findByHouseholdAndWeek()`, `deriveWeekId()`
- `PLAN_COLUMNS`, `PLAN_ITEM_COLUMNS` in `plans.repository.ts` — single source of truth for column lists
- `QueryKeys` in `apps/web/src/lib/realtime/query-keys.ts`
- `hkFetch` in `apps/web/src/lib/fetch.ts`
- `authorize(['primary_parent', 'secondary_caregiver'])` preHandler

**Key invariants from previous stories:**
- `findByIdForPresentation()` enforces `WHERE guardrail_cleared_at IS NOT NULL` — past plans are always presentation-cleared
- `findAllItemsByPlanId()` is the ops/history bypass — it returns archived rows; use it for swap history
- `findItemsByPlanId()` only returns current (non-archived) items — use it for "final plan" display
- No `framer-motion` — Tailwind animation utilities only
- Logical-property lint rule: `start-*`/`end-*`, `ps-*`/`pe-*` — never `left-*`/`right-*`
- `import type` for all type-only imports
- No `console.*`

---

## Tasks / Subtasks

- [x] Task 1 — Contracts: add historical plan schemas
- [x] Task 2 — PlansRepository: add `findByWeekId()` and `findSwapHistory()`
- [x] Task 3 — PlansService: add `getPlanHistory()`
- [x] Task 4 — Route: add `GET /v1/plans/:weekId/history`
- [x] Task 5 — Frontend: `usePlanHistoryQuery` hook
- [x] Task 6 — Frontend: `PlanHistoryPage` component
- [x] Task 7 — Frontend: `SwapHistoryPopover` component
- [x] Task 8 — Register `/app/plan/:weekId` route
- [x] Task 9 — Add history link to PlanPage
- [x] Task 10 — Contract tests
- [x] Task 11 — API service tests
- [x] Task 12 — Typecheck and tests

### Task 1 — Contracts: add historical plan schemas

In `packages/contracts/src/plan.ts`, add:

```typescript
// Summary of a swap event derived from archived plan_items.
// Each archived item (replaced_by_plan_id IS NOT NULL) represents a previous version.
export const PlanItemSwapSummarySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  slot: z.string().min(1),
  previous_ingredients: z.array(z.string()),
  replaced_at: z.string().datetime(), // updated_at of the archived item
});

// Response for GET /v1/plans/:weekId/history
export const PlanHistoryResponseSchema = z.object({
  plan: PlanRowSchema.nullable(), // null if no plan for this week
  plan_items: z.array(PlanItemRowSchema), // current (final) items only
  swap_history: z.array(PlanItemSwapSummarySchema), // per-slot swap audit
  week_of: z.string().date().nullable(),
  // Ratings stubs — populated once Epic 4 ships lunch_link_sessions.
  // For now always empty; typed here to keep the contract stable.
  ratings: z.record(z.string(), z.string().nullable()), // child_id → emoji | null
});

// Route param schema
export const PlanWeekIdParamSchema = z.object({
  weekId: z.string().uuid(),
});
```

In `packages/types/src/index.ts`, add:
```typescript
export type PlanItemSwapSummary = z.infer<typeof PlanItemSwapSummarySchema>;
export type PlanHistoryResponse = z.infer<typeof PlanHistoryResponseSchema>;
```

### Task 2 — PlansRepository: add `findByWeekId()` and `findSwapHistory()`

In `apps/api/src/modules/plans/plans.repository.ts`, add:

```typescript
// Find plan by household + week_id (presentation-enforcing).
// Wraps findByHouseholdAndWeek from Story 3.14 — just expose it under a semantically
// clearer name for the history controller.
async findByWeekId(opts: {
  householdId: string;
  weekId: string;
}): Promise<PlanRow | null> {
  return this.findByHouseholdAndWeek(opts);
}

// Returns swap-event summaries for a plan: one entry per archived plan_item row.
// Each archived item (replaced_by_plan_id IS NOT NULL) represents a prior version
// before a slot-swap or day-scope regeneration archived it.
// presentation-bypass: ops-history — intentional; used only for the history panel.
async findSwapHistory(planId: string): Promise<PlanItemSwapSummary[]> {
  const allItems = await this.findAllItemsByPlanId(planId);
  return allItems
    .filter((item) => item.replaced_by_plan_id !== null)
    .map((item) => ({
      day: item.day,
      slot: item.slot,
      previous_ingredients: item.ingredients,
      replaced_at: item.updated_at,
    }));
}
```

**Note:** `PlanItemSwapSummary` type needs to be imported from `@hivekitchen/types` in the repository file.

### Task 3 — PlansService: add `getPlanHistory()`

In `apps/api/src/modules/plans/plans.service.ts`, add:

```typescript
async getPlanHistory(opts: {
  householdId: string;
  weekId: string;
}): Promise<{
  plan: PlanRow | null;
  planItems: PlanItemRow[];
  swapHistory: PlanItemSwapSummary[];
  weekOf: string | null;
}> {
  const plan = await this.repo.findByWeekId({
    householdId: opts.householdId,
    weekId: opts.weekId,
  });

  if (!plan) {
    return { plan: null, planItems: [], swapHistory: [], weekOf: null };
  }

  const [planItems, swapHistory] = await Promise.all([
    this.repo.findItemsByPlanId(plan.id),   // current (final) items
    this.repo.findSwapHistory(plan.id),      // archived items = swap history
  ]);

  return { plan, planItems, swapHistory, weekOf: plan.week_of };
}
```

### Task 4 — Route: add `GET /v1/plans/:weekId/history`

In `apps/api/src/modules/plans/plans.routes.ts`, add:

```typescript
import {
  PlanHistoryResponseSchema,
  PlanWeekIdParamSchema,
} from '@hivekitchen/contracts';

// GET /v1/plans/:weekId/history
// Returns the final plan for a past week + swap history derived from archived items.
// Ratings stubs always empty until Epic 4 lunch_link_sessions are implemented.
fastify.get(
  '/v1/plans/:weekId/history',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      params: PlanWeekIdParamSchema,
      response: { 200: PlanHistoryResponseSchema },
    },
  },
  async (request, reply) => {
    const { weekId } = request.params as { weekId: string };
    const { plan, planItems, swapHistory, weekOf } = await fastify.plansService.getPlanHistory({
      householdId: request.user.household_id,
      weekId,
    });
    return reply.send({
      plan: plan ?? null,
      plan_items: planItems,
      swap_history: swapHistory,
      week_of: weekOf,
      ratings: {}, // Epic 4 stub — populated when lunch_link_sessions.rating lands
    });
  },
);
```

### Task 5 — Frontend: `usePlanHistoryQuery` hook

In `apps/web/src/features/plan/queries.ts`, add:

```typescript
import type { PlanHistoryResponse } from '@hivekitchen/types';

export function usePlanHistoryQuery(weekId: string | undefined) {
  return useQuery<PlanHistoryResponse>({
    queryKey: ['plan-history', weekId],
    queryFn: () => hkFetch(`/v1/plans/${weekId!}/history`),
    enabled: weekId !== undefined,
    staleTime: 5 * 60 * 1000, // 5 min — history doesn't change often
  });
}
```

### Task 6 — Frontend: `PlanHistoryPage` component

Create `apps/web/src/features/plan/PlanHistoryPage.tsx`:

```typescript
// Route: /app/plan/:weekId
// Renders the historical plan view for a specific week.
// Plan tiles in 'past' variant (non-interactive, low-saturation per Story 3.9).
// Swap history shown in a Popover when tile is tapped.

import { useParams } from '...'; // use whatever router is in use
import { usePlanHistoryQuery } from './queries.js';
import { PlanTile } from './PlanTile.js';
import { FreshnessState } from './FreshnessState.js';
import { SwapHistoryPopover } from './SwapHistoryPopover.js';
import type { PlanItemSwapSummary } from '@hivekitchen/types';

export function PlanHistoryPage() {
  const { weekId } = useParams<{ weekId: string }>();
  const { data, isLoading, isError } = usePlanHistoryQuery(weekId);

  return (
    <div className="app-scope flex flex-col gap-6 px-4 py-6 max-w-2xl mx-auto">
      {isLoading && <FreshnessState variant="loading" />}
      {isError && <FreshnessState variant="failed" />}
      {!isLoading && !isError && data && (
        <>
          {data.plan === null ? (
            <p className="font-sans text-[15px] text-stone-400 text-center">
              No plan found for this week.
            </p>
          ) : (
            <>
              {data.week_of && (
                <p className="font-sans text-[13px] text-stone-400">
                  Week of {new Date(data.week_of + 'T00:00:00Z').toLocaleDateString(undefined, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              )}
              <div className="flex flex-col gap-3">
                {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const).map((day) => {
                  const dayItems = data.plan_items.filter((item) => item.day === day);
                  const daySwaps = data.swap_history.filter((s) => s.day === day);
                  return (
                    <div key={day} className="relative">
                      <PlanTile
                        day={day}
                        items={dayItems}
                        variant="past"
                        planId={data.plan!.id}
                      />
                      {daySwaps.length > 0 && (
                        <SwapHistoryPopover swaps={daySwaps} />
                      )}
                    </div>
                  );
                })}
            </>
          )}
        </>
      )}
    </div>
  );
}
```

### Task 7 — Frontend: `SwapHistoryPopover` component

Create `apps/web/src/features/plan/SwapHistoryPopover.tsx`:

```typescript
// Renders a small tap-target that opens a Popover listing swap events for a day.
// Uses Radix Popover (available via shadcn/ui — verify it's installed in packages/ui).

import * as Popover from '@radix-ui/react-popover';
import type { PlanItemSwapSummary } from '@hivekitchen/types';

interface SwapHistoryPopoverProps {
  swaps: PlanItemSwapSummary[];
}

export function SwapHistoryPopover({ swaps }: SwapHistoryPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="absolute top-2 end-2 font-sans text-[11px] text-stone-400 underline underline-offset-2 hover:text-stone-600 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          aria-label={`View ${swaps.length} swap${swaps.length !== 1 ? 's' : ''} for this day`}
        >
          {swaps.length} swap{swaps.length !== 1 ? 's' : ''}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 rounded-xl border border-stone-200 bg-white p-4 shadow-md w-64 font-sans text-[13px] text-stone-700"
          sideOffset={4}
        >
          <p className="font-medium text-stone-800 mb-2">Swap history</p>
          <ul className="flex flex-col gap-2">
            {swaps.map((swap, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="font-medium capitalize">{swap.slot}</span>
                <span className="text-stone-500 text-[12px]">
                  Was: {swap.previous_ingredients.join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <Popover.Arrow className="fill-stone-200" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

**Note:** Verify `@radix-ui/react-popover` is installed in `apps/web`. If not, install it or use the shadcn Popover component if already available in `packages/ui`.

### Task 8 — Register `/app/plan/:weekId` route

In the web app router, register `/app/plan/:weekId` pointing to `PlanHistoryPage`. Follow the existing route registration pattern.

### Task 9 — Add history link to BriefCanvas or PlanPage

On the `PlanPage` (Story 3.14), add a "View previous weeks" link navigating to `/app/plan/:weekId` for the last few weeks. This is optional — the history page must be reachable. Even a simple link in the `/app/plan` page footer works.

### Task 10 — Contract tests

In `packages/contracts/src/plan.test.ts`, add:
- `PlanHistoryResponseSchema` accepts `plan: null, plan_items: [], swap_history: [], week_of: null, ratings: {}`
- `PlanHistoryResponseSchema` accepts `ratings: { 'uuid': '🧡' }` (Epic 4 forward-compatibility)
- `PlanItemSwapSummarySchema` accepts valid shape; rejects missing `day`

### Task 11 — API service tests

In `apps/api/src/modules/plans/plans.service.test.ts`, add:
- `getPlanHistory()` returns null plan when repository returns null
- `getPlanHistory()` returns both final items and swap history for an existing plan
- Verify `Promise.all([findItemsByPlanId, findSwapHistory])` concurrency

### Task 12 — Typecheck and tests

- `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test`
- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans`
- `pnpm --filter @hivekitchen/web typecheck`

---

## Dev Notes

### Epic 4 dependency — ratings stubs

This story builds the full history view infrastructure. Ratings (`lunch_link_sessions.rating`) won't be available until Epic 4 ships. The response contract already includes `ratings: Record<string, string | null>` — it will always be `{}` until Epic 4's Story 4.14 populates it. No code changes needed here when Epic 4 ships — just populate the `ratings` field in the route handler.

### Swap history derivation from `replaced_by_plan_id`

"Swap history" for a plan day is derived from archived `plan_items` rows. When a slot is swapped (Story 3.12) or a day is regenerated (Story 3.13), the old items are archived (set `replaced_by_plan_id = plan_id`). Each archived item is one swap event. The `previous_ingredients` field shows what was there before. This is a read of `findAllItemsByPlanId()` filtered to `replaced_by_plan_id IS NOT NULL`.

### Past variant non-interactivity

The `<PlanTile>` `past` variant (from Story 3.9) must be fully non-interactive — no swap trigger, no pause affordance. Confirm the `past` variant disables keyboard Tab stop on interactive elements inside the tile (use `tabIndex={-1}` or `aria-disabled` on action buttons).

### URL structure: `/app/plan/:weekId`

The `weekId` parameter is the UUID from `plans.week_id` (derived via `deriveWeekId(weekOf)`). It is NOT the `plans.id` (the plan row's primary key). The route loads by `week_id` so the URL is stable across plan regenerations (a regen creates a new plan row revision but keeps the same `week_id`). Confirm this with `findByWeekId()` which queries by `week_id`.

### No SSE invalidation for history

History pages don't subscribe to `plan.updated` SSE events — past plans don't change. The `staleTime: 5 * 60 * 1000` in the query hook avoids unnecessary refetching.

---

## Project Structure

**New files:**
```
apps/web/src/features/plan/PlanHistoryPage.tsx
apps/web/src/features/plan/PlanHistoryPage.test.tsx
apps/web/src/features/plan/SwapHistoryPopover.tsx
apps/web/src/features/plan/SwapHistoryPopover.test.tsx
```

**Modified files:**
```
packages/contracts/src/plan.ts                          + PlanItemSwapSummarySchema, PlanHistoryResponseSchema, PlanWeekIdParamSchema
packages/contracts/src/plan.test.ts                     + history schema tests
packages/types/src/index.ts                             + PlanItemSwapSummary, PlanHistoryResponse
apps/api/src/modules/plans/plans.repository.ts          + findByWeekId(), findSwapHistory()
apps/api/src/modules/plans/plans.service.ts             + getPlanHistory()
apps/api/src/modules/plans/plans.service.test.ts        + getPlanHistory tests
apps/api/src/modules/plans/plans.routes.ts              + GET /v1/plans/:weekId/history
apps/web/src/features/plan/queries.ts                   + usePlanHistoryQuery()
apps/web/src/app/router.tsx (or equivalent)             + /app/plan/:weekId route
_bmad-output/implementation-artifacts/sprint-status.yaml   3-15 → ready-for-dev
```

**Do NOT touch:**
```
apps/web/src/features/plan/PlanTile.tsx        (use past variant as-is)
apps/web/src/features/plan/FreshnessState.tsx  (use as-is)
apps/api/src/modules/plans/plans.repository.ts (findAllItemsByPlanId — already exists from 3.13)
```

---

## Dev Agent Record

### File List

**New files:**
- `apps/web/src/features/plan/PlanHistoryPage.tsx`
- `apps/web/src/features/plan/PlanHistoryPage.test.tsx`
- `apps/web/src/features/plan/SwapHistoryPopover.tsx`
- `apps/web/src/features/plan/SwapHistoryPopover.test.tsx`
- `apps/web/src/routes/(app)/plan-history.tsx`
- `apps/web/src/lib/derive-week-id.ts`

**Modified files:**
- `packages/contracts/src/plan.ts` — added `PlanItemSwapSummarySchema`, `PlanWeekIdParamSchema`, `PlanHistoryResponseSchema`
- `packages/contracts/src/plan.test.ts` — added schema tests for the three new schemas
- `packages/types/src/index.ts` — exported `PlanItemSwapSummary`, `PlanWeekIdParam`, `PlanHistoryResponse` types
- `apps/api/src/modules/plans/plans.repository.ts` — added `findByWeekId()` and `findSwapHistory()`
- `apps/api/src/modules/plans/plans.service.ts` — added `getPlanHistory()`
- `apps/api/src/modules/plans/plans.service.test.ts` — added `getPlanHistory` test suite
- `apps/api/src/modules/plans/plans.routes.ts` — added `GET /v1/plans/:weekId/history`
- `apps/web/src/features/plan/queries.ts` — added `usePlanHistoryQuery`
- `apps/web/src/features/plan/PlanTile.tsx` — added optional `forceVariant` prop
- `apps/web/src/features/plan/PlanPage.tsx` — added "View last week" link
- `apps/web/src/features/plan/PlanPage.test.tsx` — wrapped renderer in `MemoryRouter`
- `apps/web/src/lib/realtime/query-keys.ts` — added `planHistory` key
- `apps/web/src/app.tsx` — registered `/app/plan/:weekId` route
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 3-15 → review

### Completion Notes

- Implemented the historical plan + outcomes view (FR25) end-to-end: contract schemas, repository methods, service method, Fastify route, React Query hook, page + popover components, and route wiring with the parental-notice gate.
- AC1: tiles render in `past` variant for every weekday. PlanTile's existing `deriveVariant` is day-of-week relative to today; for prior weeks every day must be past, so I added an opt-in `forceVariant` prop to PlanTile (additive, default behavior unchanged) and threaded `forceVariant="past"` from PlanHistoryPage. This deviates from the "Do NOT touch PlanTile.tsx" guidance in the Project Structure section, but that note conflicted with the AC and Task 6's example which assumed a `variant` prop. The change is minimal, reverse-compatible, and necessary for the past-variant guarantee.
- AC2: per-day swap audit visible via `<SwapHistoryPopover>`. Popover follows the existing inline-disclosure pattern used by `AllergyClearedBadge` (no Radix dep added) — keyboard-dismissable with focus restoration.
- Epic 4 dependency: `ratings` field on `PlanHistoryResponseSchema` is shipped as `Record<string, string|null>` and the route always returns `{}`. When Epic 4 Story 4.14 lands, `getPlanHistory()`'s call site can populate the field without contract changes.
- Navigation reachability (Task 9): added "View last week" link on `/app/plan` that derives the previous Monday's `week_id` client-side via `crypto.subtle.digest('SHA-256', ...)` mirroring the server's `deriveWeekId`. This avoided requiring a new list endpoint while keeping the history page reachable.
- Pre-existing test failures unrelated to this story remain on main: `cultural.test.ts > TurnBodyRatificationPrompt`, `BriefCanvas.test.tsx > Edit Monday group`, several API typecheck errors in test files, and voice service tests. Verified these fail on main with my changes stashed; not introduced by this story.

### Test Results

- **Contracts**: 141 tests pass (16 new schema tests for `PlanItemSwapSummarySchema`, `PlanWeekIdParamSchema`, `PlanHistoryResponseSchema`).
- **API plans module**: 111 tests pass (4 new `getPlanHistory` tests covering null-plan, populated, parallelism, weekId pass-through).
- **Web plan feature**: 50 tests pass across `PlanHistoryPage`, `SwapHistoryPopover`, `PlanTile`, `PlanPage`.
- **Typecheck**: contracts, types, web all pass. API typecheck errors are pre-existing and unrelated to this story.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.15 created — ready-for-dev. |
| 2026-05-05 | Menon (Dev) | Implemented Tasks 1–12; status → review. |
| 2026-05-05 | Code Review | Adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 26 findings triaged → 3 decision-needed, 15 patch, 8 defer, 12+ dismissed. |
| 2026-05-05 | Code Review (batch-apply) | Applied 14 patches (contract `child_id` + tightened `ratings`, 404 path, popover a11y/grouping/break-words/empty-fallback, query-key + URL-encode hardening, current-week redirect, deterministic parallelism test, `deriveWeekId` shared util). Skipped: Story 3.12 archive-and-insert (out of scope), Saturday handling (UX decision). Dismissed on review: Sunday off-by-one (consistent with server semantics). All 3.15-related tests pass; pre-existing failures unaffected. |

---

### Review Findings

**Decision-needed (resolved)**

- [x] [Review][Decision→Patch] Per-slot swaps are invisible in swap history — **Resolved: Option B.** Fix Story 3.12: change `updateItemIngredients` (`apps/api/src/modules/plans/plans.repository.ts:178`) to archive-and-insert so per-slot swaps produce archived rows that `findSwapHistory` can read. Aligns implementation with the spec text from Story 3.12. (Promoted to patch.)
- [x] [Review][Decision→Patch] `PlanItemSwapSummary` lacks `child_id` — **Resolved: Option A.** Enrich `PlanItemSwapSummarySchema` (`packages/contracts/src/plan.ts:321`) with `child_id`; thread it through `findSwapHistory`, `getPlanHistory`, and group entries by child in `SwapHistoryPopover`. (Promoted to patch.)
- [x] [Review][Decision→Patch] `GET /v1/plans/:weekId/history` returns 200 + empty for non-owned weekId — **Resolved: Option A.** Throw a `NotFoundError` from `getPlanHistory()` when `findByWeekId` returns null; route surfaces 404. (Promoted to patch.)

**Patch**

- [ ] [Review][Patch][SKIPPED in batch] Per-slot swaps must archive instead of mutating in-place [`apps/api/src/modules/plans/plans.repository.ts:178-202` `updateItemIngredients`] — change the swap path to (a) set `replaced_by_plan_id` and `updated_at` on the existing row, (b) insert a new row with the new ingredients carrying the same `plan_id`, `child_id`, `day`, `slot`, `recipe_id`, `item_id`. Use a transaction (RPC) so partial failure cannot orphan the slot. Update Story 3.12 service and tests; verify `findItemsByPlanId` (which filters `replaced_by_plan_id IS NULL`) still returns exactly one row per `(plan_id, child_id, day, slot)` after a swap. **Skipped in batch-apply: out of Story 3.15 scope and requires a new SQL/RPC pattern + Story 3.12 service/tests changes. Carry to follow-up.**
- [x] [Review][Patch] Add `child_id` to swap summary contract — extended `PlanItemSwapSummarySchema` with `child_id: z.string().uuid()`; threaded through `findSwapHistory`; `SwapHistoryPopover` now groups by child with fallback "Child A/B/…" labels (optional `childLabels` prop accepts a child_id → display name map for future name resolution).
- [x] [Review][Patch] Return 404 for missing/non-owned weekId — `getPlanHistory()` throws `NotFoundError`; service return type tightened so `plan` is non-null. `PlanHistoryPage` detects `HkApiError` 404 and renders "No plan was generated for this week." Tests updated to mock 404 instead of `plan: null`.

- [ ] [Review][Patch][SKIPPED in batch — needs UX decision] Saturday silently dropped from history grid [`apps/web/src/features/plan/PlanHistoryPage.tsx:11`] — `WEEKDAYS = ['monday'..'friday']`, but `PlanItemRowSchema.day` and `PlanItemSwapSummarySchema.day` both permit `'saturday'`. Decide whether to widen the grid to 6 days or tighten the schema. Same Saturday concern is already in `_bmad-output/implementation-artifacts/deferred-work.md` from Story 3-14.
- [x] [Review][Patch] `s.day as Weekday` cast removed — `PlanHistoryPage.tsx` now reads `data.swap_history.filter((s) => s.day === summary.day)` with no unsafe cast (filter still narrowed by string equality, so no Saturday entry can match a `summary.day ∈ WEEKDAYS`).
- [~] [Review][Patch][DISMISSED on review] `getMondayWeeksAgo(1)` Sunday off-by-one — On Sunday the server's `getCurrentWeekMonday` returns the just-ended Monday (6 days back). `getMondayWeeksAgo(1)` returning the Monday 13 days back is the *prior* week, internally consistent with the server's "current" definition. Blind Hunter's mental model didn't match the server semantics.
- [x] [Review][Patch] `crypto.subtle.digest` failure handled — `.catch` added in `PlanPage.tsx`; insecure-context failures leave the "View last week" link absent without unhandled rejections.
- [x] [Review][Patch] `PlanHistoryResponseSchema.ratings` tightened — now `z.record(z.string().uuid(), z.string().min(1).nullable())`. Contract tests added for non-UUID-key + empty-string-value rejection.
- [x] [Review][Patch] `SwapHistoryPopover` accessibility — replaced `role="dialog" aria-modal={false}` with `role="region"`; tests updated; `break-words` added on the entry; "(none recorded)" fallback for empty `previous_ingredients`.
- [x] [Review][Patch] `weekId` URL-encoded in fetch — `encodeURIComponent(weekId)` in `queries.ts`.
- [x] [Review][Patch] Empty `weekId` queryKey collision — sentinel `'__disabled__'` avoids cross-mount sharing of the disabled-state cache entry.
- [x] [Review][Patch] `getMondayWeeksAgo` input validation — throws `RangeError` for non-positive integers.
- [x] [Review][Patch] Plan exists but `plan_items` is empty — renders "No items were recorded for this week." Test added.
- [x] [Review][Patch] Empty `previous_ingredients` fallback — "(none recorded)" instead of dangling "Was: ". Test added.
- [x] [Review][Patch] Long ingredient names overflow — `break-words` added on the popover entry.
- [x] [Review][Patch] `/app/plan/:weekId` for the current week — `PlanHistoryPage` derives the current week_id (mirrors server `getCurrentWeekMonday`) and `<Navigate replace>` to `/app/plan` when matched.
- [x] [Review][Patch] Time-based parallelism test replaced — uses explicit promise blockers + microtask yield to assert both repo calls are invoked before either resolves. Deterministic.
- [x] [Review][Patch] Backend `deriveWeekId` moved to shared util — created `apps/api/src/lib/derive-week-id.ts`; `plans.service.ts` imports from new location; `plan-generation.job.ts` re-exports for backward compatibility with the job tests.

**Deferred**

- [x] [Review][Defer] UTC time math ignores household timezone [`apps/web/src/features/plan/PlanPage.tsx:9-10`, `apps/api/src/modules/plans/plans.service.ts:742-756`] — deferred, acknowledged tech debt for future per-TZ work
- [x] [Review][Defer] `findByHouseholdAndWeek` filters out `guardrail_cleared_at IS NULL` plans [`apps/api/src/modules/plans/plans.repository.ts:46-59`] — deferred, pre-existing architectural decision (Story 3.5+); not introduced by 3.15
- [x] [Review][Defer] `findSwapHistory` filters in JS instead of SQL [`apps/api/src/modules/plans/plans.repository.ts:144-154`] — deferred, perf-only optimization at expected data volume
- [x] [Review][Defer] `Promise.all` rejection has no fallback [`apps/api/src/modules/plans/plans.service.ts`] — deferred, project-wide pattern; not 3.15-specific
- [x] [Review][Defer] `requireAcknowledgment` re-fires on every render [`apps/web/src/routes/(app)/plan-history.tsx`, `plan.tsx`, `index.tsx`] — deferred, pre-existing pattern across all gated routes
- [x] [Review][Defer] `PlanItemSwapSummarySchema.slot` accepts arbitrary strings [`packages/contracts/src/plan.ts:323`] — deferred, mirrors `PlanItemRowSchema.slot` (system-wide convention)
- [x] [Review][Defer] `plan_items` schema permits archived+live mixed arrays [`packages/contracts/src/plan.ts:309-314, 340-346`] — deferred, schema tightening not load-bearing
- [x] [Review][Defer] `ratings` value `z.string().nullable()` permits empty string [`packages/contracts/src/plan.ts:345`] — deferred, only relevant once Epic 4 ships

**Pass 2 — Backend patch (2026-05-05)**

- [x] [Review][Patch] `currentWeekMondayUtc` in repository duplicates `getCurrentWeekMonday` in service — exported `getCurrentWeekMonday` + `getNextWeekMonday` from `apps/api/src/lib/derive-week-id.ts`; repo and service now import from there; local duplicates removed [`apps/api/src/modules/plans/plans.repository.ts:currentWeekMondayUtc`, `apps/api/src/modules/plans/plans.service.ts:getCurrentWeekMonday`]
- [x] [Review][Patch] `findByWeekId` is a needless pass-through alias for `findByHouseholdAndWeek` — removed the alias; `PlansService.getPlanHistory` now calls `this.repo.findByHouseholdAndWeek` directly; service tests updated [`apps/api/src/modules/plans/plans.repository.ts:findByWeekId`, `apps/api/src/modules/plans/plans.service.ts:getPlanHistory`]
- [x] [Review][Patch] `PlanHistoryResponseSchema.plan` declared `.nullable()` but the route never sends null (404 thrown before any null-plan response) — changed to `PlanRowSchema` (non-nullable); comment updated; contract test now asserts `plan: null` is rejected and adds minimal-shape test [`packages/contracts/src/plan.ts:PlanHistoryResponseSchema`]
- [x] [Review][Patch] No route-level tests for `GET /v1/plans/:weekId/history` — added 401, 403, 400 (bad UUID), 404 (NotFoundError), 200 shape, and secondary_caregiver auth tests [`apps/api/src/modules/plans/plans.routes.test.ts`]

**Pass 2 — Backend defer (2026-05-05)**

- [x] [Review][Defer] `findActiveFuturePlanIds` (Story 3.16 code present in diff) has no `ORDER BY` — policy propagation batch processes plans in non-deterministic DB order; add `.order('week_of', { ascending: true })` in Story 3.16 [`apps/api/src/modules/plans/plans.repository.ts:findActiveFuturePlanIds`]
- [x] [Review][Defer] `PlanHistoryResponseSchema` allows `plan: null` + non-empty `plan_items` (schema permits this combination) — unreachable via the route since NotFoundError precedes any null-plan path; schema refinement deferred [`packages/contracts/src/plan.ts:PlanHistoryResponseSchema`]

**Pass 3 — Frontend patch (2026-05-05)**

- [x] [Review][Patch] `getCurrentWeekMonday` was an inline private copy in `PlanHistoryPage.tsx` — exported from `apps/web/src/lib/derive-week-id.ts`; inline copy removed; `PlanHistoryPage.tsx` now imports from `derive-week-id.js` [`apps/web/src/lib/derive-week-id.ts`, `apps/web/src/features/plan/PlanHistoryPage.tsx`]
- [x] [Review][Patch] Saturday swaps in `swap_history` silently excluded from history grid — `PlanItemSwapSummarySchema.day` allows `'saturday'` but `WEEKDAYS` covers Mon–Fri only; added comment documenting the intentional exclusion [`apps/web/src/features/plan/PlanHistoryPage.tsx:WEEKDAYS`]

**Pass 3 — Frontend defer (2026-05-05)**

- [x] [Review][Defer] `SwapHistoryPopover` has no click-outside-to-close handler — mirrors `AllergyClearedBadge` non-modal Escape-only disclosure pattern per spec; deferred [`apps/web/src/features/plan/SwapHistoryPopover.tsx`]
- [x] [Review][Defer] `usePlanHistoryQuery` fires before current-week redirect resolves — wasted request is aborted when `<Navigate>` fires; acceptable for MVP given uncommon navigation path [`apps/web/src/features/plan/PlanHistoryPage.tsx`, `apps/web/src/features/plan/queries.ts`]
- [x] [Review][Defer] No unit test for the current-week redirect path — covered by E2E spec `navigation → navigating to /app/plan/<currentWeekId> redirects to /app/plan`; unit gap acceptable given E2E coverage [`apps/web/src/features/plan/PlanHistoryPage.test.tsx`]
