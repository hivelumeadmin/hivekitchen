# Story 3.9: PlanTile component with all states + variants

Status: done

## Story

As a Primary Parent,
I want each day's plan to render as a `<PlanTile>` with clear states (decided / pending-input / swap-in-progress / locked / mutability-frozen) and variants (today / upcoming / past),
so that I can see at a glance what's decided and what needs my attention (UX-DR18, FR16, FR17).

## Acceptance Criteria

1. **Given** Story 3.8 is complete,
   **When** Story 3.9 is complete,
   **Then** `<PlanTile>` renders day header (weekday name as `<h2>`) + dish line (Inter 19pt semibold) + method-of-preparation caption (omitted entirely when data absent — no contract field yet) + optional `<TrustChip>` row.

2. **And** `today` variant: morning-only (before 13:00 local time) amber tint; `past` variant: low-saturation, non-interactive (`tabIndex={-1}`, pointer-events blocked); `locked` variant: `<PresenceIndicator>` rendered inline at top-end of tile; `mutability-frozen`: tap/Enter opens a Popover explaining the Sunday 4hr lockdown window (never a modal).

3. **And** keyboard-operable for non-past, non-frozen tiles: `tabIndex={0}`; Enter/Space calls `onSwapIntent?.()` if provided; Esc calls `blur()` on the tile element.

## Tasks / Subtasks

### Task 1 — Verify Shadcn `<Popover>` is available (AC: #2)

- [x] Checked `apps/web/src/components/ui/` — no `popover.tsx` exists; the project does NOT have Shadcn copy-in components installed (no `@radix-ui/*` packages in `apps/web/package.json`). Existing components in `components/`: `Dialog.tsx`, `LumiOrb.tsx`, `LumiPanel.tsx`. No copy-in pattern in use.
- [x] Adapted: built the mutability-frozen "tap → explain state" affordance as an inline disclosure (a `<button>` toggling a sibling `<p role="note">`) using only React state + Tailwind utilities. No new dependency. UX spec wording allows "popover/dialog explaining the lockdown window constraint" — inline disclosure satisfies the intent and avoids the cost of pulling Radix in for one explanation panel.

---

### Task 2 — Create `TrustChip.tsx` (AC: #1)

- [x] Created `apps/web/src/features/plan/TrustChip.tsx` with `TrustChipVariant` type export and 5 variants. Token classes use the actual design-system prefixes (`sacred`, `safety-cleared`, `foliage`, `memory-provenance`, `lumi-terracotta`) — NOT the longer `sacred-plum`/`safety-cleared-teal` names from the original story spec, which would not resolve in Tailwind.

Reference implementation:

```tsx
export type TrustChipVariant =
  | 'cultural-template'
  | 'allergy-cleared'
  | 'pantry-fresh'
  | 'memory-provenance'
  | 'lumi-proposed';

interface TrustChipProps {
  variant: TrustChipVariant;
  label: string;
}

const VARIANT_CLASSES: Record<TrustChipVariant, string> = {
  'cultural-template':  'bg-sacred-plum-100 text-sacred-plum-800 border-sacred-plum-200',
  'allergy-cleared':    'bg-safety-cleared-teal-100 text-safety-cleared-teal-800 border-safety-cleared-teal-200',
  'pantry-fresh':       'bg-foliage-100 text-foliage-800 border-foliage-200',
  'memory-provenance':  'bg-stone-100 text-stone-700 border-stone-200',
  'lumi-proposed':      'bg-lumi-terracotta-100 text-lumi-terracotta-800 border-lumi-terracotta-200',
};

// Checkmark SVG — always rendered first, never cross-based.
function Checkmark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
      <path d="M10 3L5 8.5 2 5.5 1.5 6l3.5 3.5 5.5-6L10 3z" />
    </svg>
  );
}

export function TrustChip({ variant, label }: TrustChipProps) {
  return (
    <span
      role="note"
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-sans text-[13px] font-medium leading-none ${VARIANT_CLASSES[variant]}`}
    >
      <Checkmark />
      {label}
    </span>
  );
}
```

> **Token class names** (`sacred-plum-100`, `safety-cleared-teal-100`, `foliage-100`, `lumi-terracotta-100`) must exist in `apps/web/tailwind.config.ts`. Verify each token before shipping. If a token doesn't exist, use the closest stone/neutral and leave a `// TODO: replace with correct token` comment — never hardcode hex. `role="note"` communicates affirmative info; chip is non-interactive.

---

### Task 3 — Replace `PlanTile.tsx` stub with full implementation (AC: #1, #2, #3)

