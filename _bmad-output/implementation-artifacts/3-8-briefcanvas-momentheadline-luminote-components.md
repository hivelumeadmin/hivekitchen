# Story 3.8: BriefCanvas + MomentHeadline + LumiNote components

Status: done

> **v2.0 migration applied (γ Phases 3a + 6, May 2026).** `MomentHeadline`
> and `LumiNote` have been **deleted** from the codebase. Their roles are
> now filled by the `PageHeader` primitive (headline + eyebrow + description).
> BriefCanvas was re-laid-out with `max-w-7xl flex-grow px-6 pt-12 pb-24`.
> Story 3.8's data wiring (TanStack Query, `useBriefStateQuery`, brief query
> key, scope assertion, empty-string handling) is **still authoritative**.
> Token snippets below (`text-stone-*`, `bg-white`, etc.) are deprecated —
> see [`../v2-migration-log.md`](../v2-migration-log.md) for the current
> token map.

## Story

As a Primary Parent,
I want the Brief surface to render the Moment + Note + Plan composition on open,
so that I see my week as a finished answer, not a chat prompt or empty state (UX-DR15-17, FR16).

## Acceptance Criteria

1. **Given** Story 3.6 is complete (projection has data),
   **When** I navigate to `/app` (Brief),
   **Then** `<BriefCanvas>` renders `<MomentHeadline>` (Instrument Serif, `<h1>`) + `<LumiNote>` (Inter, terracotta left-border indent) + 5× `<PlanTile>` stub row + `<FreshnessState>`; reads from `useBriefStateQuery()` (TanStack Query, staleWhileRevalidate).

2. **And** cached state served from TanStack Query immediately with background refetch when stale; initial paint ≤1.2s on anchor device (Story 1.13 enforces).

3. **And** `<BriefCanvas>` has a dev-mode runtime assertion that logs a console.error if rendered outside `.app-scope` (i.e., `document.documentElement.classList.contains('app-scope')` is false in `import.meta.env.DEV`).

## Tasks / Subtasks

### Task 1 — Add `brief` query key (AC: #1)

- [x] In `apps/web/src/lib/realtime/query-keys.ts`, add one entry to the `QueryKeys` object:
  ```typescript
  brief: (householdId: string): ['brief', string] => ['brief', householdId],
  ```
  Keep all existing keys unchanged (plan, thread, memory, packer, pantry, presence).

---

### Task 2 — Create `useBriefStateQuery` hook (AC: #1, #2)

- [x] Create `apps/web/src/features/plan/useBriefStateQuery.ts`:

  ```typescript
  import { useQuery } from '@tanstack/react-query';
  import { QueryKeys } from '../../lib/realtime/query-keys.js';
  import { hkFetch } from '../../lib/fetch.js';
  import type { BriefResponse } from '@hivekitchen/types';

  export function useBriefStateQuery(householdId: string | null) {
    return useQuery({
      queryKey: QueryKeys.brief(householdId ?? ''),
      queryFn: ({ signal }) =>
        hkFetch<BriefResponse>(
          `/v1/households/${householdId!}/brief`,
          { method: 'GET', signal },
        ),
      staleTime: 5 * 60_000,  // 5min — SSE-driven invalidation added in Story 5.2
      enabled: householdId !== null,
    });
  }
  ```

  > `enabled: householdId !== null` prevents the query firing before the auth store resolves. `staleTime: 5min` gives the staleWhileRevalidate pattern: cached data renders instantly; background refetch triggered simultaneously when stale.

---

### Task 3 — Create `<MomentHeadline>` (AC: #1)

