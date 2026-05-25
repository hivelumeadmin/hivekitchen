# Story 3.26: Graceful-Degradation State UX

Status: done

## Story

As a Primary Parent,
I want the Brief to render an honest graceful-degradation state when Lumi cannot generate a safe plan,
so that I see a specific, warm message with a real estimated recovery time — never a spinner, never an evasive "Something went wrong" (FR24).

## Context

Story 3.25 shipped the backend hard-fail machinery (`plan.hard_fail` audit, `findHardFailAudit` repo method,
`getHardFailStatus` service method, `hard_fail` field on `GET /v1/plans`) and a provisional `<AccountableError />`
component with static ops-facing copy.

This story replaces that provisional component with a proper `<FreshnessState variant="reworking">` that:
- Shows a real estimated recovery time computed from when the hard-fail audit row was created (`failed_at = created_at + 1h`)
- Extends the API contract to surface `failed_at`
- Cleans up the now-superseded `AccountableError` files

`FreshnessState` is the canonical status-indicator in the plan surface. Routing the hard-fail state through it
keeps visual consistency with `loading`, `stale`, and `offline` — all warm-neutral, all `role="status"`.

**What Story 3.25 shipped (read these files before touching anything):**
- `apps/web/src/features/plan/AccountableError.tsx` — copy: "Lumi couldn't compose a safe plan this week. Our ops team is reviewing — we'll be back to you within an hour."
- `apps/web/src/features/plan/PlanPage.tsx` — renders `<AccountableError />` when `data.hard_fail != null && !data.is_draft`
- `apps/api/src/modules/plans/plans.repository.ts` — `findHardFailAudit()` returns `boolean` (SELECT `id` only)
- `apps/api/src/modules/plans/plans.service.ts` — `getHardFailStatus()` returns `Promise<boolean>`
- `apps/api/src/modules/plans/plans.routes.ts` — hard_fail field is `{ week_of }` only; wrapped in try/catch that degrades to no field on error
- `packages/contracts/src/plan.ts` — `HardFailStatusSchema = z.object({ week_of: z.string().date() })`

**What this story delivers:**
- `FreshnessState variant="reworking"`: "Lumi is reworking this week's plan. We'll have it ready by [time]."
- `[time]` = `hard_fail.failed_at + 1 hour` formatted as locale time (`toLocaleTimeString`)
- Falls back to "soon" if ETA already passed; falls back to "within the hour" if `failedAt` missing/invalid
- `AccountableError.tsx` + `AccountableError.test.tsx` deleted — superseded

## Acceptance Criteria

**AC1** — `HardFailStatusSchema` gains `failed_at: z.string().datetime()`. `GetPlansResponseSchema.hard_fail` remains `HardFailStatusSchema.nullable().optional()`.

**AC2** — `PlansRepository.findHardFailAudit()` changes its SELECT from `'id'` to `'id, created_at'` and returns `{ failedAt: string } | null` instead of `boolean`.

**AC3** — `PlansService.getHardFailStatus()` returns `{ week_of: string; failed_at: string } | null`. The handler in `plans.routes.ts` builds `hard_fail: { week_of, failed_at }` from this result. The existing try/catch error-suppression block remains — its `catch` fallback changes from `false` to `null`.

**AC4** — `FreshnessState.tsx` gains a `'reworking'` variant in `FreshnessVariant`. When rendered with `variant="reworking"`:
- Renders a `<p>` with `role="status"` and `aria-live="polite"`
- Uses warm-neutral `text-fg-muted` token — NOT red/error/destructive tokens
- No spinner, no action buttons
- Copy: `"Lumi is reworking this week's plan. We'll have it ready by [time]."` where `[time]` comes from the optional `failedAt?: string` prop (see AC5)

**AC5** — `FreshnessState.tsx` exports a named pure helper `formatEstimatedRecovery(failedAt: string | undefined): string`:
- `undefined` or invalid ISO string → `"within the hour"`
- `failedAt + 1h <= Date.now()` (ETA already passed) → `"soon"`
- Otherwise → `toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })` (browser locale, NOT hardcoded `'en-US'`)
- Result is embedded: `"... We'll have it ready by ${result}."`

