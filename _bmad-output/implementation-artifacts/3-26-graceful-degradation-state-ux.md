# Story 3.26: Graceful-Degradation State UX

Status: ready-for-dev

## Story

As a Primary Parent,
I want the Brief to render an honest graceful-degradation state when Lumi cannot generate a safe plan,
So that I see "Lumi is working on it" rather than a broken or empty surface (FR24).

## Acceptance Criteria

1. **Given** Story 3.25 is complete,
   **When** plan composition fails and ops is engaged,
   **Then** Brief renders `<FreshnessState variant=failed>` with the honest copy *"Lumi is reworking this week's plan. We'll have it ready by [estimated time]."* — never a spinner, never an evasive "Something went wrong."

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.11: `<FreshnessState variant=fresh|stale|loading|failed>` exists in `apps/web/src/features/plan/FreshnessState.tsx`; the `failed` variant is declared in the type union but may need its copy wired to use `plan_state_message` from `brief_state`
- Story 3.25: `brief_state.plan_state = 'hard_failed'`; `plan_state_set_at`; `plan_state_message` — the signal source
- Story 3.8: `<BriefCanvas>` — already renders `<FreshnessState>` at the bottom of the Brief surface; and renders `<AccountableError>` for safety issues (from Story 3.24 + 3.25 extensions)
- Story 3.25: `<AccountableError>` renders the hard-fail message for the safety/ops escalation
- The UX distinction: `<AccountableError>` = loud, safety/ops issue, teal palette; `<FreshnessState variant=failed>` = quiet, system-state annotation, warm-neutral-500, single line