- [x] Create `apps/web/src/features/plan/MomentHeadline.tsx`:

  ```tsx
  interface MomentHeadlineProps {
    text: string;
  }

  // Instrument Serif 22pt mobile / 26pt desktop, warm-neutral-900.
  // h1 landmark; announced on surface load; never auto-updated without aria-live polite region.
  export function MomentHeadline({ text }: MomentHeadlineProps) {
    if (!text) return <h1 className="sr-only">Weekly plan</h1>;
    return (
      <h1 className="font-serif text-[22px] md:text-[26px] leading-[1.3] text-stone-900 font-normal">
        {text}
      </h1>
    );
  }
  ```

  > **Font:** `font-serif` must map to Instrument Serif in `tailwind.config.ts` (see Dev Notes — Font Verification). **Empty state:** When `text` is empty (Story 3.6 projection stub emits `""`), renders a visually hidden `<h1>` for ARIA landmark integrity. Do NOT render a non-empty placeholder string — empty should be invisible, not misleading. **Typography source:** UX Spec table — "Moment headline: Instrument Serif, 22 (mobile) / 26 (desktop), weight 400, line-height 1.3". `text-stone-900` approximates `warm-neutral-900`; swap for the project's semantic token if one exists.

---

### Task 4 — Create `<LumiNote>` (AC: #1)

- [x] Create `apps/web/src/features/plan/LumiNote.tsx`:

  ```tsx
  interface LumiNoteProps {
    text: string;
  }

  // Inter 16pt mobile / 17pt desktop; terracotta left-border indent (--lumi-terracotta).
  // Returns null when text is empty — Story 3.6 stub emits empty strings.
  export function LumiNote({ text }: LumiNoteProps) {
    if (!text) return null;
    return (
      <p
        className="font-sans text-[16px] md:text-[17px] leading-[1.5] text-stone-800 border-l-4 pl-3"
        style={{ borderColor: 'var(--lumi-terracotta)' }}
      >
        {text}
      </p>
    );
  }
  ```

  > `var(--lumi-terracotta)` is the CSS custom property from the design system (~`#B46A4E`). Verify it exists in `apps/web/src/styles/` before shipping (see Dev Notes — CSS Custom Property). If the Tailwind config exposes a `lumi-terracotta` color token, prefer `border-l-lumi-terracotta` over `style={{ borderColor }}`. Content rules: never more than 2 sentences; never names Lumi in third person; never exclamation marks. These are enforced by the API, not the component — the component just renders.

---

### Task 5 — Create `<FreshnessState>` (AC: #1)

- [x] Create `apps/web/src/features/plan/FreshnessState.tsx`:

  ```tsx
  type FreshnessStatus = 'fresh' | 'stale' | 'failed';

  interface FreshnessStateProps {
    status: FreshnessStatus;
    lastSyncedAt?: string;  // ISO datetime from BriefStateRow.updated_at; shown for 'stale'
  }

  export function FreshnessState({ status, lastSyncedAt }: FreshnessStateProps) {
    if (status === 'fresh') return null;

    const message =
      status === 'failed'
        ? "Lumi couldn't reach the plan right now. Trying again in 30s."
        : lastSyncedAt
          ? `Checking… last synced ${formatRelativeTime(lastSyncedAt)}`
          : 'Checking…';

    return (
      <p className="font-sans text-[13px] text-stone-400 mt-2" role="status" aria-live="polite">
        {message}
      </p>
    );
  }

  function formatRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return 'just now';
  }
  ```

  > FreshnessStatus maps from TanStack Query state in BriefCanvas: `isError` → `'failed'`; `!isError && isStale` → `'stale'`; `!isError && !isStale` → `'fresh'`. Never replaces the surface — annotates it. Pattern rule: `role="status"` with `aria-live="polite"` so screen readers announce status changes without interrupting. Inter 13pt `text-stone-400` ≈ warm-neutral-400.

---

### Task 6 — Create stub `<PlanTile>` (AC: #1; Story 3.9 replaces)

