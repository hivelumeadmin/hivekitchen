# Story 3.28: Pause Lunch Link for Child on Day Without Altering Plan

Status: done

## Story

As a Primary Parent,
I want to pause the Lunch Link for a specific child on a specific day without altering the underlying plan,
So that a sick day doesn't trigger Lunch Link delivery but the plan history remains intact (FR20).

## Acceptance Criteria

1. **Given** Stories 3.5 + Epic 4 lunch_link infrastructure exist,
   **When** I tap "Pause Lunch Link" on a (child, day),
   **Then** `lunch_link_sessions` row marked `suppressed_at`; SendGrid/Twilio job skips delivery; underlying plan_item retained for history.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `plan_items` table with `paused_at` column (sick-day pause stops Lunch Link delivery per Story 3.12); this story adds a more targeted mechanism at the `lunch_link_sessions` level
- Story 3.12: `plan_items.paused_at` — sick-day marking already marks the item as paused; this story provides an additional control at the delivery layer specifically for Lunch Link suppression without touching the plan item
- Epic 4 Story 4.1: `lunch_link_sessions(child_id, date, nonce, exp, first_opened_at, rating_submitted_at, rating, reopened_after_exp_count, suppressed_at)` — the `suppressed_at` column is defined in Epic 4's migration; this story depends on it being present

**Epic 4 Dependency Note:**
Story 4.1 is not yet implemented. Before implementing the core of this story, verify whether `lunch_link_sessions` exists in the database. If not:
- Create a **minimal stub migration** for `lunch_link_sessions` with only the columns needed by this story: `(id, household_id, child_id, date, suppressed_at, suppressed_by_user_id, created_at)`
- Document this as a forward-compatible stub in the migration comment — Epic 4 Story 4.1 will expand the table with full HMAC and rating columns
- Do NOT implement the full HMAC URL generation or rating mechanics from Epic 4

**Key invariants:**
- "Pause Lunch Link" suppresses delivery only — the underlying `plan_item` is unchanged, retained for history
- This is distinct from `plan_items.paused_at` (sick-day plan pause): that affects the plan item; this affects the delivery session
- `suppressed_at` on `lunch_link_sessions` is the canonical delivery skip signal
- The delivery job (`lunch-link-delivery.job.ts`) checks `suppressed_at IS NOT NULL` and skips
- Suppression can be undone before the delivery window (un-suppress); after delivery window, it's moot
- All DB access through API layer only
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — Verify or stub `lunch_link_sessions` table

**Option A (preferred):** If Epic 4 Story 4.1 is already implemented and the migration exists, skip to Task 2.

**Option B (if Epic 4 is not yet done):** Create `supabase/migrations/20260840000000_create_lunch_link_sessions_stub.sql`:

```sql
-- Story 3.28: minimal stub for lunch_link_sessions.
-- Epic 4 Story 4.1 will expand this table with HMAC, rating, and full delivery columns.
-- This stub exists only to support Lunch Link suppression (suppressed_at).
-- Forward-compatible: Epic 4's migration uses CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS lunch_link_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          UUID NOT NULL,
  child_id              UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  -- The school day this session covers (date only, no time — delivery window is computed per-timezone).
  date                  DATE NOT NULL,
  -- Suppression: set when parent pauses Lunch Link for this (child, date).
  suppressed_at         TIMESTAMPTZ,
  suppressed_by_user_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uniqueness: one session per (child, date).
  CONSTRAINT uq_lunch_link_sessions_child_date UNIQUE (child_id, date)
);

CREATE INDEX idx_lunch_link_sessions_household_date
  ON lunch_link_sessions(household_id, date);
```

### Task 2 — Contracts: Lunch Link pause schemas

In `packages/contracts/src/plan.ts` (or a new `lunch-link.ts`):

```typescript
// POST /v1/children/:childId/lunch-link-pause body
export const LunchLinkPauseInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  // If provided, un-suppress a previously suppressed session.
  suppress: z.boolean().default(true),
});

export const LunchLinkPauseResponseSchema = z.object({
  child_id: z.string().uuid(),
  date: z.string(),
  suppressed: z.boolean(),
  suppressed_at: z.string().datetime().nullable(),
});
```

### Task 3 — `LunchLinkSessionRepository`

Create `apps/api/src/modules/plans/lunch-link-session.repository.ts`:

```typescript
export class LunchLinkSessionRepository {
  constructor(private readonly client: SupabaseClient) {}

  // Create or update the suppressed_at on a lunch_link_session row.
  async suppress(opts: {
    householdId: string;
    childId: string;
    date: string;       // YYYY-MM-DD
    userId: string;
  }): Promise<void> {
    const { error } = await this.client
      .from('lunch_link_sessions')
      .upsert(
        {
          household_id: opts.householdId,
          child_id: opts.childId,
          date: opts.date,
          suppressed_at: new Date().toISOString(),
          suppressed_by_user_id: opts.userId,
        },
        { onConflict: 'child_id,date' },
      );
    if (error) throw error;
  }

  // Clear suppression (un-pause).
  async unsuppress(opts: { householdId: string; childId: string; date: string }): Promise<void> {
    const { error } = await this.client
      .from('lunch_link_sessions')
      .update({ suppressed_at: null, suppressed_by_user_id: null })
      .eq('household_id', opts.householdId)
      .eq('child_id', opts.childId)
      .eq('date', opts.date);
    if (error) throw error;
  }

  async findByChildAndDate(childId: string, date: string): Promise<{ suppressed_at: string | null } | null> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('suppressed_at')
      .eq('child_id', childId)
      .eq('date', date)
      .maybeSingle();
    if (error) throw error;
    return data as { suppressed_at: string | null } | null;
  }

  // Used by the delivery job to skip suppressed sessions.
  async findSuppressedForDate(date: string): Promise<Array<{ child_id: string; household_id: string }>> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('child_id, household_id')
      .eq('date', date)
      .not('suppressed_at', 'is', null);
    if (error) throw error;
    return (data ?? []) as Array<{ child_id: string; household_id: string }>;
  }
}
```

### Task 4 — Route: `POST /v1/children/:childId/lunch-link-pause`

In `apps/api/src/modules/children/children.routes.ts`:

```typescript
fastify.post(
  '/v1/children/:childId/lunch-link-pause',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      params: z.object({ childId: z.string().uuid() }),
      body: LunchLinkPauseInputSchema,
      response: { 200: LunchLinkPauseResponseSchema },
    },
  },
  async (request, reply) => {
    const { childId } = request.params as { childId: string };
    const body = request.body as LunchLinkPauseInput;

    // Ownership check: verify childId belongs to this household.
    const child = await fastify.childrenRepository.findByIdAndHousehold(
      childId,
      request.user.household_id,
    );
    if (!child) throw new NotFoundError('Child not found');

    if (body.suppress) {
      await fastify.lunchLinkSessionRepository.suppress({
        householdId: request.user.household_id,
        childId,
        date: body.date,
        userId: request.user.user_id,
      });
    } else {
      await fastify.lunchLinkSessionRepository.unsuppress({
        householdId: request.user.household_id,
        childId,
        date: body.date,
      });
    }

    try {
      await fastify.auditService.write({
        event_type: body.suppress ? 'lunch_link.suppressed' : 'lunch_link.unsuppressed',
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { child_id: childId, date: body.date },
      });
    } catch (err) {
      request.log.error({ err }, 'audit write failed for lunch_link.suppressed');
    }

    const session = await fastify.lunchLinkSessionRepository.findByChildAndDate(childId, body.date);

    return reply.send({
      child_id: childId,
      date: body.date,
      suppressed: session?.suppressed_at != null,
      suppressed_at: session?.suppressed_at ?? null,
    });
  },
);
```

### Task 5 — Update delivery job to check `suppressed_at`

In `apps/api/src/jobs/lunch-link-delivery.job.ts` (if it exists from Epic 4 forward work) or document the check for when Epic 4 implements the delivery job:

```typescript
// At the start of the delivery loop for each (child, date):
const session = await lunchLinkSessionRepository.findByChildAndDate(child.id, deliveryDate);
if (session?.suppressed_at) {
  logger.info({ childId: child.id, date: deliveryDate }, 'lunch_link delivery suppressed — skipping');
  continue; // Skip SendGrid/Twilio dispatch for this child
}
```

If `lunch-link-delivery.job.ts` doesn't exist yet (Epic 4 not done), add a comment to `plans.hook.ts` documenting the suppression check requirement for when the delivery job is built.

### Task 6 — Frontend: "Pause Lunch Link" affordance on `<PlanTile>`

In `apps/web/src/features/plan/PlanTile.tsx`, add a context-menu or secondary action for upcoming/today tiles:

The "Pause Lunch Link" option appears in the tile's secondary action menu for days where:
- The day is today or upcoming (not past)
- The slot is `main` (Lunch Link covers the whole lunch, not a slot)
- The child has Snack or Extra active (Main is always present)

```typescript
// In PlanTile secondary actions menu:
{isTodayOrUpcoming && (
  <button
    type="button"
    onClick={() => onPauseLunchLink({ childId: tile.child_id, date: tile.date })}
    className="font-sans text-[14px] text-warm-neutral-700 hover:text-terracotta-700 text-start"
  >
    {tile.lunch_link_suppressed ? 'Resume Lunch Link' : 'Pause Lunch Link'}
  </button>
)}
```