**Key invariants:**
- `<FreshnessState variant=failed>` annotates the Brief — it does NOT replace the plan tiles or make the surface unusable
- Copy is honest and time-bound: "by [estimated time]" = `plan_state_set_at + 1 hour` (formatted in parent's local timezone)
- Never shows a spinner for the failed state (spinner = loading = Lumi is running; failed = Lumi stopped)
- `<FreshnessState>` is a status annotation, never a blocking modal or full-surface takeover
- No `framer-motion` — Tailwind animation utilities only
- Logical-property lint applies: `ps-*`/`pe-*` not `pl-*`/`pr-*`, etc.
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — Read current `<FreshnessState>` implementation

Before writing any code, read `apps/web/src/features/plan/FreshnessState.tsx` (from Story 3.11) to understand the current variant structure and styling conventions.

The existing `failed` variant likely renders a generic message. This task updates it to use the `plan_state_message` from `brief_state` when available, and to compute the estimated-time from `plan_state_set_at`.

### Task 2 — Update `<FreshnessState>` to support `plan_state_message` + estimated time

In `apps/web/src/features/plan/FreshnessState.tsx`, update the `failed` variant to accept optional props:

```typescript
interface FreshnessStateProps {
  variant: 'fresh' | 'stale' | 'loading' | 'failed';
  // For variant=failed: when the failure was set (used to compute estimated recovery time).
  failedAt?: string | null;    // ISO datetime string, from brief_state.plan_state_set_at
}
```

For the `failed` variant:

```typescript
case 'failed': {
  const estimatedReady = failedAt
    ? formatEstimatedTime(new Date(failedAt))
    : 'soon';

  return (
    <p
      role="status"
      aria-live="polite"
      className="font-sans text-[13px] text-warm-neutral-500 leading-relaxed"
    >
      Lumi is reworking this week&apos;s plan. We&apos;ll have it ready by {estimatedReady}.
    </p>
  );
}
```

Helper:
```typescript
function formatEstimatedTime(failedAt: Date): string {
  const estimated = new Date(failedAt.getTime() + 60 * 60 * 1000); // +1 hour
  return estimated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
```

The `<FreshnessState>` component renders inline — no spinner, no icon, no animated state for `failed`. It is a single quiet line at the bottom of the Brief.

### Task 3 — Verify `<FreshnessState>` placement in `BriefCanvas`

In `apps/web/src/features/plan/BriefCanvas.tsx`, verify the `<FreshnessState>` is already rendered at the bottom of the Brief. It should receive `variant` based on data state:

```typescript
// Determine freshness variant:
const freshnessVariant: FreshnessStateProps['variant'] =
  brief.plan_state === 'hard_failed' ? 'failed'
  : isPending ? 'loading'
  : isStale ? 'stale'
  : 'fresh';

// Render:
<FreshnessState
  variant={freshnessVariant}
  failedAt={brief.plan_state_set_at}
/>
```

If `BriefCanvas` already renders `<FreshnessState>` from Story 3.11 with a simpler variant logic, update it to include the `hard_failed` case.

### Task 4 — Plan tiles remain visible in failed state

When `plan_state === 'hard_failed'`, plan tiles for the current week may be absent (no plan committed). In this case, `brief.plan_tile_summaries` will be empty. The `<BriefCanvas>` should render:
- `<AccountableError>` (from Story 3.25, Task 6) — the loud escalation message
- `<FreshnessState variant=failed>` — the quiet estimated-time annotation
- No empty plan tile rows — do not render placeholder tiles for a week with no committed plan

The two elements coexist: `<AccountableError>` is a content block near the top, `<FreshnessState>` is a single-line status at the bottom.

```typescript
// In BriefCanvas, after plan tiles section:
{!hasPlanTiles && brief.plan_state === 'hard_failed' && (
  // Spacer — AccountableError rendered above handles the primary message
  null
)}
<FreshnessState variant={freshnessVariant} failedAt={brief.plan_state_set_at} />
```

### Task 5 — Contract: `BriefStateResponse` includes `plan_state_set_at`

Verify (from Story 3.25, Task 6) that `BriefStateResponseSchema` in `packages/contracts/src/brief.ts` already includes `plan_state_set_at`. If not, add it here.

`FreshnessState` receives `failedAt` from `useBriefStateQuery()` → `brief.plan_state_set_at`.

### Task 6 — Tests

**`FreshnessState.test.tsx` (extend):**
- `variant=failed` with `failedAt` → renders copy with computed estimated time (`failedAt + 1h` formatted)
- `variant=failed` without `failedAt` → renders copy with "soon" in place of time
- `variant=failed` → no spinner element in DOM
- `variant=loading` → still renders loading copy (regression: existing behavior unchanged)
- `variant=fresh` → renders fresh copy (regression)

**`BriefCanvas.test.tsx` (extend):**
- `brief.plan_state = 'hard_failed'` + empty `plan_tile_summaries` → renders `<AccountableError>` + `<FreshnessState variant=failed>`; no plan tile rows
- `brief.plan_state = null` → no `<FreshnessState variant=failed>` (regression)

---

## Dev Notes

### Two-layer escalation surface

The UX spec distinguishes:
1. **`<AccountableError>`** (loud) — safety/ops issue, teal border, `role=alert`, `aria-live=assertive`. Renders the ops-escalation message from Story 3.25.
2. **`<FreshnessState variant=failed>`** (quiet) — system-state annotation, warm-neutral-500 single line, `role=status`, `aria-live=polite`. Renders the estimated-time copy.

Both surfaces render simultaneously in the hard-fail state. They address different parent needs:
- "What happened?" → `<AccountableError>`
- "When will it be fixed?" → `<FreshnessState>`

Do not collapse these into one component. Per UX-DR19 and UX-DR28, freshness annotation and safety messaging are distinct surfaces.

### Estimated time is a soft promise

"By [time]" = `plan_state_set_at + 1 hour`. This is a best-effort estimate. Ops may resolve it sooner or later. The copy should feel warm and trustworthy, not like a hard SLA. This is why it says "We'll have it ready by" rather than "Fixed by".

If ops resolves the constraint conflict before the estimated time, the next plan generation succeeds, `brief_state.plan_state` clears (Story 3.25 `clearIfSet()`), and `<FreshnessState>` switches back to `fresh` on the next poll.

### Existing `failed` variant in Story 3.11

Story 3.11 declared `failed` in the type union but the actual copy may have been left generic ("Something went wrong"). This story defines the real copy. If the existing implementation renders generic copy, replace it — do not add a new variant branch alongside the existing one.

---

## Project Structure

**No new files** — this story updates existing components.

**Modified files:**
```
apps/web/src/features/plan/FreshnessState.tsx             + failed variant: computed estimated time from failedAt; honest copy
apps/web/src/features/plan/BriefCanvas.tsx                + freshnessVariant logic includes hard_failed case; failedAt prop passed
packages/contracts/src/brief.ts                           + verify plan_state_set_at is present (from 3.25)
_bmad-output/implementation-artifacts/sprint-status.yaml  3-26 → ready-for-dev
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.26 created — ready-for-dev. |