- [x] Create `apps/web/src/features/plan/PlanTile.tsx`:

  ```tsx
  import type { PlanTileSummary } from '@hivekitchen/types';

  interface PlanTileProps {
    summary: PlanTileSummary;
  }

  const DAY_LABELS: Record<PlanTileSummary['day'], string> = {
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
  };

  // Story 3.8 stub — Story 3.9 replaces this with full states/variants/TrustChip/swap affordance.
  export function PlanTile({ summary }: PlanTileProps) {
    const allIngredients = summary.items.flatMap((item) => item.ingredients);

    return (
      <article
        aria-label={DAY_LABELS[summary.day]}
        className="rounded-lg border border-stone-200 bg-white p-4 flex flex-col gap-1"
      >
        <p className="font-sans text-[13px] font-medium text-stone-500 uppercase tracking-wide">
          {DAY_LABELS[summary.day]}
        </p>
        <p className="font-sans text-[15px] font-medium text-stone-800 leading-[1.4]">
          {allIngredients.length > 0
            ? [
                allIngredients.slice(0, 3).join(', '),
                allIngredients.length > 3 ? ` +${allIngredients.length - 3} more` : '',
              ].join('')
            : <span className="text-stone-400 font-normal">Plan pending</span>
          }
        </p>
      </article>
    );
  }
  ```

  > Story 3.9 replaces this file completely with full PlanTile variants (fresh/pending-input/confirmed), allergy-cleared badge, TrustChip, tap-to-swap affordance. **Preserve** the `PlanTileProps` interface shape and `article[aria-label]` element so Story 3.9 is a targeted replacement without touching BriefCanvas. Do NOT implement Story 3.9 features here.

---

### Task 7 — Create `<BriefCanvas>` with scope assertion (AC: #1, #2, #3)

- [x] Create `apps/web/src/features/plan/BriefCanvas.tsx`:

  ```tsx
  import { useEffect } from 'react';
  import { useAuthStore } from '../../stores/auth.store.js';
  import { useBriefStateQuery } from './useBriefStateQuery.js';
  import { MomentHeadline } from './MomentHeadline.js';
  import { LumiNote } from './LumiNote.js';
  import { PlanTile } from './PlanTile.js';
  import { FreshnessState } from './FreshnessState.js';

  export function BriefCanvas() {
    // AC3 — dev-mode scope assertion. AppLayout already calls useScope('app-scope');
    // this is a belt-and-suspenders guard against accidental out-of-scope renders.
    useEffect(() => {
      if (import.meta.env.DEV) {
        if (!document.documentElement.classList.contains('app-scope')) {
          console.error('[BriefCanvas] Scope violation: must only render within .app-scope');
        }
      }
    }, []);

    const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
    const { data, isLoading, isError, isStale } = useBriefStateQuery(householdId);

    const brief = data?.brief ?? null;

    const freshnessStatus = isError ? 'failed' : isStale ? 'stale' : 'fresh';

    // First-load skeleton (no cached data yet)
    if (isLoading && brief === null) {
      return (
        <main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto">
          <div className="animate-pulse flex flex-col gap-4" aria-busy="true" aria-label="Loading plan">
            <div className="h-7 bg-stone-200 rounded w-3/4" />
            <div className="h-4 bg-stone-100 rounded w-full" />
            <div className="h-3 bg-stone-100 rounded w-2/3" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 bg-stone-100 rounded-lg" />
              ))}
            </div>
          </div>
        </main>
      );
    }

    // No brief yet (plan not yet generated by Story 3.7 worker)
    if (!isLoading && brief === null && !isError) {
      return (
        <main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto flex items-center justify-center">
          <p className="font-sans text-[16px] text-stone-500 text-center max-w-sm">
            Lumi is preparing your first plan. Check back Sunday evening.
          </p>
        </main>
      );
    }

    return (
      <main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto flex flex-col gap-4">
        {brief !== null && (
          <>
            <MomentHeadline text={brief.moment_headline} />
            <LumiNote text={brief.lumi_note} />
            <div
              className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2"
              aria-label="Weekly plan"
            >
              {brief.plan_tile_summaries.map((summary) => (
                <PlanTile key={summary.day} summary={summary} />
              ))}
            </div>
            <FreshnessState status={freshnessStatus} lastSyncedAt={brief.updated_at} />
          </>
        )}
        {isError && brief === null && (
          <FreshnessState status="failed" />
        )}
      </main>
    );
  }
  ```

  > Layout: `max-w-2xl mx-auto` centers content; `p-4 md:p-8` provides responsive padding. Tile grid: 2-column on mobile, 5-column on desktop (`md:grid-cols-5`). `<main>` is the ARIA landmark. BriefCanvas does NOT call `useScope('app-scope')` — AppLayout already sets it. The `useEffect` scope check fires once after mount, after the layout hook has set the class. Skeleton uses `animate-pulse` with warm stone tones matching the surface's color palette.

