# Story 3.14: Following Week's Draft View

Status: done

## Dev Agent Record

### Implementation Plan

Story 3.14 implemented end-to-end across the contracts → api → web stack with the following deviations from the literal task examples (none break the AC):

- `QueryKeys.plan(weekId)` was already taken by SSE invalidation; added `QueryKeys.planByWeek('current'|'next')` instead so cache keys don't collide.
- The `PlanTile` component's actual prop signature (`{ summary: PlanTileSummary, state, ... }`) differs from the story's example (`day, items, variant`); per the "do NOT touch" directive, the page adapts via a `toPlanTileSummaries(items: PlanItemRow[])` adapter and passes through `summary`. PlanTile's variant is derived from current day vs `summary.day`; cross-week views accept this as a known limitation (story dev note acknowledges this).
- `FreshnessState` doesn't accept a `message` prop; rendered the AC-mandated "Lumi is drafting next week — about 30 seconds" copy as a styled sibling `<p role="status">` in the page (matches FreshnessState's visual treatment).
- Friday 4pm gating uses UTC per the dev note (per-timezone enforcement deferred).

### Completion Notes

- ✅ Contracts: `GetPlansQuerySchema` (default `current`, rejects unknown selectors) + `GetPlansResponseSchema` (plan nullable, plan_items array, is_draft, week_of nullable). 4 new test cases.
- ✅ API: `PlansRepository.findByHouseholdAndWeek` enforces `guardrail_cleared_at IS NOT NULL` and surfaces the unique-constraint violation via `.maybeSingle()` rather than silently picking a winner.
- ✅ API: `PlansService.getPlanForWeek` plus exported `getCurrentWeekMonday()` / `getNextWeekMonday()` UTC helpers. `is_draft` mirrors `(week === 'next')` so the client doesn't recompute.
- ✅ API: `GET /v1/plans?week=current|next` route registered with `authorize(['primary_parent', 'secondary_caregiver'])` and Zod query/response schemas. 6 new route integration tests covering 401/403/400/200 paths.
- ✅ Web: `usePlanQuery(week)` hook with `staleTime: 30_000`. New `PlanPage` with current/next week tabs, Friday-4pm-UTC enable check, FreshnessState fallbacks, and PlanTile rendering. Route `/app/plan` registered behind `useRequireParentalNoticeAcknowledgment` gate.
- ✅ Tests: 11 PlanPage component tests (tabs, time-gating, draft copy), 10 service/repository tests (week math, draft semantics, deterministic week_id), 6 route integration tests. All 245 plan-area tests green.

### Validation

- `pnpm --filter @hivekitchen/contracts typecheck` — clean.
- `pnpm --filter @hivekitchen/api typecheck` — only pre-existing main-branch errors (verified via `git stash` baseline). No new errors from Story 3.14 source files.
- `pnpm --filter @hivekitchen/web typecheck` — clean.
- `pnpm --filter @hivekitchen/contracts exec vitest run src/plan.test.ts` — 127/127.
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans` — 107/107.
- `pnpm --filter @hivekitchen/web exec vitest run src/features/plan/PlanPage` — 11/11.

### File List

**Modified:**
- `packages/contracts/src/plan.ts`
- `packages/contracts/src/plan.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/plans/plans.repository.ts`
- `apps/api/src/modules/plans/plans.service.ts`
- `apps/api/src/modules/plans/plans.service.test.ts`
- `apps/api/src/modules/plans/plans.routes.ts`
- `apps/api/src/modules/plans/plans.routes.test.ts`
- `apps/web/src/lib/realtime/query-keys.ts`
- `apps/web/src/app.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

**New:**
- `apps/web/src/features/plan/PlanPage.tsx`
- `apps/web/src/features/plan/PlanPage.test.tsx`
- `apps/web/src/features/plan/queries.ts`
- `apps/web/src/routes/(app)/plan.tsx`

## Story

As a Primary Parent,
I want to view next week's draft beginning Friday afternoon of the preceding week,
So that I have visibility into Lumi's composition before the Sunday open (FR21).

## Acceptance Criteria