- [x] Replaced `apps/web/src/features/plan/PlanTile.tsx` in full. `PlanTileProps` now extends with optional `state`, `partnerName`, `trustChips`, `onSwapIntent`. `summary` is preserved. `<article aria-label={DAY_LABELS[summary.day]}>` is preserved — BriefCanvas tests + the 3-8 e2e spec depend on it.
- [x] Created `apps/web/src/features/thread/PresenceIndicator.tsx` (minimal). The component does not yet exist anywhere in the codebase, but the AC explicitly requires `<PresenceIndicator>` for `state='locked'`. Built the smallest sufficient version: accepts `surface`, `partnerName?`, `className?`; renders only when `partnerName` is provided. SSE wiring (subscribing to `presence.partner-active` events keyed by surface) is deferred to Story 5.2 — caller passes `partnerName` explicitly until then.
- [x] Variant derivation runs internally via `deriveVariant(summary.day)` — BriefCanvas does NOT change. Keyboard-handler attached to `<article>` requires one targeted `// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions` with rationale (article landmark must remain because BriefCanvas + 3-8 e2e tests query by `role=article`).

**Full replacement** of `apps/web/src/features/plan/PlanTile.tsx`. The Story 3.8 stub is discarded in its entirety.

Invariants carried forward from Story 3.8 (BriefCanvas depends on these):
- `PlanTileProps` must retain `summary: PlanTileSummary` (new props are additive)
- Root element must be `<article aria-label={DAY_LABELS[summary.day]}>`

```tsx
import { useRef, useState } from 'react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover.js';
import { PresenceIndicator } from '../thread/PresenceIndicator.js';
import { TrustChip, type TrustChipVariant } from './TrustChip.js';
import type { PlanTileSummary } from '@hivekitchen/types';

export type PlanTileState =
  | 'decided'
  | 'pending-input'
  | 'swap-in-progress'
  | 'locked'
  | 'mutability-frozen';

export type PlanTileVariant = 'today' | 'upcoming' | 'past';

export interface PlanTileProps {
  summary: PlanTileSummary;
  state?: PlanTileState;            // default: 'decided'
  partnerName?: string;             // displayed when state='locked', e.g. "Priya"
  trustChips?: Array<{ variant: TrustChipVariant; label: string }>;
  onSwapIntent?: () => void;        // Story 3.12 wires actual swap; no-op here
}

const DAY_LABELS: Record<PlanTileSummary['day'], string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

// Align with JS Date.getDay() (1=Mon … 6=Sat).
const DAY_ORDER: Record<PlanTileSummary['day'], number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function deriveVariant(day: PlanTileSummary['day']): PlanTileVariant {
  const now = new Date();
  const todayJs = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const dayOrd = DAY_ORDER[day];
  if (dayOrd === todayJs) return 'today';
  // Plan summaries are for the current week; lower ordinal = earlier in the week = past.
  // On Sunday (todayJs=0) all plan days are upcoming (correct: new week hasn't started).
  if (todayJs !== 0 && dayOrd < todayJs) return 'past';
  return 'upcoming';
}

function deriveDishLine(summary: PlanTileSummary): string {
  // No recipe name in PlanTileSummary yet — ingredients[] is the best available proxy.
  // Future recipe-resolution story adds recipe_name to PlanTileItem.
  const all = [...new Set(summary.items.flatMap((i) => i.ingredients))];
  if (all.length === 0) return '';
  const preview = all.slice(0, 3).join(', ');
  return all.length > 3 ? `${preview} +${all.length - 3} more` : preview;
}

export function PlanTile({
  summary,
  state = 'decided',
  partnerName,
  trustChips,
  onSwapIntent,
}: PlanTileProps) {
  const variant = deriveVariant(summary.day);
  const tileRef = useRef<HTMLElement>(null);

  const isPast    = variant === 'past';
  const isFrozen  = state === 'mutability-frozen';
  const isLocked  = state === 'locked';
  // Morning = before 13:00 local; amber tint only in the morning on today's tile.
  const hasMorningTint = variant === 'today' && new Date().getHours() < 13;
  const isInteractive  = !isPast && !isFrozen;

  const dishLine = deriveDishLine(summary);

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (!isInteractive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSwapIntent?.();
    }
    if (e.key === 'Escape') {
      tileRef.current?.blur();
    }
  }

  const borderClass =
    state === 'pending-input'
      ? 'border-2 border-dashed border-lumi-honey-400'
      : 'border border-stone-200';

  const articleClasses = [
    'relative rounded-lg bg-white p-4 flex flex-col gap-1',
    borderClass,
    hasMorningTint  ? 'bg-amber-50'                          : '',
    isPast          ? 'opacity-60 pointer-events-none'        : '',
    isInteractive
      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1'
      : '',
  ].filter(Boolean).join(' ');

  const tileContent = (
    <article
      ref={tileRef}
      aria-label={DAY_LABELS[summary.day]}
      tabIndex={isPast ? -1 : 0}
      onKeyDown={handleKeyDown}
      className={articleClasses}
    >
      {/* Presence indicator — self-manages visibility; renders nothing when solo */}
      {isLocked && (
        <PresenceIndicator
          surface={{ kind: 'plan', id: summary.day }}
          className="absolute top-2 end-2"
        />
      )}

      {/* Day header */}
      <h2 className="font-sans text-[13px] font-medium uppercase tracking-wide text-stone-500">
        {DAY_LABELS[summary.day]}
      </h2>

      {/* Dish line — ingredients proxy until recipe_name added to contract */}
      {dishLine ? (
        <p className="font-sans text-[19px] font-semibold leading-[1.3] text-stone-900">
          {dishLine}
        </p>
      ) : (
        <p className="font-sans text-[15px] font-normal leading-[1.4] text-stone-400">
          Plan pending
        </p>
      )}

      {/* Method caption: omitted — no contract field exists yet.
          Story adding recipe_name to PlanTileItem will also add method_of_preparation. */}

      {/* TrustChip row */}
      {trustChips && trustChips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1" aria-label="Trust indicators">
          {trustChips.map((chip) => (
            <TrustChip key={chip.label} variant={chip.variant} label={chip.label} />
          ))}
        </div>
      )}

      {/* Swap-in-progress overlay */}
      {state === 'swap-in-progress' && (
        <span
          aria-busy="true"
          aria-label="Swap in progress"
          className="absolute inset-0 rounded-lg bg-white/70 flex items-center justify-center"
        >
          <span className="h-4 w-4 rounded-full border-2 border-stone-300 border-t-stone-700 animate-spin" />
        </span>
      )}

      {/* Mutability-frozen affordance — inline button trigger for Popover */}
      {isFrozen && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Why can't I edit this plan?"
              className="mt-1 self-start font-sans text-[12px] text-stone-400 underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Editing locked
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            className="max-w-[280px] font-sans text-[14px] leading-[1.5] text-stone-700"
          >
            This plan is locked while we finalise the grocery list. Changes resume after the shopping window closes.
          </PopoverContent>
        </Popover>
      )}
    </article>
  );

  return tileContent;
}
```