**AC6** — `PlanPage.tsx` replaces `<AccountableError />` with `<FreshnessState variant="reworking" failedAt={data.hard_fail?.failed_at} />`. The `AccountableError` import line is removed.

**AC7** — `apps/web/src/features/plan/AccountableError.tsx` and `AccountableError.test.tsx` are deleted. No stubs, no re-exports.

**AC8** — `FreshnessState.test.tsx` new test coverage:
- `reworking` without `failedAt` → contains "within the hour"
- `reworking` with future `failedAt` (ETA not yet passed) → contains a locale time string (NOT "soon", NOT "within the hour")
- `reworking` with past `failedAt` (ETA already passed) → contains "soon"
- `reworking` carries `role="status"` and `aria-live="polite"`
- `reworking` className contains `text-fg-muted` and does NOT contain `"red"`, `"destructive"`, or `"error"`
- Existing multi-variant `role="status"` test is extended to include `reworking`
- `formatEstimatedRecovery` unit tests: `undefined` → "within the hour"; invalid string → "within the hour"; past ETA → "soon"; future ETA → a non-empty non-fallback string

**AC9** — Repository, service, route, and contract tests updated:
- `findHardFailAudit` returns `{ failedAt: string }` on hit, `null` on miss (was `true`/`false`)
- `getHardFailStatus` returns `{ week_of, failed_at }` on hit, `null` on miss (was `true`/`false`)
- Route "present when true" test asserts `hard_fail.failed_at` is an ISO datetime string
- `buildMockService`'s `getHardFailStatus` default changes from `false` to `null`
- `HardFailStatusSchema` contract test includes `failed_at`; existing "with hard_fail" fixture adds `failed_at`

**AC10** — `packages/types/src/index.ts` re-export of `HardFailStatus` compiles cleanly after the schema extension (additive — no manual type change needed if it uses `z.infer<typeof HardFailStatusSchema>`).

**AC11** — Sprint-status updated (`3-26 → ready-for-dev`) and deferred-work updated: the Story 3.25 "SSE-driven clear of `<AccountableError>` banner" entry has its component reference updated to `FreshnessState variant="reworking"`. SSE auto-dismiss remains deferred to Epic 9.

---

## Dependencies & Context

**Prerequisite stories (do NOT re-implement their work):**
- Story 3.25: `findHardFailAudit`, `getHardFailStatus`, `hard_fail` in `GET /v1/plans`, `HardFailStatusSchema`, `GuardrailRejectionError`, `plan.hard_fail` audit event — all EXIST. This story EXTENDS them.
- Story 3.11: `FreshnessState` component — exists with `fresh | stale | loading | failed | offline`. This story ADDS `reworking`.

**Key invariants preserved:**
- `FreshnessState variant="failed"` (for `isError` / network/fetch errors) is UNCHANGED. Copy stays "Lumi couldn't reach the plan right now." — a different failure mode.
- The `plan === null && !isDraft && data.hard_fail != null` condition in `PlanPage.tsx` is unchanged in logic. Only the rendered component changes.
- No new DB migration, no new tables. Only SELECT clause changes in `findHardFailAudit`.
- The try/catch error-suppression around `getHardFailStatus` in `plans.routes.ts` (3.25 code-review patch) stays — only its `catch` fallback changes from `false`/no-field to `null`/no-field.

**Deferred (explicitly out of scope):**
- SSE-driven auto-dismiss when ops resolves and a new plan lands — Epic 9.
- BullMQ retry-window premature banner — noted in deferred-work from 3.25 review.

---

## Tasks / Subtasks

### T1 — Extend `HardFailStatusSchema` in contracts

**File:** `packages/contracts/src/plan.ts`

The schema comment says "Story 3.25 — hard-fail status payload." Update the schema only; do not touch the comment.

```typescript
// BEFORE
export const HardFailStatusSchema = z.object({
  week_of: z.string().date(),
});

// AFTER
export const HardFailStatusSchema = z.object({
  week_of: z.string().date(),
  failed_at: z.string().datetime(),
});
```

`GetPlansResponseSchema` is unchanged — it already references `HardFailStatusSchema.nullable().optional()`.