1. **Given** Story 3.7 is complete,
   **When** I navigate to `/app/plan` after Friday 4pm local time of the preceding week,
   **Then** the upcoming-week tab is enabled; `GET /v1/plans?week=next` returns the draft if generated, otherwise `<FreshnessState variant=loading>` "Lumi is drafting next week — about 30 seconds".

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `PlansRepository` — `findByIdForPresentation()`, `findItemsByPlanId()`, `PlanRowSchema`, `PlanItemRowSchema`
- Story 3.6: `BriefStateRepository`, `BriefStateComposer.refresh()`, `GET /v1/households/:id/brief`
- Story 3.7: `planGenerationJobPlugin`, `GENERATE_QUEUE`, `deriveWeekId()`, `buildCommitInput()` — jobs auto-generate next week's plan Fri PM → Sun AM per timezone
- Story 3.8: `<BriefCanvas>`, `<MomentHeadline>`, `<LumiNote>`, `<PlanTile>` (current week)
- Story 3.9: `<PlanTile>` with all state variants — `upcoming` is already defined; `past` and `locked` are too
- Story 3.11: `<FreshnessState>` — `variant=fresh|stale|loading|failed`
- Story 3.13: `PlansRepository.findAllItemsByPlanId()` (history/ops), `PlanRow.week_of` column (VARCHAR(10), ISO date)
- `plans` table: `id, household_id, week_id, week_of, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version`
- `plan_items` table: `id, plan_id, child_id, day, slot, recipe_id, item_id, ingredients, paused_at, replaced_by_plan_id`
- `PLAN_COLUMNS` and `PLAN_ITEM_COLUMNS` constants in `plans.repository.ts` — any new column MUST be added there
- `QueryKeys` in `apps/web/src/lib/realtime/query-keys.ts` — use for TanStack Query
- `hkFetch` in `apps/web/src/lib/fetch.ts` — does NOT auto-parse Zod; guard with `?.`
- `authorize(['primary_parent', 'secondary_caregiver'])` preHandler pattern in `plans.routes.ts`

**Key invariants from previous stories:**
- Presentation layer always reads `WHERE guardrail_cleared_at IS NOT NULL` — partial/draft plans with no clearance are NOT shown
- `briefStateComposer.refresh()` MUST NOT throw — swallows its own errors
- No `framer-motion` — Tailwind animation utilities only
- Logical-property lint rule: use `start-*`/`end-*`, `ps-*`/`pe-*` — no `left-*`/`right-*`/`pl-*`/`pr-*`
- Zustand 5: curried `create<Shape>()(...)` — NOT v4 signature
- `import type` for all type-only imports (isolatedModules)
- No `console.*` — use `request.log` in API, no logging in web components
- No hand-written types — always `z.infer<typeof Schema>` from `@hivekitchen/types`

---

## Tasks / Subtasks

### Task 1 — Contracts: add `GetPlansQuerySchema` + `NextWeekPlanResponseSchema` [x]

In `packages/contracts/src/plan.ts`, add:

```typescript
// GET /v1/plans?week=current|next
export const GetPlansQuerySchema = z.object({
  week: z.enum(['current', 'next']).default('current'),
});

// Response for GET /v1/plans — returns the plan for the requested week.
// null when no plan has been generated yet for the requested week.
export const GetPlansResponseSchema = z.object({
  plan: PlanRowSchema.nullable(),
  plan_items: z.array(PlanItemRowSchema),
  is_draft: z.boolean(), // true when week=next and plan generated but Sunday open not yet reached
  week_of: z.string().date().nullable(), // ISO date of the plan week Monday; null when no plan
});
```

In `packages/types/src/index.ts`, add:
```typescript
export type GetPlansQuery = z.infer<typeof GetPlansQuerySchema>;
export type GetPlansResponse = z.infer<typeof GetPlansResponseSchema>;
```

### Task 2 — PlansRepository: add `findByHouseholdAndWeek()` [x]

In `apps/api/src/modules/plans/plans.repository.ts`, add:

```typescript
// Returns the current (guardrail-cleared) plan for a household for a given week_id,
// or null if not yet generated. For presentation only — enforces guardrail_cleared_at IS NOT NULL.
async findByHouseholdAndWeek(opts: {
  householdId: string;
  weekId: string;
}): Promise<PlanRow | null> {
  const { data, error } = await this.client
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('household_id', opts.householdId)
    .eq('week_id', opts.weekId)
    .not('guardrail_cleared_at', 'is', null)
    .maybeSingle();
  if (error) throw error;
  return data as PlanRow | null;
}
```

### Task 3 — PlansService: add `getPlanForWeek()` [x]

In `apps/api/src/modules/plans/plans.service.ts`, add:

```typescript
import { deriveWeekId } from '../../jobs/plan-generation.job.js';

// Compute the ISO week_of date for next Monday (or the coming Monday if today is Monday).
function getNextWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  // Days until next Monday: if today is Sunday (0), next Monday is in 1 day.
  // If today is Monday (1), next Monday is in 7 days (we want "next", not current).
  const daysUntilNextMon = day === 0 ? 1 : 8 - day;
  const nextMon = new Date(now);
  nextMon.setUTCDate(now.getUTCDate() + daysUntilNextMon);
  return nextMon.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function getCurrentWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1; // Mon=0 offset
  const thisMon = new Date(now);
  thisMon.setUTCDate(now.getUTCDate() - daysBack);
  return thisMon.toISOString().slice(0, 10);
}

async getPlanForWeek(opts: {
  householdId: string;
  week: 'current' | 'next';
}): Promise<{ plan: PlanRow | null; planItems: PlanItemRow[]; isDraft: boolean; weekOf: string | null }> {
  const weekOf = opts.week === 'next' ? getNextWeekMonday() : getCurrentWeekMonday();
  const weekId = deriveWeekId(weekOf);

  const plan = await this.repo.findByHouseholdAndWeek({
    householdId: opts.householdId,
    weekId,
  });

  if (!plan) {
    return { plan: null, planItems: [], isDraft: opts.week === 'next', weekOf };
  }

  const planItems = await this.repo.findItemsByPlanId(plan.id);
  // Draft if the week hasn't started yet (Sunday midnight hasn't passed)
  const isDraft = opts.week === 'next';

  return { plan, planItems, isDraft, weekOf };
}
```

### Task 4 — Route: add `GET /v1/plans` [x]

In `apps/api/src/modules/plans/plans.routes.ts`, add:

```typescript
import {
  GetPlansQuerySchema,
  GetPlansResponseSchema,
} from '@hivekitchen/contracts';
import type { GetPlansQuery } from '@hivekitchen/types';

// GET /v1/plans?week=current|next
// Returns the plan for the requested week (current or next draft).
// Returns { plan: null, plan_items: [], is_draft: true, week_of: null } when not yet generated.
fastify.get(
  '/v1/plans',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      querystring: GetPlansQuerySchema,
      response: { 200: GetPlansResponseSchema },
    },
  },
  async (request, reply) => {
    const { week } = request.query as GetPlansQuery;
    const { plan, planItems, isDraft, weekOf } = await fastify.plansService.getPlanForWeek({
      householdId: request.user.household_id,
      week,
    });
    return reply.send({
      plan: plan ?? null,
      plan_items: planItems,
      is_draft: isDraft,
      week_of: weekOf,
    });
  },
);
```

### Task 5 — Frontend: add `usePlanQuery()` hook [x]

In `apps/web/src/features/plan/queries.ts`, add:

```typescript
import type { GetPlansResponse } from '@hivekitchen/types';
import { useQuery } from '@tanstack/react-query';
import { hkFetch } from '../../lib/fetch.js';
import { QueryKeys } from '../../lib/realtime/query-keys.ts';

// Fetches the plan for the given week ('current' | 'next').
// Returns null plan + is_draft=true when Lumi hasn't generated the draft yet.
export function usePlanQuery(week: 'current' | 'next') {
  return useQuery<GetPlansResponse>({
    queryKey: QueryKeys.plan(week),
    queryFn: () => hkFetch(`/v1/plans?week=${week}`),
    staleTime: 30_000,
  });
}
```

Add `QueryKeys.plan` to `apps/web/src/lib/realtime/query-keys.ts`:
```typescript
plan: (week: 'current' | 'next') => ['plan', week] as const,
```

### Task 6 — Frontend: add `/app/plan` page with week tabs [x]

Create `apps/web/src/features/plan/PlanPage.tsx`:

```typescript
import { useState } from 'react';
import { usePlanQuery } from './queries.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanTile } from './PlanTile.js';

// Friday 4pm UTC as the cutoff for enabling the "Next Week" tab.
// Per FR21: next week's draft view is available beginning Friday afternoon.
function isNextWeekDraftAvailable(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 5 = Friday
  const hour = now.getUTCHours();
  // Saturday (6) or Sunday (0) always available; Friday after 16:00 UTC available.
  return day === 6 || day === 0 || (day === 5 && hour >= 16);
}

export function PlanPage() {
  const [activeWeek, setActiveWeek] = useState<'current' | 'next'>('current');
  const nextAvailable = isNextWeekDraftAvailable();

  const { data, isLoading, isError } = usePlanQuery(activeWeek);

  return (
    <div className="app-scope flex flex-col gap-6 px-4 py-6 max-w-2xl mx-auto">
      {/* Week tab selector */}
      <div className="flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeWeek === 'current'}
          onClick={() => setActiveWeek('current')}
          className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none
            aria-selected:bg-stone-800 aria-selected:text-white
            aria-not-selected:text-stone-500 aria-not-selected:hover:text-stone-700
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          This week
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeWeek === 'next'}
          disabled={!nextAvailable}
          onClick={() => { if (nextAvailable) setActiveWeek('next'); }}
          className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none
            aria-selected:bg-stone-800 aria-selected:text-white
            aria-not-selected:text-stone-500 aria-not-selected:enabled:hover:text-stone-700
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          Next week
        </button>
      </div>

      {/* Content area */}
      {isLoading && <FreshnessState variant="loading" />}
      {isError && <FreshnessState variant="failed" />}
      {!isLoading && !isError && data && (
        <>
          {data.plan === null ? (
            <FreshnessState
              variant="loading"
              message="Lumi is drafting next week — about 30 seconds"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const).map((day) => {
                const dayItems = data.plan_items.filter((item) => item.day === day);
                return (
                  <PlanTile
                    key={day}
                    day={day}
                    items={dayItems}
                    variant={data.is_draft ? 'upcoming' : 'today'}
                    planId={data.plan!.id}
                  />
                );
              })}
              {data.is_draft && (
                <p className="font-sans text-[13px] text-stone-400 text-center mt-2">
                  This is a draft — Lumi may refine it before Monday.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

**Note:** The `FreshnessState` component takes a `message` prop if it exists; otherwise check the 3-11 implementation to see the exact prop API and adjust accordingly. Check `apps/web/src/features/plan/FreshnessState.tsx` before using the `message` prop.

### Task 7 — Register `/app/plan` route in web app router [x]

In `apps/web/src/app/` (wherever routes are declared), add the `/app/plan` route pointing to `PlanPage`. Check the existing router setup (likely `apps/web/src/app/router.tsx` or similar) and follow the existing pattern.

### Task 8 — Update `QueryKeys` in `query-keys.ts` [x]

Verify `QueryKeys.plan(week)` is not already defined. If a different key exists for plan data, use the existing one to avoid cache duplication.

### Task 9 — Contract + type tests [x]

In `packages/contracts/src/plan.test.ts`, add:
- `GetPlansQuerySchema` parses `{ week: 'current' }` and `{ week: 'next' }`
- `GetPlansQuerySchema` defaults `week` to `'current'` when omitted
- `GetPlansQuerySchema` rejects `{ week: 'previous' }`
- `GetPlansResponseSchema` accepts `plan: null, plan_items: [], is_draft: true, week_of: null`
- `GetPlansResponseSchema` accepts `plan: <PlanRow>, plan_items: [...], is_draft: false, week_of: '2026-05-04'`

### Task 10 — API service test [x]

In `apps/api/src/modules/plans/plans.service.test.ts`, add:
- `getPlanForWeek({ week: 'current' })` — returns null plan when repository returns null
- `getPlanForWeek({ week: 'next' })` — returns `isDraft: true` regardless of plan existence
- `getPlanForWeek({ week: 'current' })` — returns plan + items when repository returns a plan
- Week ID derivation: verify `deriveWeekId(getNextWeekMonday())` produces a stable UUID

### Task 11 — Typecheck and tests [x]

- `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test`
- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans`
- `pnpm --filter @hivekitchen/web typecheck`

---

## Dev Notes

### Why `is_draft: boolean` in response?

The "draft" designation purely means the week hasn't started. The plan data is the same — the difference is how the frontend labels it ("draft" copy, no interactivity restrictions beyond `upcoming` variant). Including it in the API response avoids the client computing date math.

### Friday 4pm local vs UTC

The acceptance criteria says "Friday 4pm local time of the preceding week." The tab availability check in `PlanPage.tsx` uses UTC for simplicity (Task 6). If the product requires per-timezone enforcement (e.g., a household in Tokyo should see the tab at 4pm JST, not 4pm UTC), this logic must be moved server-side — the API would need to accept the household's timezone and return `{ next_week_available_at: <ISO datetime> }`. For MVP, UTC is acceptable and consistent with how `plan-generation.job.ts` schedules jobs.

### `deriveWeekId` coupling

`getNextWeekMonday()` and `getCurrentWeekMonday()` in the service must produce the same date string that `planGenerationJobPlugin` uses when it computes `week_of` before calling `buildCommitInput()`. Verify that `buildCommitInput()` in `plan-generation.job.ts` uses the same Monday-as-week-start convention. If the job uses a different week start (e.g., Sunday), the `weekId` will never match and `findByHouseholdAndWeek()` will always return null.