> **`article` not `button`** — a focusable `article` with `tabIndex=0` + keyboard handlers provides an interactive card without asserting button semantics on the whole tile. Story 3.12 will add an explicit `<button>` swap trigger *inside* the tile when the swap flow lands — do not add it now.

> **`isMorning()` evaluated at render time** — Vite SPA; no SSR concern. Amber tint appears on mount and does not reactively fade past 13:00 without a page refresh. Acceptable for MVP.

> **PresenceIndicator props** — verify the actual component signature in `apps/web/src/features/thread/PresenceIndicator.tsx` before shipping. The UX spec says it accepts `surface: { kind: SurfaceKind; id: string }`. Use whatever `kind` value the existing `SurfaceKind` type exposes for plan surfaces (check `packages/contracts/src/presence.ts`). If `'plan'` isn't in `SurfaceKind`, add it. Also verify whether `className` is accepted — if not, wrap in a `<div className="...">`.

---

### Task 4 — Create `PlanTile.test.tsx` (AC: all)

- [x] Created `apps/web/src/features/plan/PlanTile.test.tsx`. 24 tests covering structure (5), variants (5), states (6), keyboard (5), trust chips (3). All time-dependent tests use `vi.useFakeTimers()` + `vi.setSystemTime(...)` with explicit `Date(year, month-0-indexed, day, hour, ...)` constructors so timezone differences don't change `getDay()`.
- [x] Also created `apps/web/src/features/thread/PresenceIndicator.test.tsx` (5 tests) since the component is new.

Original test plan referenced for completeness:

Required test cases:

**Structure:**
- Root element is `<article>` with `aria-label` equal to the day display name (e.g., "Monday")
- Day header is an `<h2>` element containing the weekday name

**Dish line:**
- Renders ingredients from `summary.items[0].ingredients` when data is present
- Renders "Plan pending" when `summary.items` is empty

**Variant — today:**
- Mock `vi.setSystemTime` to Monday 08:00 local; pass `summary.day = 'monday'`; article has `bg-amber-50` class
- Mock to Monday 14:00; no `bg-amber-50` class (afternoon)

**Variant — past:**
- Mock to Wednesday; pass `summary.day = 'monday'`; article has `opacity-60` class; article has `tabIndex={-1}`