---

### Task 8 — Update `routes/(app)/index.tsx` (AC: #1)

- [x] In `apps/web/src/routes/(app)/index.tsx`:
  1. Add import: `import { BriefCanvas } from '../../features/plan/BriefCanvas.js';`
  2. Change `useLumiContext({ surface: 'general' })` → `useLumiContext({ surface: 'brief' })`
  3. Remove all child-management state and their imports: `formOpen`, `savedChildren`, `pendingBagChild`, `AddChildForm`, `BagCompositionCard`, `ChildResponse` — these were scaffold-only, not a production Brief feature.
  4. Replace the route's return content with `<BriefCanvas />`, keeping the existing compliance gate handling (`useRequireParentalNoticeAcknowledgment`) as-is.

  The final render path should be: gate check → if gate active, return gate UI → otherwise `<BriefCanvas />`. Preserve all existing imports that serve the compliance gate; only remove the child-management imports.

---

### Task 9 — Tests (AC: all)

- [x] Create `apps/web/src/features/plan/useBriefStateQuery.test.ts`:
  - Query is disabled (`fetchStatus: 'idle'`) when `householdId === null`
  - Query key shape is `['brief', householdId]`
  - Calls `hkFetch` with path `/v1/households/${householdId}/brief` and `method: 'GET'`

- [x] Create `apps/web/src/features/plan/MomentHeadline.test.tsx`:
  - Renders an `<h1>` element containing the provided `text`
  - When `text` is empty string, renders an `<h1>` with `class` containing `sr-only` (landmark preserved)
  - `<h1>` is always present in the DOM regardless of text

- [x] Create `apps/web/src/features/plan/LumiNote.test.tsx`:
  - Renders a `<p>` element containing the provided `text`
  - When `text` is empty string, renders nothing (component returns null)
  - Rendered `<p>` has a leading-side border (contains `border-s` or `border-l` class)

- [x] Create `apps/web/src/features/plan/FreshnessState.test.tsx`:
  - `status='fresh'` → renders nothing (null)
  - `status='failed'` → renders the standard error message string
  - `status='stale'` with `lastSyncedAt` → renders text containing "last synced"
  - Visible element has `role="status"`