---

### T2 — Update `PlansRepository.findHardFailAudit()`

**File:** `apps/api/src/modules/plans/plans.repository.ts`

Read the existing method before editing. Change SELECT from `'id'` to `'id, created_at'` and change return type.

```typescript
async findHardFailAudit(householdId: string, weekOf: string): Promise<{ failedAt: string } | null> {
  const { data, error } = await this.client
    .from('audit_log')
    .select('id, created_at')              // ← was 'id'
    .eq('event_type', 'plan.hard_fail')
    .eq('household_id', householdId)
    .eq('metadata->>week_of', weekOf)      // keep existing filter style from 3.25
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data !== null ? { failedAt: data.created_at as string } : null;
}
```

`audit_log.created_at` is an ISO 8601 timestamp string in Supabase's generated types. Cast `as string` follows the existing pattern in the repo. If the generated type is already `string`, the cast is a no-op.

---

### T3 — Update `PlansService.getHardFailStatus()`

**File:** `apps/api/src/modules/plans/plans.service.ts`

Read the existing method before editing.

```typescript
// BEFORE
async getHardFailStatus(householdId: string, weekOf: string): Promise<boolean> {
  return this.repo.findHardFailAudit(householdId, weekOf);
}

// AFTER
async getHardFailStatus(
  householdId: string,
  weekOf: string,
): Promise<{ week_of: string; failed_at: string } | null> {
  const result = await this.repo.findHardFailAudit(householdId, weekOf);
  return result !== null ? { week_of: weekOf, failed_at: result.failedAt } : null;
}
```

---

### T4 — Update GET /v1/plans handler

**File:** `apps/api/src/modules/plans/plans.routes.ts`

Read the existing handler before editing. Find the `hard_fail` construction block (introduced in Story 3.25). The existing code looks roughly like:

```typescript
let hardFail: { week_of: string } | null = null;
if (plan === null && !isDraft) {
  try {
    const isHardFail = await request.plansService.getHardFailStatus(householdId, weekOf);
    if (isHardFail) hardFail = { week_of: weekOf };
  } catch (err) {
    request.log.error({ err }, 'getHardFailStatus failed — degrading gracefully');
  }
}
```

Update it:
```typescript
let hardFail: { week_of: string; failed_at: string } | null = null;
if (plan === null && !isDraft) {
  try {
    hardFail = await request.plansService.getHardFailStatus(householdId, weekOf);
  } catch (err) {
    request.log.error({ err }, 'getHardFailStatus failed — degrading gracefully');
  }
}

return reply.status(200).send({
  plan: plan ?? null,
  plan_items: planItems,
  is_draft: isDraft,
  week_of: weekOf,
  ...(hardFail !== null ? { hard_fail: hardFail } : {}),
});
```

The try/catch pattern is preserved exactly. Only the variable type and the `getHardFailStatus` result handling change.

---

### T5 — Verify `packages/types/src/index.ts`

**File:** `packages/types/src/index.ts`

`HardFailStatus` type is re-exported via `z.infer<typeof HardFailStatusSchema>`. After T1 adds `failed_at` to the schema, the inferred type automatically includes it. No manual change needed — run `pnpm --filter @hivekitchen/contracts exec tsc --noEmit` to confirm.

---

### T6 — Add `'reworking'` variant to `FreshnessState`

**File:** `apps/web/src/features/plan/FreshnessState.tsx`

Read the current file before editing. It is ~56 lines. Key changes:

1. Add `'reworking'` to the `FreshnessVariant` union type.
2. Add `failedAt?: string` to `FreshnessStateProps`.
3. Update `STATIC_MESSAGES` type to exclude `'reworking'` from the `Record` key set.
4. Export the `formatEstimatedRecovery` helper.
5. Add the `reworking` branch before the final `return`.

The full replacement of `FreshnessState.tsx`:

```typescript
export type FreshnessVariant = 'fresh' | 'stale' | 'loading' | 'failed' | 'offline' | 'reworking';

interface FreshnessStateProps {
  variant: FreshnessVariant;
  lastSyncedAt?: string;
  failedAt?: string;  // only consumed by 'reworking' variant
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0 || isNaN(diff)) return 'just now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

export function formatEstimatedRecovery(failedAt: string | undefined): string {
  if (failedAt === undefined) return 'within the hour';
  const eta = new Date(new Date(failedAt).getTime() + 3_600_000);
  if (isNaN(eta.getTime())) return 'within the hour';
  if (eta.getTime() <= Date.now()) return 'soon';
  return eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const STATIC_MESSAGES: Record<Exclude<FreshnessVariant, 'fresh' | 'stale' | 'reworking'>, string> = {
  loading: "Lumi is drafting this week's plan. About 30 seconds.",
  failed: "Lumi couldn't reach the plan right now.",
  offline: "You're offline. Yesterday's plan below.",
};

export function FreshnessState({ variant, lastSyncedAt, failedAt }: FreshnessStateProps) {
  if (variant === 'fresh') return null;

  if (variant === 'stale') {
    const timeText =
      lastSyncedAt !== undefined
        ? `last synced ${formatRelativeTime(lastSyncedAt)}`
        : undefined;
    return (
      <p
        className="inline-flex items-center gap-1.5 mt-2 font-sans text-[13px] text-fg-muted"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-foliage motion-safe:animate-pulse"
        />
        {timeText !== undefined ? `Checking… ${timeText}` : 'Checking…'}
      </p>
    );
  }

  if (variant === 'reworking') {
    const eta = formatEstimatedRecovery(failedAt);
    return (
      <p
        className="mt-2 font-sans text-[13px] text-fg-muted"
        role="status"
        aria-live="polite"
      >
        {`Lumi is reworking this week's plan. We'll have it ready by ${eta}.`}
      </p>
    );
  }

  return (
    <p
      className="mt-2 font-sans text-[13px] text-fg-muted"
      role="status"
      aria-live="polite"
    >
      {STATIC_MESSAGES[variant]}
    </p>
  );
}
```

---

### T7 — Update `PlanPage.tsx`

**File:** `apps/web/src/features/plan/PlanPage.tsx`

Two changes only. Read the file before editing.

**1. Remove the `AccountableError` import (line 14 currently):**
```typescript
// DELETE this line:
import { AccountableError } from './AccountableError.js';
```

**2. Replace the hard-fail render branch (~line 254–255 currently):**
```tsx
// BEFORE
data.hard_fail != null && !data.is_draft ? (
  <AccountableError />
) : (

// AFTER
data.hard_fail != null && !data.is_draft ? (
  <FreshnessState variant="reworking" failedAt={data.hard_fail?.failed_at} />
) : (
```

`FreshnessState` is already imported at line 15 of `PlanPage.tsx`. No new import needed.
`data.hard_fail?.failed_at` is `string | undefined` — matches `failedAt?: string` prop.

---

### T8 — Delete `AccountableError` files

Delete both files (no partial stubs, no re-exports):
- `apps/web/src/features/plan/AccountableError.tsx`
- `apps/web/src/features/plan/AccountableError.test.tsx`

Verify first with a grep that `AccountableError` is not imported anywhere else:
```bash
grep -r "AccountableError" apps/web/src/
```
After T7, only the deleted files themselves should contain the string. If any other file imports it, update that file too.

---

### T9 — Tests

#### `apps/web/src/features/plan/FreshnessState.test.tsx` (extend existing)

**Imports to add** at top of file:
```typescript
import { FreshnessState, formatEstimatedRecovery } from './FreshnessState.js';
```

**Extend multi-variant `role="status"` test** (currently lines 60–72). Add `reworking` to the list:
```typescript
cleanup();
render(<FreshnessState variant="reworking" />);
expect(screen.getByRole('status')).toBeDefined();
```