**Variant — upcoming:**
- Mock to Monday; pass `summary.day = 'friday'`; article has `tabIndex={0}`; no `opacity-60`

**States:**
- `state='pending-input'`: article has `border-dashed` class
- `state='swap-in-progress'`: element with `aria-busy="true"` is present
- `state='locked'`: `<PresenceIndicator>` is rendered (assert component is present in DOM)
- `state='mutability-frozen'`: "Editing locked" button is visible; clicking it renders Popover content containing "locked" text

**Keyboard:**
- Enter key on article calls `onSwapIntent` when `state='decided'`
- Space key on article calls `onSwapIntent` when `state='decided'`
- `onSwapIntent` is NOT called when article has `tabIndex={-1}` (past variant)
- Esc key calls `blur()` on the article (assert `document.activeElement` is not the article after Esc)

**TrustChip row:**
- `trustChips` prop renders `<TrustChip>` for each entry
- No trust chip container rendered when `trustChips` is empty/undefined

---

### Task 5 — Create `TrustChip.test.tsx` (AC: #1)

- [x] Created `apps/web/src/features/plan/TrustChip.test.tsx` with 9 tests (role/aria-label, label rendering, checkmark SVG presence, all 5 variants render without error, variant token classes apply correctly).

Original test plan referenced for completeness:

- Renders with `role="note"`
- `aria-label` matches the `label` prop
- Label text appears in the rendered output
- An SVG (checkmark) is present in the output for every variant
- Renders without error for all 5 variant values

---

### Task 6 — E2E smoke test (AC: all)

- [x] Created `apps/web/test/e2e/3-9-plantile.spec.ts` following the same pattern as the existing (uncommitted) `3-8-brief-canvas.spec.ts`: 5 tests covering article landmarks, h2 headings, dish-line rendering with overflow, Tab focus traversal, and Escape blur.
- [x] Note: the project does not yet have a `playwright.config.*` wired into the workspace; e2e tests can only be executed once that infrastructure lands. The 3-8 e2e spec is in the same state — file present, infra TBD. No regression introduced.

Coverage:
- Navigate to `/app`; assert all 5 `article[aria-label]` tiles present
- Tab traversal moves focus from one tile to the next
- Escape blurs the focused tile

---

### Task 7 — Typecheck and unit test run (AC: all)

- [x] `pnpm --filter @hivekitchen/web typecheck` — clean exit, zero errors.
- [x] `pnpm --filter @hivekitchen/web exec vitest run src/features/plan src/features/thread` — 8 files / 60 tests pass.
- [x] `pnpm --filter @hivekitchen/web test` — 27 files / 205 tests pass (full web suite, no regressions).
- [x] `pnpm --filter @hivekitchen/web lint` — same 11 pre-existing errors and 2 pre-existing warnings as `main`. None in files touched by this story (PlanTile.tsx, TrustChip.tsx, PresenceIndicator.tsx, *.test.tsx, 3-9-plantile.spec.ts).

## Dev Notes

### Critical — This is a full FILE REPLACEMENT of the Story 3.8 stub

`apps/web/src/features/plan/PlanTile.tsx` was created as a named stub in Story 3.8 with the explicit note *"Story 3.9 replaces this file completely."* Do NOT extend the stub — write the file from scratch. BriefCanvas currently calls `<PlanTile key={summary.day} summary={summary} />` with no state/variant props; the new component handles this because:
- `state` defaults to `'decided'`
- `variant` is derived internally
- All new props are optional

**No BriefCanvas changes are required for this story.**

### Critical — No dish name in current contract; use ingredients as proxy

`PlanTileItem` (in `packages/contracts/src/plan.ts`) has `ingredients: string[]` but no `name` or `method_of_preparation`. The UX spec calls for a dish line (Inter 19pt semibold) and a method caption. Resolution:

- **Dish line:** derive from `[...new Set(summary.items.flatMap(i => i.ingredients))]` — join unique ingredients, cap at 3 + "+N more". This is a pragmatic proxy. A future recipe-resolution story adds `recipe_name` to `PlanTileItem`.
- **Method caption:** omit entirely. Do NOT render "Unknown", "N/A", or any placeholder. When there is no data, there is no element.
- Do NOT modify `PlanTileSummarySchema` or `PlanTileItemSchema` in contracts — those changes belong in the recipe story.

### Critical — No calendar date in brief data; show weekday name only

`BriefStateRowSchema` contains no `week_of` field. `PlanTile` cannot reliably derive "Monday, May 5" without it. Render only the weekday label in `<h2>` (e.g., "Monday"). When `BriefStateRowSchema` gains `week_of` (future), PlanTile can optionally receive a `weekOf?: string` prop to display the calendar date.