- [x] Create `apps/web/src/features/plan/BriefCanvas.test.tsx`:
  - Renders skeleton (`aria-busy="true"`) when `isLoading && brief === null`
  - Renders "preparing plan" copy when query returns `{ brief: null }` and not loading
  - Renders `<MomentHeadline>`, `<LumiNote>`, tile grid, `<FreshnessState>` when `data.brief` is populated
  - Renders gracefully (no crash, no empty-string artifacts) when `moment_headline` and `lumi_note` are `""`
  - `plan_tile_summaries` items each render as `<article>` with the day's `aria-label`
  - DEV-only: logs `console.error` when rendered without `.app-scope` on `<html>` (AC #3)

- [x] Run: `pnpm --filter @hivekitchen/web typecheck` — zero new errors
- [x] Run: `pnpm --filter @hivekitchen/web exec vitest run src/features/plan` — all 20 tests pass

---

### Review Findings

- [x] [Review][Patch] FreshnessStatus: change `isStale` to `isFetching && isStale` — fixed; also added `error !== null` check for background refetch failures where TanStack keeps cached data. [BriefCanvas.tsx]
- [x] [Review][Patch] Dynamic grid column count — fixed; `brief.plan_tile_summaries.length <= 5 ? 'md:grid-cols-5' : 'md:grid-cols-6'`. [BriefCanvas.tsx]
- [x] [Review][Patch] Compliance gate early-return — fixed; `AppHomePage` early-returns gate UI when `gate.state !== 'acknowledged'`; BriefCanvas does not mount until gate clears. [routes/(app)/index.tsx]
- [x] [Review][Patch] Non-null assertion `householdId!` in queryFn — fixed; throws `Error('householdId is required')` at top of queryFn. [useBriefStateQuery.ts]
- [x] [Review][Patch] Empty-string queryKey `['brief', '']` when `householdId` is null — fixed; uses `['brief', null]` sentinel. [useBriefStateQuery.ts]
- [x] [Review][Patch] "Trying again in 30s" message — fixed; copy changed to "Lumi couldn't reach the plan right now." [FreshnessState.tsx]
- [x] [Review][Patch] `formatRelativeTime` negative/NaN guard — fixed; `if (diff < 0 || isNaN(diff)) return 'just now'`. [FreshnessState.tsx]
- [x] [Review][Patch] DEV scope-assertion test false positive — fixed; `vi.stubEnv('DEV', true)` added, `vi.unstubAllEnvs()` in afterEach. [BriefCanvas.test.tsx]
- [x] [Review][Patch] `makeBrief` fixture 2 tiles → 5 tiles (Mon–Fri). [BriefCanvas.test.tsx]
- [x] [Review][Patch] Error state test (no cached brief) — added. [BriefCanvas.test.tsx]
- [x] [Review][Patch] Error state test (cached brief + background refetch failure) — added; uses `setQueryData` with backdated `updatedAt` to trigger stale background refetch. [BriefCanvas.test.tsx]
- [x] [Review][Defer] Ingredient overflow "+N more" counts ingredients not meals — potentially misleading UX; deferred, PlanTile is a named stub replaced by Story 3.9. [PlanTile.tsx]
- [x] [Review][Defer] Duplicate React keys if backend sends duplicate days in `plan_tile_summaries` — no Zod uniqueness constraint; deferred, backend data integrity concern. [BriefCanvas.tsx]
- [x] [Review][Defer] `formatRelativeTime` boundary test coverage (0min, 60min, negative diff) — minor utility test gap; deferred. [FreshnessState.test.tsx]
- [x] [Review][Defer] PlanTile `aria-label` redundancy with visible day text (screen reader hears day name twice) — deferred, Story 3.9 owns full PlanTile a11y. [PlanTile.tsx]

---

## Dev Notes

### Critical — Brief can be null; moment_headline/lumi_note will be empty strings

`GET /v1/households/:id/brief` returns `{ brief: BriefStateRow | null }`. `brief` is `null` until Story 3.7 commits a first plan. Once a plan is committed, `brief` is non-null BUT `moment_headline`, `lumi_note`, and `memory_prose` will be empty strings — they are stub values from Story 3.6's projection writer (a future story populates them with real LLM-generated copy). Every component in this story MUST render correctly for both `brief === null` AND empty-string field values. See Task 3 and 4 for the empty-string handling in MomentHeadline and LumiNote respectively.

### Critical — PlanTile is a named stub; Story 3.9 replaces the file

Story 3.8 creates `PlanTile.tsx` showing day name + ingredient preview only. Story 3.9 rewrites it with full states (fresh/pending-input/confirmed), `<AllergyCleared Badge>`, `<TrustChip>`, and L1 disambiguation (Swap/Skip/Replace). Preserve the `PlanTileProps` interface and `article[aria-label]` structure so Story 3.9 is a file-level replacement without touching BriefCanvas. Do NOT pre-build Story 3.9 features.

### Critical — SSE invalidation of brief query is deferred to Story 5.2

`plan.updated` SSE emission is deferred to Story 5.2 (Redis pub/sub fan-out not wired). Do NOT add `brief.updated` to the `InvalidationEvent` discriminated union in `packages/contracts/src/events.ts` and do NOT modify `sse.ts` in this story. TanStack Query `staleTime: 5min` + `refetchOnWindowFocus: true` (default) provides sufficient freshness at MVP scale. Story 5.2 wires the SSE invalidation path.

### Critical — Remove child-management scaffold from AppHomePage

`routes/(app)/index.tsx` currently holds `AddChildForm`, `BagCompositionCard`, and associated state (`formOpen`, `savedChildren`, `pendingBagChild`). These were scaffold-only for early manual testing of Stories 2.10-2.12 — they are not a production Brief feature and must be removed when this story lands. `AddChildForm` and `BagCompositionCard` still exist in `features/children/` for their proper flows; this story just removes the accidental placement on the root `/app` route.

### Architecture — Font verification required before shipping

`font-serif` in Tailwind must map to Instrument Serif. Verify in `apps/web/tailwind.config.ts`:
```typescript
fontFamily: {
  serif: ['Instrument Serif', 'Georgia', 'serif'],
  sans: ['Inter', 'system-ui', 'sans-serif'],
},
```
If `font-serif` maps to the system serif stack, add the entry. Instrument Serif is loaded via Google Fonts or local `@font-face` in `apps/web/src/styles/`. Confirm the font renders visually (not just passes typecheck) before marking AC1 done.

### Architecture — CSS custom property `--lumi-terracotta`

`LumiNote` uses `style={{ borderColor: 'var(--lumi-terracotta)' }}`. Check `apps/web/src/styles/` for this CSS custom property definition. The lumi token group (`lumi-*`) is documented in the design system as ~`#B46A4E` (muted terracotta). If a Tailwind utility class exists (e.g., `border-lumi-terracotta`), prefer that class over the inline style. If neither exists, add the CSS custom property to the root token sheet — do not hardcode `#B46A4E` as a literal.

### Architecture — staleWhileRevalidate pattern (TanStack Query)

AC2 "cached state served instantly with background refetch" is TanStack Query's core `staleTime` behavior: data returned immediately from cache if within staleTime; if stale, data still returned AND background refetch triggered in parallel. Key config in `useBriefStateQuery`:
- `staleTime: 5 * 60_000` — brief considered fresh for 5 minutes
- `refetchOnWindowFocus: true` (TanStack default) — refetch when parent returns to tab
- `gcTime: 5 * 60_000` (from QueryProvider global default) — cache eviction after 5 min inactive

### Architecture — `useLumiContext` surface change

`AppHomePage` currently calls `useLumiContext({ surface: 'general' })`. Task 8 changes this to `useLumiContext({ surface: 'brief' })`. The `SurfaceKind` enum in `packages/contracts` includes `'brief'` — no contract change needed. This ensures `<LumiOrb>` and `<LumiPanel>` (injected by AppLayout) receive the correct context signal when the parent is on the Brief surface.

### Architecture — `<main>` ownership

BriefCanvas renders its own `<main>` element. AppHomePage must NOT wrap `<BriefCanvas />` in another `<main>` or add layout containers around it. The compliance gate renders its own UI before BriefCanvas; those are separate `<div>` / dialog elements, not `<main>`.

### Architecture — FreshnessStatus mapping from TanStack Query

```typescript
const { data, isLoading, isError, isStale } = useBriefStateQuery(householdId);
const freshnessStatus = isError ? 'failed' : isStale ? 'stale' : 'fresh';
```

`isStale` from `useQuery` is true when cached data exists AND `Date.now() > lastFetchedAt + staleTime`. When `isLoading && !data`, render the skeleton (not FreshnessState). When `!isLoading && isError && data !== undefined` (error but cached data available), render the cached brief WITH `status='failed'`. When `!isLoading && isError && data === undefined`, render only `<FreshnessState status="failed" />` (no cached fallback).

### Pattern — Skeleton anatomy

Skeleton must match BriefCanvas structure in dimensions:
- Headline row: ~28px height, 75% width (`w-3/4`)
- Note rows: ~16px height, full width then 2/3 width
- 5 tile placeholders: ~96px height each, in a `grid-cols-2 md:grid-cols-5` grid

Use `bg-stone-200` for headline (slightly more prominent) and `bg-stone-100` for secondary placeholders. These warm stone tones are consistent with the surface's `warm-neutral` palette.

### Project Structure — New and modified files

**New files:**
```
apps/web/src/features/plan/
  BriefCanvas.tsx
  BriefCanvas.test.tsx
  MomentHeadline.tsx
  MomentHeadline.test.tsx
  LumiNote.tsx
  LumiNote.test.tsx
  FreshnessState.tsx
  FreshnessState.test.tsx
  PlanTile.tsx               ← Story 3.8 stub; Story 3.9 replaces this file
  useBriefStateQuery.ts
  useBriefStateQuery.test.ts
```

**Modified files:**
```
apps/web/src/lib/realtime/query-keys.ts    + brief key
apps/web/src/routes/(app)/index.tsx        replace scaffold stub with BriefCanvas
```

**Unchanged:**
- `packages/contracts/src/events.ts` — no new SSE events (Story 5.2)
- `apps/web/src/lib/realtime/sse.ts` — no brief invalidation handler (Story 5.2)
- `apps/api/` — no backend changes (`GET /v1/households/:id/brief` complete from Story 3.6)
- `packages/contracts/src/plan.ts` — `BriefResponseSchema`, `BriefStateRowSchema`, `PlanTileSummary` all exported already

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.8] — Story requirements, AC
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#BriefCanvas] — Component anatomy, states, scope constraint
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Typography] — Type scale table (22/26pt MomentHeadline; 16/17pt LumiNote; 13pt FreshnessState)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Colors] — lumi-terracotta token (~#B46A4E), warm-neutral-900/800/400 token mapping
- [Source: _bmad-output/planning-artifacts/architecture.md#4.1] — React Router v7, frontend routing, TanStack Query ownership
- [Source: _bmad-output/planning-artifacts/architecture.md#1.5] — brief_state projection design, single-row SELECT by household_id
- [Source: packages/contracts/src/plan.ts#BriefResponseSchema] — BriefResponse, BriefStateRow, PlanTileSummary, PlanTileItem shapes
- [Source: apps/web/src/lib/realtime/query-keys.ts] — QueryKeys factory pattern
- [Source: apps/web/src/lib/fetch.ts] — hkFetch, HkApiError, HkFetchInit
- [Source: apps/web/src/stores/auth.store.ts] — householdId via `useAuthStore(s => s.user?.current_household_id)`
- [Source: apps/web/src/stores/lumi.store.ts] — useLumiContext, LumiSurface, 'brief' surface kind
- [Source: apps/web/src/providers/query-provider.tsx] — global queryClient config (staleTime 30s, gcTime 5min)
- [Source: Story 3.7 §Story 3.8 Handoff] — critical empty-string warning for moment_headline/lumi_note/memory_prose
- [Source: Story 3.6 completion notes] — GET /brief returns populated brief_state row; brief is online-required at MVP

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/web typecheck` — passes (no errors).
- `pnpm --filter @hivekitchen/web exec vitest run src/features/plan` — 5 files / 20 tests pass.
- `pnpm --filter @hivekitchen/web test` — 24 files / 165 tests pass (full web suite, no regressions).
- `pnpm --filter @hivekitchen/contracts exec vitest run src/lumi.test.ts` — 44 tests pass (including updated 9-surface drift guard).
- `pnpm --filter @hivekitchen/web lint` — same 11 pre-existing errors and 1 pre-existing warning as `main`; zero new lint errors introduced. Verified via `git stash && lint && git stash pop`.
- `pnpm --filter @hivekitchen/api typecheck` — fails with the same 5 pre-existing errors as `main` (households.routes.test.ts, brief-state.composer.test.ts, plans.service.test.ts, voice.service.test.ts × 3). None caused by this story; verified via `git stash`. Out of scope.

### Completion Notes List

- AC #1 — `<BriefCanvas>` composes `<MomentHeadline>` + `<LumiNote>` + 5× `<PlanTile>` row + `<FreshnessState>`, sources state from `useBriefStateQuery()` (TanStack Query). Hook is wired through the existing `QueryProvider` singleton.
- AC #2 — `useBriefStateQuery` uses `staleTime: 5 * 60_000`. Combined with `refetchOnWindowFocus` (TanStack default) this gives the staleWhileRevalidate pattern: cached payload renders instantly while a background refetch fires when stale. Initial paint cannot be benchmarked from a unit test; the anchor-device perf budget enforced by Story 1.13 covers this AC at the system level.
- AC #3 — Dev-mode runtime assertion in `BriefCanvas` checks `document.documentElement.classList.contains('app-scope')` inside `import.meta.env.DEV` and logs `console.error` on violation. Test asserts the error fires with the AppLayout scope class removed.
- Empty-string handling — Story 3.6 emits `moment_headline === ''` and `lumi_note === ''` from the projection writer. `<MomentHeadline>` falls back to a `sr-only` h1 (landmark preserved); `<LumiNote>` returns `null`. Verified by dedicated tests in both component test files and a `BriefCanvas` integration test.
- `<LumiNote>` border — Tailwind 3.4 logical-property lint rule (`hivekitchen/logical-properties-only`) requires `ps-3` / `border-s-4` rather than `pl-3` / `border-l-4`. Used `border-s-4 border-lumi-terracotta-500` (maps to `var(--lumi-terracotta-500)` = `#b46a4e` via the design-system token preset) — preferred over the inline `style={{ borderColor: 'var(--lumi-terracotta)' }}` shown in the story snippet because the design system exposes a Tailwind token and the story explicitly notes "If the Tailwind config exposes a `lumi-terracotta` color token, prefer the class".
- `<PlanTile>` — Story 3.8 stub. `PlanTileProps` interface and `article[aria-label]` element preserved so Story 3.9 can swap the file without touching `<BriefCanvas>`.
- `routes/(app)/index.tsx` — All child-management scaffold removed (`AddChildForm`, `BagCompositionCard`, `useState`/`useRef`/`useCallback`, `formOpen`/`savedChildren`/`pendingBagChild`, `useComplianceStore`, `ChildResponse`). `useScope('app-scope')` and `useRequireParentalNoticeAcknowledgment` retained per task instructions; surface flipped from `'general'` → `'brief'`. Final render: `<BriefCanvas />` + `{gate.dialog}`.
- `LumiSurfaceSchema` extended with `'brief'` — Story Dev Notes asserted `SurfaceKind` already included `'brief'`, but that referred to the unrelated `presence.SurfaceKind` enum; `LumiSurfaceSchema` (used by `LumiContextSignal` and required for `useLumiContext({ surface: 'brief' })`) did not. Added 'brief' to the enum (one-line addition between 'planning' and 'meal-detail') and updated the drift-guard test from "exact set of 8" → "exact set of 9". The shared contract is consumed unchanged by the API; voice-route surface assertion only special-cases 'onboarding', so 'brief' is allowed by `assertAmbientSurface` without further changes. This is the smallest correct fix for the story-spec error.

### File List

**New (apps/web)**
- apps/web/src/features/plan/BriefCanvas.tsx
- apps/web/src/features/plan/BriefCanvas.test.tsx
- apps/web/src/features/plan/MomentHeadline.tsx
- apps/web/src/features/plan/MomentHeadline.test.tsx
- apps/web/src/features/plan/LumiNote.tsx
- apps/web/src/features/plan/LumiNote.test.tsx
- apps/web/src/features/plan/FreshnessState.tsx
- apps/web/src/features/plan/FreshnessState.test.tsx
- apps/web/src/features/plan/PlanTile.tsx
- apps/web/src/features/plan/useBriefStateQuery.ts
- apps/web/src/features/plan/useBriefStateQuery.test.ts

**Modified**
- apps/web/src/lib/realtime/query-keys.ts (added `brief` key)
- apps/web/src/routes/(app)/index.tsx (replaced child-management scaffold with `<BriefCanvas />`; surface `'general'` → `'brief'`)
- packages/contracts/src/lumi.ts (added `'brief'` to `LumiSurfaceSchema`)
- packages/contracts/src/lumi.test.ts (drift guard updated 8 → 9)
- _bmad-output/implementation-artifacts/sprint-status.yaml (story 3-8 → in-progress → review)
- _bmad-output/implementation-artifacts/3-8-briefcanvas-momentheadline-luminote-components.md (this story file)

## Change Log

| Date       | Author | Change                                                                                                          |
| ---------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| 2026-05-02 | Amelia | Story 3.8 implemented: BriefCanvas + MomentHeadline + LumiNote + FreshnessState + PlanTile stub + useBriefStateQuery hook + brief query key. Replaced child-management scaffold on /app with BriefCanvas. |
| 2026-05-02 | Amelia | Added `'brief'` to `LumiSurfaceSchema` (contracts) — story Dev Notes had conflated it with `presence.SurfaceKind`. Drift-guard test updated 8 → 9 surfaces. |
| 2026-05-02 | Amelia | Status → review.                                                                                                |