**Add new describe block for reworking variant:**
```typescript
describe('FreshnessState — reworking variant', () => {
  it('renders the reworking copy fragment', () => {
    render(<FreshnessState variant="reworking" />);
    expect(screen.getByText(/Lumi is reworking this week's plan/)).toBeDefined();
  });

  it('falls back to "within the hour" when failedAt is absent', () => {
    render(<FreshnessState variant="reworking" />);
    expect(screen.getByText(/within the hour/)).toBeDefined();
  });

  it('shows "soon" when failedAt + 1h is already past', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    render(<FreshnessState variant="reworking" failedAt={twoHoursAgo} />);
    expect(screen.getByText(/soon/)).toBeDefined();
  });

  it('shows a locale time string when failedAt + 1h is in the future', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    render(<FreshnessState variant="reworking" failedAt={thirtyMinutesAgo} />);
    const p = screen.getByRole('status');
    expect(p.textContent).not.toContain('soon');
    expect(p.textContent).not.toContain('within the hour');
    // The ETA (30 min from now) is some locale time string — just assert it is present
    expect(p.textContent?.length).toBeGreaterThan(0);
  });

  it('exposes role="status" and aria-live="polite"', () => {
    render(<FreshnessState variant="reworking" />);
    const node = screen.getByRole('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
  });

  it('uses warm-neutral token, no error/red/destructive tokens', () => {
    const { container } = render(<FreshnessState variant="reworking" />);
    const p = container.querySelector('p');
    expect(p?.className).toContain('text-fg-muted');
    expect(p?.className).not.toContain('red');
    expect(p?.className).not.toContain('destructive');
    expect(p?.className).not.toContain('error');
  });
});
```