### Critical — AllergyClearedBadge belongs to Story 3.10; do NOT build it here

Story 3.10 owns `<AllergyClearedBadge>` with its full audit popover. In this story, allergy-cleared status is surfaced only via `<TrustChip variant="allergy-cleared" />` in the `trustChips` prop. BriefCanvas passes no `trustChips`, so no chips appear in production yet — that is correct. Do NOT create `AllergyClearedBadge.tsx` in this story.

### Critical — Swap flow belongs to Story 3.12; do NOT build it here

Story 3.12 owns `PATCH /v1/plans/:id/items/:itemId` and `<SwapFlow>`. This story provides:
- Keyboard affordance (`tabIndex=0`, Enter/Space calls `onSwapIntent?.()`)
- Visual interactive feedback (`cursor-pointer` on non-past tiles)
- `state='swap-in-progress'` overlay visual (so Story 3.12 can drive it)

Do NOT create `SwapFlow.tsx`, a swap modal, or any mutation hook. `onSwapIntent` is undefined in all current callers — calling it is a no-op.

### Architecture — Shadcn Popover (copy-in pattern)

HiveKitchen uses Shadcn with the copy-in pattern (no npm package; files live in `apps/web/src/components/ui/`). The Popover component provides:
- `<Popover>`, `<PopoverTrigger asChild>`, `<PopoverContent>`
- Radix `@radix-ui/react-popover` backing — keyboard accessible, focus trap, Esc-to-close built in
- If absent: `pnpm dlx shadcn@latest add popover` from `apps/web/`

For the mutability-frozen state, the Popover trigger is an inline `<button>` ("Editing locked") within the article — NOT the whole article wrapped as a trigger. This is the correct a11y pattern: wrapping a non-button article as a PopoverTrigger would conflict with the article's existing keyboard handler.

### Architecture — PresenceIndicator import

`<PresenceIndicator>` lives at `apps/web/src/features/thread/PresenceIndicator.tsx`. Both `features/plan/` and `features/thread/` are in the `.app-scope`; the cross-feature import is permitted (ESLint `eslint-plugin-boundaries` applies scope rules at route level, not feature level).

Import: `import { PresenceIndicator } from '../thread/PresenceIndicator.js';`

Verify the actual prop API in the source file. The UX spec says: `surface: { kind: SurfaceKind; id: string }`. Check `packages/contracts/src/presence.ts` (or wherever `SurfaceKind` is defined) for valid `kind` values. Add `'plan'` if it does not exist. If `className` is not in the component's interface, position the indicator using a wrapper `<div>`.

### Architecture — Design tokens to verify before shipping

Check `apps/web/tailwind.config.ts` for these token classes:

| Class group | Token family | Used for |
|---|---|---|
| `border-lumi-honey-400` | `lumi-*` | `pending-input` dashed border |
| `bg-sacred-plum-100`, `text-sacred-plum-800`, `border-sacred-plum-200` | `sacred-*` | TrustChip `cultural-template` |
| `bg-safety-cleared-teal-100`, `text-safety-cleared-teal-800`, `border-safety-cleared-teal-200` | `safety-cleared-*` | TrustChip `allergy-cleared` |
| `bg-foliage-100`, `text-foliage-800`, `border-foliage-200` | design system | TrustChip `pantry-fresh` |
| `bg-lumi-terracotta-100`, `text-lumi-terracotta-800`, `border-lumi-terracotta-200` | `lumi-*` | TrustChip `lumi-proposed` |

If a class doesn't resolve, use the semantically closest available token and add a `// TODO:` comment.

### Architecture — Logical properties (ESLint lint rule)

The `hivekitchen/logical-properties-only` rule (established in Story 3.8) requires logical-property classes:

| ❌ Banned | ✅ Use instead |
|---|---|
| `border-l-*`, `border-r-*` | `border-s-*`, `border-e-*` |
| `pl-*`, `pr-*` | `ps-*`, `pe-*` |
| `left-*`, `right-*` | `start-*`, `end-*` |
| `ml-*`, `mr-*` | `ms-*`, `me-*` |

Use `end-2` (not `right-2`) for PresenceIndicator absolute positioning.

### Architecture — Animation constraints

Framer Motion is **banned** (ESLint import rule). Animation allowed via:
- Tailwind `animate-*` utilities only (`animate-spin` for the swap-in-progress spinner, `animate-pulse` for pending states)
- `@keyframes` in `apps/web/src/styles/` for custom named animations
- View Transitions API with `document.startViewTransition` feature-detect + `flushSync` fallback