The `lunch_link_suppressed` field should be included in the `plan_tile_summaries` JSONB in `brief_state` — update `brief-state.composer.ts` to include the suppression state per tile.

### Task 7 — Update `brief-state.composer.ts` to include suppression state

In `apps/api/src/modules/plans/brief-state.composer.ts`, when composing `plan_tile_summaries`, include:

```typescript
// For each plan item, check if the corresponding lunch_link_session is suppressed.
const session = await lunchLinkSessionRepository.findByChildAndDate(item.child_id, item.day);
tileSummary.lunch_link_suppressed = session?.suppressed_at != null;
```

### Task 8 — Audit event types

```typescript
'lunch_link.suppressed',
'lunch_link.unsuppressed',
```

### Task 9 — Tests

**`lunch-link-session.repository.test.ts` (new):**
- `suppress()` — upserts row; `findByChildAndDate()` shows `suppressed_at` set
- `unsuppress()` — clears `suppressed_at`; `findByChildAndDate()` shows null
- `findSuppressedForDate()` — returns only suppressed sessions for a given date
- Duplicate `suppress()` on same (child, date) — upsert does not error

**`children.routes.test.ts` (extend):**
- POST lunch-link-pause with `suppress: true` → 200, `suppressed: true`
- POST lunch-link-pause with `suppress: false` → 200, `suppressed: false`
- Child from different household → 404
- Secondary caregiver can pause (not primary-parent-only)

---

## Dev Notes

### `plan_items.paused_at` vs `lunch_link_sessions.suppressed_at`

Two separate mechanisms for "not delivering today":
1. **`plan_items.paused_at`** (Story 3.12): marks the plan item as on sick-day pause — affects plan history and any plan-dependent features
2. **`lunch_link_sessions.suppressed_at`** (this story): marks the delivery session as suppressed — only affects the SendGrid/Twilio dispatch, not the plan item itself

A parent can:
- Pause the plan item (sick day — "don't plan, don't deliver")
- Suppress Lunch Link only ("deliver the plan as-is but skip sending the link today")

Both can be set simultaneously. They are independent.

### Epic 4 forward compatibility

When Epic 4 Story 4.1 ships, it will expand `lunch_link_sessions` with HMAC, rating, and delivery-status columns. The stub migration uses `CREATE TABLE IF NOT EXISTS`, and Epic 4's migration should use `ADD COLUMN IF NOT EXISTS`. This story's columns (`suppressed_at`, `suppressed_by_user_id`) are part of the Epic 4 spec, so no conflict is expected.

The `LunchLinkSessionRepository` created here is the right home for all delivery-session reads/writes — Epic 4 should extend this class rather than creating a parallel one.

### Secondary caregiver can suppress

Both `primary_parent` and `secondary_caregiver` can pause Lunch Link. The pickup parent (secondary caregiver) often knows about sick days before the primary parent updates the app.

---

## Project Structure

**New files:**
```
apps/api/src/modules/plans/lunch-link-session.repository.ts
apps/api/src/modules/plans/lunch-link-session.repository.test.ts
supabase/migrations/20260840000000_create_lunch_link_sessions_stub.sql  (only if Epic 4 not yet done)
```

**Modified files:**
```
packages/contracts/src/plan.ts (or lunch-link.ts)          + LunchLinkPauseInputSchema, LunchLinkPauseResponseSchema
packages/types/src/index.ts                                  + LunchLinkPauseInput, LunchLinkPauseResponse types
apps/api/src/audit/audit.types.ts                            + lunch_link.suppressed, lunch_link.unsuppressed
apps/api/src/modules/children/children.routes.ts             + POST /v1/children/:childId/lunch-link-pause
apps/api/src/modules/plans/plans.hook.ts                     + LunchLinkSessionRepository wired
apps/api/src/modules/plans/brief-state.composer.ts           + lunch_link_suppressed in plan_tile_summaries
apps/web/src/features/plan/PlanTile.tsx                      + "Pause Lunch Link" secondary action
_bmad-output/implementation-artifacts/sprint-status.yaml     3-28 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md       + Epic 4 delivery job suppression check documentation
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.28 created — ready-for-dev. |
| 2026-05-21 | Dev Agent | All tasks implemented: stub migration, contracts (LunchLinkPauseInputSchema/ResponseSchema), LunchLinkSessionRepository, POST /v1/children/:childId/lunch-link-pause, brief-state.composer suppression map, PlanTile "Pause/Resume Lunch Link" affordance, PlanTileSummarySchema lunch_link_suppressed field, audit event types, full test suites (repository + route). |