**Add describe block for `formatEstimatedRecovery`:**
```typescript
describe('formatEstimatedRecovery', () => {
  it('returns "within the hour" when failedAt is undefined', () => {
    expect(formatEstimatedRecovery(undefined)).toBe('within the hour');
  });

  it('returns "within the hour" when failedAt is an invalid date string', () => {
    expect(formatEstimatedRecovery('not-a-date')).toBe('within the hour');
  });

  it('returns "soon" when failedAt + 1h is in the past', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatEstimatedRecovery(twoHoursAgo)).toBe('soon');
  });

  it('returns a non-empty time string when failedAt + 1h is in the future', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const result = formatEstimatedRecovery(thirtyMinutesAgo);
    expect(result).not.toBe('soon');
    expect(result).not.toBe('within the hour');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

---

#### `apps/api/src/modules/plans/plans.repository.test.ts` (extend existing)

Find the two `findHardFailAudit` tests from Story 3.25:
- **"returns true when a matching row exists"** → update: mock `maybeSingle` to return `{ id: '...', created_at: '2026-05-25T08:00:00Z' }`. Assert result equals `{ failedAt: '2026-05-25T08:00:00Z' }` instead of `true`.
- **"returns false when no row exists"** → update: assert result is `null` instead of `false`.

---

#### `apps/api/src/modules/plans/plans.service.test.ts` (extend existing)

Find the `getHardFailStatus` test from Story 3.25:
- Mock `repo.findHardFailAudit` to return `{ failedAt: '2026-05-25T08:00:00Z' }` instead of `true`.
- Assert `getHardFailStatus` returns `{ week_of: '2026-05-26', failed_at: '2026-05-25T08:00:00Z' }` instead of `true`.
- Add a second test: mock returns `null` → `getHardFailStatus` returns `null`.

---

#### `apps/api/src/modules/plans/plans.routes.test.ts` (extend existing)

- **`buildMockService`**: change `getHardFailStatus: vi.fn().mockResolvedValue(false)` → `vi.fn().mockResolvedValue(null)`.
- **"present when true" test**: mock returns `{ week_of: '2026-05-26', failed_at: '2026-05-25T08:00:00Z' }`. Assert `body.hard_fail.failed_at` is `'2026-05-25T08:00:00Z'`.
- **"omit when no hard fail" test**: mock returns `null`. Assert `'hard_fail' in body` is false (logic unchanged, just mock shape).
- **Draft-skip and plan-present-skip tests**: update mock default; assertions otherwise unchanged.

---

#### `packages/contracts/src/plan.test.ts` (extend existing)

Find the hard_fail contract tests from Story 3.25:
- **"parses with hard_fail"**: add `failed_at: '2026-05-25T08:00:00Z'` to the `hard_fail` fixture.
- **"parses without hard_fail"**: unchanged.
- **Add**: `HardFailStatusSchema` rejects a payload that has `week_of` but is missing `failed_at`.

---

### T10 — Type-check and test

```bash
pnpm --filter @hivekitchen/contracts exec vitest run
pnpm --filter @hivekitchen/contracts exec tsc --noEmit
pnpm --filter @hivekitchen/api exec vitest run
pnpm --filter @hivekitchen/api exec tsc --noEmit
pnpm --filter @hivekitchen/web exec vitest run
pnpm --filter @hivekitchen/web exec tsc --noEmit
```

All must pass before marking done. Pre-existing TS errors in unrelated files (voice, day-overrides, households, plan-regeneration test harness) are documented in Story 3.25 dev notes — do not flag as regressions.

---

### T11 — Sprint-status + deferred-work

**`_bmad-output/implementation-artifacts/sprint-status.yaml`:**
- Change `3-26-graceful-degradation-state-ux: backlog` → `ready-for-dev`
- Update `last_updated` line

**`_bmad-output/implementation-artifacts/deferred-work.md`:**

Find the Story 3.25 deferred entry titled "SSE-driven clear of `<AccountableError>` banner". Update:
- Replace `<AccountableError>` with `<FreshnessState variant="reworking">`
- Update file path: `apps/web/src/features/plan/FreshnessState.tsx`
- Keep "SSE auto-dismiss deferred to Epic 9" note unchanged

### Review Findings (code review 2026-05-25)

- [x] [Review][Patch] P1: `findHardFailAudit` missing ORDER BY — without `.order('created_at', { ascending: false })` before `.limit(1)`, Postgres returns an arbitrary row; if multiple hard-fail events exist for the same household+week the oldest ETA is returned instead of the most recent, causing `formatEstimatedRecovery` to emit `'soon'` prematurely [apps/api/src/modules/plans/plans.repository.ts — findHardFailAudit]
- [x] [Review][Patch] P2: Redundant `?.` on already-narrowed value — `data.hard_fail?.failed_at` inside the `data.hard_fail != null &&` truthy branch; `data.hard_fail` is non-null here, so `?.` is unnecessary and misleads readers into thinking null is possible [apps/web/src/features/plan/PlanPage.tsx — reworking branch]
- [x] [Review][Defer] D1: ETA clock skew — `formatEstimatedRecovery` compares server-written `failed_at + 1h` against client `Date.now()`; a client clock significantly ahead of server time collapses every ETA to `'soon'` on first render — design-level issue, inherent to client-side time comparison, no server-anchor available [apps/web/src/features/plan/FreshnessState.tsx — formatEstimatedRecovery]
- [x] [Review][Defer] D2: `FlaggedCompoundItemSchema.day` validated against `SLOT_MAX` — copies the same pattern from `ConflictSchema` which has the same SLOT_MAX usage for `day`; pre-existing, not introduced by this story [packages/contracts/src/plan.ts — FlaggedCompoundItemSchema]
- [x] [Review][Defer] D3: `layer2Materialize` requests `count: 3` but uses only `candidates[0]` — wasted Tavily fetches on 2.6-s3 code; out of scope for this 3.26 review [apps/api/src/modules/plans/plans.service.ts — layer2Materialize]
- [x] [Review][Defer] D4: `packages/types/src/index.ts` HardFailStatus re-export — verify-only task (AC10); `z.infer<typeof HardFailStatusSchema>` picks up `failed_at` automatically; no manual change needed but confirm `tsc --noEmit` passes [packages/types/src/index.ts]

---

## Dev Notes

### Do NOT touch `FreshnessState variant="failed"` copy

`variant="failed"` renders `"Lumi couldn't reach the plan right now."` for `isError` (React Query fetch/network failure) in `PlanPage.tsx`. This is a DIFFERENT failure mode from the hard-fail guardrail. Leave its copy and behavior untouched.

### `formatEstimatedRecovery` is exported for testability

Exported as a named function (not default) for independent unit testing without React rendering. This is specific to `FreshnessState` — do NOT promote it to `lib/`.

### `STATIC_MESSAGES` type exclusion must be updated

The current type is `Record<Exclude<FreshnessVariant, 'fresh' | 'stale'>, string>`. After adding `'reworking'` to the union, TypeScript will complain that `'reworking'` is missing from the record. Add `'reworking'` to the exclusion list: `Exclude<FreshnessVariant, 'fresh' | 'stale' | 'reworking'>`.

### `data.hard_fail?.failed_at` is `string | undefined` — matches the prop

`GetPlansResponse.hard_fail` is `HardFailStatus | null | undefined`. Optional chaining `.failed_at` yields `string | undefined`, which matches `failedAt?: string`. No cast needed.

### The try/catch in `plans.routes.ts` must change its fallback value

Story 3.25's code-review patch wraps `getHardFailStatus` in try/catch so a DB blip doesn't crash the plans page. Currently the `catch` block likely logs and leaves `hardFail` as `false` or skips assignment. After T3 changes `getHardFailStatus` to return `{ ... } | null`, the `catch` block must degrade to `null` (not `false`), and `hardFail` must be initialized as `null`. The type of `hardFail` changes from `{ week_of: string } | null` to `{ week_of: string; failed_at: string } | null`.

### Verify `AccountableError` has no other consumers before deleting

```bash
grep -r "AccountableError" apps/web/src/
```
After T7, only the two files being deleted should match. If any other file imports it, update that file first.

### No new Supabase migration needed

`audit_log.created_at` is an existing column — we only added it to the SELECT list. No schema change.

---

## Project Structure

**Deleted files:**
```
apps/web/src/features/plan/AccountableError.tsx       (superseded by reworking variant)
apps/web/src/features/plan/AccountableError.test.tsx  (superseded)
```

**Modified files:**
```
packages/contracts/src/plan.ts                             T1: HardFailStatusSchema + failed_at
packages/contracts/src/plan.test.ts                        T9: updated contract tests
apps/api/src/modules/plans/plans.repository.ts             T2: findHardFailAudit → { failedAt } | null
apps/api/src/modules/plans/plans.repository.test.ts        T9: updated assertions
apps/api/src/modules/plans/plans.service.ts                T3: getHardFailStatus → { week_of, failed_at } | null
apps/api/src/modules/plans/plans.service.test.ts           T9: updated mock + assertions
apps/api/src/modules/plans/plans.routes.ts                 T4: hard_fail includes failed_at; catch degrades to null
apps/api/src/modules/plans/plans.routes.test.ts            T9: updated mock shape + assertions
packages/types/src/index.ts                                T5: verify HardFailStatus type compiles
apps/web/src/features/plan/FreshnessState.tsx              T6: 'reworking' variant + formatEstimatedRecovery
apps/web/src/features/plan/FreshnessState.test.tsx         T9: reworking + formatEstimatedRecovery tests
apps/web/src/features/plan/PlanPage.tsx                    T7: remove AccountableError; wire reworking variant
_bmad-output/implementation-artifacts/sprint-status.yaml   T11: 3-26 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md     T11: update SSE-clear deferred item
```

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- Pre-existing TS errors and test failures (voice, day-overrides, households, plan-regeneration test harness, DisambiguationPicker) confirmed to exist on main branch baseline; not regressions from this story.

### Completion Notes List

- T1: `HardFailStatusSchema` extended with `failed_at: z.string().datetime()`. `GetPlansResponseSchema.hard_fail` unchanged (already references the schema via `.nullable().optional()`).
- T2: `PlansRepository.findHardFailAudit()` SELECT extended to `'id, created_at'`; return type flipped from `boolean` to `{ failedAt: string } | null`.
- T3: `PlansService.getHardFailStatus()` returns `{ week_of, failed_at } | null` by mapping the repo's `failedAt` → `failed_at` and re-supplying `weekOf`.
- T4: GET /v1/plans handler's `hardFail` is now `{ week_of, failed_at } | null`; the existing try/catch wraps the call unchanged (catch fallback degrades to `null`).
- T5: `HardFailStatus` re-export via `z.infer<>` picks up `failed_at` automatically; contracts `tsc --noEmit` is clean.
- T6: `FreshnessVariant` gains `'reworking'`; `failedAt?: string` prop added; `STATIC_MESSAGES` exclusion updated; `formatEstimatedRecovery` exported for unit-test use; reworking branch renders `<p role="status" aria-live="polite" class="text-fg-muted">` with the AC4 copy.
- T7: `PlanPage.tsx` replaces `<AccountableError />` with `<FreshnessState variant="reworking" failedAt={data.hard_fail?.failed_at} />` and drops the `AccountableError` import.
- T8: `AccountableError.tsx` and `AccountableError.test.tsx` deleted. Grep across `apps/web/src/` confirmed no remaining imports.
- T9: Test updates:
  - `FreshnessState.test.tsx`: new reworking-variant describe (6 tests) + `formatEstimatedRecovery` describe (4 tests); existing multi-variant `role="status"` test extended to include `reworking`. 19/19 pass.
  - `plans.repository.test.ts`: `findHardFailAudit` tests now assert `{ failedAt }` and `null` shapes; SELECT step asserts `'id, created_at'`. All 3 tests pass.
  - `plans.service.test.ts`: `getHardFailStatus` test asserts `{ week_of, failed_at }` payload + new null-passthrough test.
  - `plans.routes.test.ts`: `buildMockService` default flipped to `null`; "present when true" test asserts `hard_fail.failed_at` is the ISO datetime string; draft-skip and plan-present-skip tests updated to new mock shape.
  - `packages/contracts/src/plan.test.ts`: GetPlansResponseSchema hard-fail fixture extended with `failed_at`; new `HardFailStatusSchema` describe block covers happy-path + missing-`failed_at` rejection + non-ISO-datetime rejection.
  - `apps/web/test/e2e/3-25-hard-fail-escalation.spec.ts`: E2E updated for the new reworking copy + the new `failed_at` payload shape (was asserting the old AccountableError copy "our ops team is reviewing"; would have regressed otherwise).
- T10: All test files I touched pass — 171/171 contracts (plan.test.ts), 120/120 api (3 plans test files), 19/19 web (FreshnessState.test.tsx). `tsc --noEmit` is clean on contracts and web. Pre-existing failures (cultural, day-override, voice, brief-state.composer, plan-adjustment, DisambiguationPicker, etc.) confirmed against baseline via `git stash` — not regressions.
- T11: sprint-status flipped `3-26 → review`; deferred-work SSE-clear entry updated to reference `<FreshnessState variant="reworking">` and `apps/web/src/features/plan/FreshnessState.tsx`.

### File List

**Modified:**
- `packages/contracts/src/plan.ts` (T1)
- `packages/contracts/src/plan.test.ts` (T9)
- `apps/api/src/modules/plans/plans.repository.ts` (T2)
- `apps/api/src/modules/plans/plans.repository.test.ts` (T9)
- `apps/api/src/modules/plans/plans.service.ts` (T3)
- `apps/api/src/modules/plans/plans.service.test.ts` (T9)
- `apps/api/src/modules/plans/plans.routes.ts` (T4)
- `apps/api/src/modules/plans/plans.routes.test.ts` (T9)
- `apps/web/src/features/plan/FreshnessState.tsx` (T6)
- `apps/web/src/features/plan/FreshnessState.test.tsx` (T9)
- `apps/web/src/features/plan/PlanPage.tsx` (T7)
- `apps/web/test/e2e/3-25-hard-fail-escalation.spec.ts` (regression fix from T8/copy change)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (T11)
- `_bmad-output/implementation-artifacts/deferred-work.md` (T11)

**Deleted:**
- `apps/web/src/features/plan/AccountableError.tsx` (T8)
- `apps/web/src/features/plan/AccountableError.test.tsx` (T8)

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-25 | Menon | Story 3.26 authored — ready-for-dev. Rewrote stale placeholder; aligned to actual post-3.25 codebase. |
| 2026-05-25 | Claude Opus 4.7 | Story 3.26 implemented end-to-end. Added `failed_at` to `HardFailStatusSchema`, threaded it through repo/service/route. Added `FreshnessState variant="reworking"` with `formatEstimatedRecovery` helper. Deleted provisional `AccountableError` files. All AC1–AC11 satisfied; 310 tests pass across the modified files. → review. |