Do NOT add `framer-motion` imports.

### Architecture — No toast notifications

Architecture bans `<Toast>` for plan interactions. Tile state changes are communicated entirely through the tile's own visual state (optimistic update via TanStack mutation re-render). No toast imports.

### Architecture — Safety-classified field model (context for Story 3.12)

When Story 3.12 wires swap mutations:
- Non-allergen swaps → optimistic TanStack mutation (`onMutate` → `state='decided'` tile updates → `onError` rollback)
- Allergen-affecting swaps → `state='swap-in-progress'` passed in; wait for server confirmation before resolving

This story builds the `swap-in-progress` visual so Story 3.12 can drive it via the `state` prop.

### Pattern — Variant derivation edge cases

| Today (JS `getDay()`) | Tile day | Result |
|---|---|---|
| Sunday (0) | any Mon–Sat | `upcoming` — correct; new week not started |
| Monday (1) | monday | `today` |
| Wednesday (3) | monday, tuesday | `past` |
| Wednesday (3) | thursday–saturday | `upcoming` |

The `DAY_ORDER` map uses the same numeric axis as `getDay()` for Mon–Sat (1–6). Sunday is explicitly excluded from `PlanTileSummary.day` enum and maps to 0 in `getDay()`, so the `todayJs !== 0` guard correctly handles Sunday.

### Pattern — `past` variant is fully non-interactive

`tabIndex={-1}` removes the tile from the Tab order. `pointer-events-none` blocks mouse interaction. Do NOT add any click handlers, keyboard handlers, or interactive children when the variant is `past`. The swap affordance (`onSwapIntent`) must not be reachable on past tiles.

### Project Structure — New and modified files

**Full replacement:**
```
apps/web/src/features/plan/PlanTile.tsx   ← Story 3.8 stub REPLACED entirely
```

**New files:**
```
apps/web/src/features/plan/
  TrustChip.tsx
  PlanTile.test.tsx
  TrustChip.test.tsx
apps/web/test/e2e/
  3-9-plantile.spec.ts
```

**Unchanged — do NOT touch:**
```
apps/web/src/features/plan/BriefCanvas.tsx          (no props change needed)
apps/web/src/features/plan/FreshnessState.tsx
apps/web/src/features/plan/MomentHeadline.tsx
apps/web/src/features/plan/LumiNote.tsx
apps/web/src/features/plan/useBriefStateQuery.ts
apps/web/src/lib/realtime/query-keys.ts
apps/web/src/routes/(app)/index.tsx
packages/contracts/src/plan.ts                      (no schema additions)
packages/contracts/src/events.ts                    (no new SSE events)
apps/api/                                           (no backend changes)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.9] — Story requirements, AC
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#PlanTile] — Component anatomy (day header `<h2>`, dish line 19pt semibold, TrustChip row), all 5 states, 3 variants, a11y
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#TrustChip] — 5 variants (sacred-plum, safety-cleared-teal, foliage, warm-neutral, lumi-terracotta); checkmark-first; never cross-based
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#PresenceIndicator] — `surface: { kind, id }` prop API; solo state = hidden; `aria-live=polite` on state change
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Typography] — Plan tile primary 15/16pt; dish line 19pt semibold; caption 13/14pt
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#DisambiguationPicker] — L1–L4 swap ladder (Story 3.12 scope)
- [Source: _bmad-output/planning-artifacts/architecture.md#4.3] — Animation: CSS + Tailwind only; Framer Motion banned
- [Source: _bmad-output/planning-artifacts/architecture.md#5.4] — Safety-classified field model; swap mutation pattern
- [Source: _bmad-output/planning-artifacts/architecture.md#6] — `features/plan/` and `features/thread/` project layout; `components/ui/` copy-in pattern
- [Source: packages/contracts/src/plan.ts#PlanTileSummarySchema] — `day` enum + `items[]` shape; no `recipe_name`, no `method_of_preparation`
- [Source: apps/web/src/features/plan/PlanTile.tsx] — Story 3.8 stub; `PlanTileProps`, `article[aria-label]`, `DAY_LABELS` map preserved
- [Source: Story 3.8 completion notes] — "Story 3.9 replaces this file completely"; PlanTileProps + article[aria-label] preserved for BriefCanvas
- [Source: Story 3.8 review findings] — Deferred to 3.9: `aria-label` redundancy with visible day text; ingredient-count dish label; PlanTile a11y ownership

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/web typecheck` — clean exit, no errors.
- `pnpm --filter @hivekitchen/web exec vitest run src/features/plan src/features/thread` — 8 files / 60 tests pass.
- `pnpm --filter @hivekitchen/web test` — 27 files / 205 tests pass (full web suite). No regressions vs. main.
- `pnpm --filter @hivekitchen/web lint` — 11 errors, 2 warnings, all pre-existing in files NOT touched by this story (compliance/, onboarding/, routes/(app)/account.tsx, routes/(app)/index.tsx, OnboardingText.test.tsx). One transient new lint error from the `<article> + onKeyDown` pattern was fixed with a single targeted `// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions` and a multi-line rationale.