### No guardrail-bypass for draft view

Even for next week's draft, only guardrail-cleared plans are returned. A plan in mid-generation (no `guardrail_cleared_at`) will show as "Lumi is drafting next week" — this is intentional per the presentation-bind contract.

### `<FreshnessState>` `message` prop

Check the 3-11 story or the actual component file at `apps/web/src/features/plan/FreshnessState.tsx` to see if a `message` override prop is supported. If not, render the string as a sibling element rather than forcing the prop.

### Draft interactivity

The `upcoming` variant of `<PlanTile>` (from Story 3.9) is already non-interactive in terms of certain actions. For draft plans shown on Friday/Saturday/Sunday, the full swap/pause/regen affordances should be available (parents can start adjusting the draft). Confirm this behavior matches the PlanTile's `upcoming` variant definition.

---

## Project Structure

**New files:**
```
apps/web/src/features/plan/PlanPage.tsx
apps/web/src/features/plan/PlanPage.test.tsx
```

**Modified files:**
```
packages/contracts/src/plan.ts                         + GetPlansQuerySchema, GetPlansResponseSchema
packages/contracts/src/plan.test.ts                    + new schema tests
packages/types/src/index.ts                            + GetPlansQuery, GetPlansResponse
apps/api/src/modules/plans/plans.repository.ts         + findByHouseholdAndWeek()
apps/api/src/modules/plans/plans.service.ts            + getPlanForWeek(), getNextWeekMonday(), getCurrentWeekMonday()
apps/api/src/modules/plans/plans.service.test.ts       + getPlanForWeek tests
apps/api/src/modules/plans/plans.routes.ts             + GET /v1/plans route
apps/web/src/features/plan/queries.ts                  + usePlanQuery()
apps/web/src/lib/realtime/query-keys.ts               + QueryKeys.plan
apps/web/src/app/router.tsx (or equivalent)            + /app/plan route
_bmad-output/implementation-artifacts/sprint-status.yaml  3-14 → ready-for-dev
```

**Do NOT touch:**
```
apps/api/src/modules/plans/plans.repository.ts  (findByIdForPresentation — no changes)
apps/web/src/features/plan/FreshnessState.tsx   (3.11 — use as-is)
apps/web/src/features/plan/PlanTile.tsx         (3.9 — use as-is)
apps/web/src/features/plan/BriefCanvas.tsx      (3.8 — separate surface)
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.14 created — ready-for-dev. |
| 2026-05-05 | Amelia | Story 3.14 implemented — contracts/api/web complete; 245 plan-area tests green; status → review. |
| 2026-05-05 | Review | Code review complete — 3 patches, 3 deferred, 5 dismissed. |

---

## Review Findings

### Patches

- [x] [Review][Patch] `activeWeek` stays `'next'` after tab is disabled at Monday UTC transition — fixed: added useEffect to reset `activeWeek` to `'current'` when `nextAvailable` flips false; added regression test [`apps/web/src/features/plan/PlanPage.tsx`]
- [x] [Review][Patch] `GetPlansResponseSchema.week_of` declared `.nullable()` but service never returns null — fixed: removed `.nullable()`, updated contract tests to use valid date string instead of null [`packages/contracts/src/plan.ts`]
- [x] [Review][Patch] `PlanPage` renders `<main>` which may create a duplicate landmark inside `AppLayout` — dismissed after verification: all app routes use `<main>` as the page landmark; `AppLayout` renders no `<main>` of its own

### Deferred

- [x] [Review][Defer] `toPlanTileSummaries` silently drops Saturday items if `PlanItemRowSchema.day` includes `'saturday'` [`apps/web/src/features/plan/PlanPage.tsx:22-44`] — deferred, school-lunch domain is Mon–Fri; schema change is out of scope
- [x] [Review][Defer] `gate.requireAcknowledgment(() => {})` passes an empty callback — post-acknowledgment action is silently dropped, relies entirely on hook's internal state update [`apps/web/src/routes/(app)/plan.tsx:13`] — deferred, mirrors existing pattern from other app routes
- [x] [Review][Defer] `gate.dialog` rendered in both branches of `PlanRoute` — may double-mount if dialog is non-null when acknowledged [`apps/web/src/routes/(app)/plan.tsx:17-26`] — deferred, standard React portal pattern; pre-existing across app routes