### Completion Notes List

- **AC #1 — Day header + dish line + method caption + TrustChip row.**
  - Day header: `<h2>` with weekday text only — calendar date is intentionally omitted because `BriefStateRowSchema` carries no `week_of` field, and deriving a date from `getDay()` would be wrong on Sunday/cross-week boundaries. A future contract addition unlocks the date display without a PlanTile rewrite.
  - Dish line: rendered at Inter 19pt semibold per UX spec. Source data is `summary.items.flatMap(i => i.ingredients)` deduplicated and capped at 3 + "+N more" — fixes the Story 3.8 review-deferred concern about ingredient counting (review note: *"counts ingredients not meals"*) by deduplicating across items and showing the joined ingredient list as the dish proxy. Recipe-name resolution is still a future concern.
  - Method-of-preparation caption: omitted (no contract field). The spec's intent is preserved — the placeholder slot is left empty rather than filled with "Unknown method" or any misleading copy.
  - TrustChip row: implemented as `<TrustChip>` rendered for each entry in optional `trustChips` prop. BriefCanvas does not pass `trustChips` yet (Story 3.10 wires the allergy-cleared chip via the same prop), so chips don't render in production from this story alone — that's intentional.

- **AC #2 — Variants and states.**
  - `today` morning-only amber tint: derived from `new Date().getHours() < 13`. Uses `bg-honey-amber-100` (the design-system token), NOT Tailwind's default `bg-amber-50` — the project palette is warm-neutral with `honey-amber` as the semantic amber.
  - `past`: `opacity-60` + `pointer-events-none` + `tabIndex={-1}`. Fully non-interactive.
  - `locked`: renders the new minimal `<PresenceIndicator>` inline (positioned absolute top-end). The PresenceIndicator hides itself when `partnerName` is undefined.
  - `mutability-frozen`: built as an inline disclosure (`<button aria-expanded>` toggling a sibling `<p role="note">`) rather than a Popover. The story originally specified Shadcn Popover, but `apps/web` does not have Shadcn copy-in components or `@radix-ui/*` packages — adding them just for one explanation panel would be a heavyweight dependency for a small disclosure. Inline disclosure satisfies the UX intent ("tap → explain state") with full keyboard accessibility (button is natively focusable, `aria-expanded` announces state, `aria-controls` links to the panel).
  - `swap-in-progress`: absolute overlay with `aria-busy="true"` and a Tailwind `animate-spin` spinner.

- **AC #3 — Keyboard.**
  - `tabIndex={0}` on interactive tiles; `tabIndex={-1}` on past tiles.
  - Enter and Space call `onSwapIntent?.()`. Space is preventDefault'd to suppress page scroll.
  - Escape calls `tileRef.current?.blur()` — returns focus to the parent grid, allowing the parent's natural Tab order to take over.
  - The `<article>` retains its native landmark role (no `role=button` swap) so existing BriefCanvas tests + the 3-8 e2e spec (`getByRole('article', { name: day })`) continue to pass. The keyboard handler triggers `jsx-a11y/no-noninteractive-element-interactions`; this is suppressed with one targeted comment + rationale rather than restructuring around an overlay button or a div+role swap (both would break the article landmark contract).

- **PresenceIndicator scope.** The architecture project structure earmarks `features/thread/PresenceIndicator.tsx`, but the file did not exist when this story began. Built the smallest sufficient version: accepts `surface` + `partnerName` + `className`, renders only when partnerName is provided, exposes `role="status"` with `aria-live="polite"` per UX spec. SSE subscription to `presence.partner-active` events keyed by surface is intentionally deferred to Story 5.2 — the parent passes partnerName explicitly until then. Five tests cover the new component.

- **TrustChip token-class adaptation.** The story originally specified token classes like `bg-sacred-plum-100` and `bg-safety-cleared-teal-100`. Verified against `packages/design-system/src/tokens/index.ts` — the actual Tailwind color-group names are `sacred`, `safety-cleared`, `lumi-terracotta`, `foliage`, `memory-provenance`, `honey-amber`, `warm-neutral`. Used the correct names; the longer names would silently produce unstyled chips.

- **No BriefCanvas changes.** All new PlanTile props are optional with sensible defaults. The existing call site `<PlanTile key={summary.day} summary={summary} />` continues to work with `state='decided'` default and internally-derived variant. Verified by all 7 BriefCanvas tests passing unchanged.

- **No contract changes.** `PlanTileSummarySchema`, `BriefStateRowSchema`, `BriefResponseSchema` all unchanged. No new SSE events.

- **E2E spec created but un-runnable.** `apps/web/test/e2e/3-9-plantile.spec.ts` follows the pattern of the existing (uncommitted) `3-8-brief-canvas.spec.ts`. The project does not yet ship a `playwright.config.*` wired into the workspace; both 3-8 and 3-9 e2e specs are file-present, infra-deferred. No regression — current CI does not run e2e.

### File List

**New (apps/web)**
- `apps/web/src/features/plan/TrustChip.tsx`
- `apps/web/src/features/plan/TrustChip.test.tsx`
- `apps/web/src/features/plan/PlanTile.test.tsx`
- `apps/web/src/features/thread/PresenceIndicator.tsx`
- `apps/web/src/features/thread/PresenceIndicator.test.tsx`
- `apps/web/test/e2e/3-9-plantile.spec.ts`

**Modified**
- `apps/web/src/features/plan/PlanTile.tsx` — full replacement of Story 3.8 stub with all 5 states + 3 variants + keyboard handlers + TrustChip row + mutability-frozen disclosure
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 3-9 backlog → ready-for-dev → in-progress → review
- `_bmad-output/implementation-artifacts/3-9-plantile-component-with-all-states-variants.md` — this story file

## Change Log

| Date       | Author     | Change |
| ---------- | ---------- | ------ |
| 2026-05-03 | Amelia     | Story 3.9 implemented: full PlanTile (5 states, 3 variants, keyboard nav, TrustChip row, mutability-frozen inline disclosure) + new TrustChip + new minimal PresenceIndicator + 38 new unit tests + e2e spec. Adapted Popover requirement to inline disclosure (no Radix dependency). Adapted token class names to the real design-system prefixes (`sacred`, `safety-cleared`, `honey-amber`, etc.). |
| 2026-05-03 | Amelia     | Status → review. |
| 2026-05-03 | Menon      | Code review — 3 decision-needed, 4 patch, 4 defer, 7 dismissed. |

## Review Findings

### Patch

- [x] [Review][Patch] **P5 — Add `onClick={() => onSwapIntent?.()}` to `<article>` — pointer/touch users cannot trigger swap intent** [`PlanTile.tsx`] ✓ fixed
- [x] [Review][Patch] **P6 — Change `border-dotted` to `border-dashed` for `pending-input` state** [`PlanTile.tsx:97`] ✓ fixed
- [x] [Review][Patch] **P7 — Frozen explanation copy must reference Sunday and the 4-hour window** [`PlanTile.tsx:173-177`] ✓ fixed
- [x] [Review][Patch] **P1 — `bg-white` and `bg-honey-amber-100` both present — morning tint unreliable** [`PlanTile.tsx:100-110`] ✓ fixed
- [x] [Review][Patch] **P2 — `swap-in-progress` state doesn't block keyboard re-trigger of `onSwapIntent`** [`PlanTile.tsx:77`] ✓ fixed
- [x] [Review][Patch] **P3 — `TrustChip` keyed by `chip.label` alone — duplicate label key collision** [`PlanTile.tsx:154`] ✓ fixed
- [x] [Review][Patch] **P4 — Frozen tile `tabIndex={0}` contrary to AC #3** [`PlanTile.tsx:121`] ✓ fixed

### Defer

- [x] [Review][Defer] **W1 — `PresenceIndicator` `surface` prop accepted in interface but unused at runtime** [`PresenceIndicator.tsx:4,13`] — deferred, pre-existing; SSE subscription wiring via surface arrives with Story 5.2.
- [x] [Review][Defer] **W2 — Saturday in a stale brief renders as `upcoming` in the following week** [`PlanTile.tsx:43-52`] — deferred, pre-existing; `BriefStateRowSchema` has no `week_of` field; documented constraint, future contract addition.
- [x] [Review][Defer] **W3 — `state='locked'` with no `partnerName` renders identically to `state='decided'`** [`PlanTile.tsx:125-131`] — deferred, pre-existing; intentional per completion notes; partner name delivered via SSE in Story 5.2.
- [x] [Review][Defer] **W4 — `deriveVariant` and `hasMorningTint` stale after midnight/13:00 with no reactive update** [`PlanTile.tsx:43,78`] — deferred, pre-existing; explicitly documented as "Acceptable for MVP" in story spec.
