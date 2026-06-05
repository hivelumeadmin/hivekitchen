# Story 7-S7: Annual Flavor Journey Reset

Status: done

## Story

As a Primary Parent,
I want to initiate a "reset flavor journey" purge of all child-associated artifacts once per year without closing the account,
so that family circumstances change (divorce, cultural identity shift, age progression) without forcing me to recreate the household (FR68).

## Acceptance Criteria

1. **Given** the Primary Parent is on a child's FlavorPassport page (`/app/children/:childId/flavor-passport`), **When** the page finishes loading, **Then** a "Reset [child name]'s flavor journey" button is visible below the passport content (or in the empty-passport state).

2. **Given** the reset button is clicked, **When** no cooldown is active, **Then** a confirmation modal (`<Dialog>`) opens with:
   - Title: `"Reset [child name]'s flavor journey"`
   - Body: `"All learned preferences, cultural priors, and FlavorPassport stamps will be soft-forgotten. This action takes 30 days to become permanent and can be done once per year."`
   - Primary CTA: `"Reset journey"` (destructive-style bordered button)
   - Cancel: muted text action that closes the modal

3. **Given** the confirmation modal is open and the parent clicks "Reset journey", **When** the API returns `200`, **Then** the modal closes, the passport content clears to empty, and an inline confirmation `"Flavor journey reset on [date]"` is shown.

4. **Given** `POST /v1/children/:id/reset-flavor-journey` is called with `children.flavor_journey_reset_at` NULL or > 365 days ago, **When** the request is processed, **Then** the server:
   - Sets `soft_forget_at = NOW()` on all `memory_nodes` where `subject_child_id = childId AND household_id = householdId AND soft_forget_at IS NULL`
   - Deletes all `child_preferences` where `child_id = childId AND household_id = householdId`
   - Updates `children.flavor_journey_reset_at = NOW()`
   - Writes a best-effort `child.flavor_journey_reset` audit event
   - Returns `{ child_id, reset_at }` (ISO 8601 timestamp) with `200 OK`

5. **Given** `children.flavor_journey_reset_at` is within the last 365 days, **When** the parent calls the endpoint, **Then** the API returns `409 Conflict` with a detail message including the last reset date.

6. **Given** the API returns 409, **When** the web client receives it, **Then** the modal closes and an inline error shows `"Already reset on [date]. You can reset again after [next eligible date]."`.

7. **Given** the `childId` in the URL does not belong to the caller's household, **When** the API processes the request, **Then** it returns `404 Not Found` (no existence oracle leak across households).

8. **Given** the reset has been applied, **When** the planner's next `memory.recall` tool call executes for this household, **Then** zero nodes for this child are returned (all are soft-forgotten → excluded by the `IS NULL` filter in `findNodes`).

9. **Given** a `secondary_caregiver` calls `POST /v1/children/:id/reset-flavor-journey`, **When** the authorization preHandler runs, **Then** the API returns `403 Forbidden` (Primary Parent only — irreversible annual action).

---

## Tasks / Subtasks

### Task 1 — DB Migrations (AC: #4, #5)

Two new migration files:

**`supabase/migrations/20260607000000_children_flavor_journey_reset_at.sql`**
```sql
-- Story 7-S7: track the last annual flavor-journey reset per child.
-- NULL = never reset. 365-day cooldown is enforced at the application layer.
ALTER TABLE children ADD COLUMN flavor_journey_reset_at timestamptz NULL;
```

**`supabase/migrations/20260607000100_add_child_flavor_journey_reset_audit_type.sql`**
```sql
-- Story 7-S7: audit event for the annual flavor-journey reset action.
-- TypeScript mirror: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'child.flavor_journey_reset';
```

---

### Task 2 — Contracts (`packages/contracts/src/children.ts`) (AC: #3, #4)

Append to the file (after `SetBagCompositionResponseSchema`):

```typescript
// Story 7-S7 — response for the annual flavor-journey reset.
export const ResetFlavorJourneyResponseSchema = z.object({
  child_id: z.string().uuid(),
  reset_at: z.string().datetime({ offset: true }),
});
export type ResetFlavorJourneyResponse = z.infer<typeof ResetFlavorJourneyResponseSchema>;
```

**`packages/types/src/index.ts`** — add the schema import and type export alongside the existing children types:
```typescript
// In the import block:
import {
  // ... existing children imports ...
  ResetFlavorJourneyResponseSchema,
} from '@hivekitchen/contracts';

// In the export block:
export type ResetFlavorJourneyResponse = z.infer<typeof ResetFlavorJourneyResponseSchema>;
```

---

### Task 3 — Audit types (`apps/api/src/audit/audit.types.ts`) (AC: #4)

Add `'child.flavor_journey_reset'` to the `AUDIT_EVENT_TYPES` array, in the `// children` section:

```typescript
// children
'child.add',
'child.bag_updated',
'child.extra_rules_updated',
'child.flavor_journey_reset',  // Story 7-S7
```

---

### Task 4 — `MemoryRepository` additions (`apps/api/src/modules/memory/memory.repository.ts`) (AC: #4)

Add after the existing `hardDeleteSoftForgotten` method:

```typescript
// Story 7-S7 — bulk soft-forget all child-associated memory nodes.
// Scoped to subject_child_id + household_id; the IS NULL guard is idempotent
// (already soft-forgotten nodes are not double-stamped).
// Returns the count of rows that were updated.
async softForgetChildNodes(
  childId: string,
  householdId: string,
  softForgetAt: string,
): Promise<number> {
  const { data, error } = await this.client
    .from('memory_nodes')
    .update({ soft_forget_at: softForgetAt })
    .eq('subject_child_id', childId)
    .eq('household_id', householdId)
    .is('soft_forget_at', null)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}
```

---

### Task 5 — `ChildPreferencesRepository` additions (`apps/api/src/modules/child-preferences/child-preferences.repository.ts`) (AC: #4)

Add after the existing `getVariantEligibleChildIds` method:

```typescript
// Story 7-S7 — delete all preference signals for one child as part of the
// annual flavor-journey reset. This is a hard delete (not soft) because
// child_preferences are ephemeral rating signals, not authored prose memories.
// Returns the count of deleted rows.
async deleteByChild(childId: string, householdId: string): Promise<number> {
  const { data, error } = await this.client
    .from('child_preferences')
    .delete()
    .eq('child_id', childId)
    .eq('household_id', householdId)
    .select('recipe_id');
  if (error) throw error;
  return (data ?? []).length;
}
```

---

### Task 6 — `ChildrenRepository` additions (`apps/api/src/modules/children/children.repository.ts`) (AC: #5, #7)

Add TWO new methods after the existing `findById` method:

```typescript
// Story 7-S7 — read the last reset timestamp for the 365-day cooldown check.
// Returns null when the column is NULL or the child does not exist in this
// household. The route performs a subsequent findById for the 404 guard so
// this method only needs to return the scalar.
async getFlavorJourneyResetAt(childId: string, householdId: string): Promise<string | null> {
  const { data, error } = await this.client
    .from('children')
    .select('flavor_journey_reset_at')
    .eq('id', childId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw error;
  return (data as { flavor_journey_reset_at: string | null } | null)?.flavor_journey_reset_at ?? null;
}

// Story 7-S7 — stamp the reset timestamp after the cascade completes.
async setFlavorJourneyResetAt(childId: string, householdId: string, resetAt: string): Promise<void> {
  const { error } = await this.client
    .from('children')
    .update({ flavor_journey_reset_at: resetAt })
    .eq('id', childId)
    .eq('household_id', householdId);
  if (error) throw error;
}
```

---

### Task 7 — `FlavorJourneyResetService` (new file: `apps/api/src/modules/children/flavor-journey-reset.service.ts`) (AC: #4, #5, #7)

Create this new file:

```typescript
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { ChildrenRepository } from './children.repository.js';
import type { MemoryRepository } from '../memory/memory.repository.js';
import type { ChildPreferencesRepository } from '../child-preferences/child-preferences.repository.js';

const COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;

export interface FlavorJourneyResetDeps {
  childrenRepository: ChildrenRepository;
  memoryRepository: MemoryRepository;
  childPreferencesRepository: ChildPreferencesRepository;
  logger: FastifyBaseLogger;
  audit?: AuditService;
}

export type FlavorJourneyResetOutcome =
  | { type: 'not_found' }
  | { type: 'cooldown_active'; last_reset_at: string }
  | { type: 'ok'; child_id: string; reset_at: string };

export class FlavorJourneyResetService {
  constructor(private readonly deps: FlavorJourneyResetDeps) {}

  async reset(
    childId: string,
    householdId: string,
    userId: string,
    requestId: string,
  ): Promise<FlavorJourneyResetOutcome> {
    // Verify child ownership. 404 guard: returns null when child is absent
    // or belongs to a different household (no existence oracle).
    const child = await this.deps.childrenRepository.findById(householdId, childId);
    if (child === null) return { type: 'not_found' };

    // 365-day cooldown check.
    const lastResetAt = await this.deps.childrenRepository.getFlavorJourneyResetAt(
      childId,
      householdId,
    );
    if (lastResetAt !== null) {
      const elapsedMs = Date.now() - new Date(lastResetAt).getTime();
      if (elapsedMs < COOLDOWN_MS) {
        return { type: 'cooldown_active', last_reset_at: lastResetAt };
      }
    }

    const resetAt = new Date().toISOString();

    // Cascade 1: soft-forget all child-associated memory nodes.
    // The nightly memory-forget.job.ts (7-S5) will hard-delete them after 30 days.
    await this.deps.memoryRepository.softForgetChildNodes(childId, householdId, resetAt);

    // Cascade 2: hard-delete all child preference signals.
    // child_preferences are ephemeral emoji-rating signals — no recovery window needed.
    await this.deps.childPreferencesRepository.deleteByChild(childId, householdId);

    // Stamp the cooldown timestamp last so a failed cascade does not activate the
    // cooldown and leave the child in a partially-reset state.
    await this.deps.childrenRepository.setFlavorJourneyResetAt(childId, householdId, resetAt);

    // Best-effort audit: a failure here must not fail the reset.
    if (this.deps.audit) {
      try {
        await this.deps.audit.write({
          event_type: 'child.flavor_journey_reset',
          household_id: householdId,
          user_id: userId,
          request_id: requestId,
          metadata: { child_id: childId },
        });
      } catch (err) {
        this.deps.logger.warn(
          { err, module: 'flavor-journey-reset', child_id: childId },
          'audit write failed for flavor journey reset — reset succeeded',
        );
      }
    }

    return { type: 'ok', child_id: childId, reset_at: resetAt };
  }
}
```

---

### Task 8 — `children.routes.ts`: new POST route + service wiring (AC: #3–#9)

Add to `apps/api/src/modules/children/children.routes.ts`:

**Imports** (add at top alongside existing imports):
```typescript
import { ResetFlavorJourneyResponseSchema } from '@hivekitchen/contracts';
import { MemoryRepository } from '../memory/memory.repository.js';
import { FlavorJourneyResetService } from './flavor-journey-reset.service.js';
```

**Service instantiation** (inside `childrenRoutesPlugin`, after `flavorPassportService`):
```typescript
// Story 7-S7 — flavor-journey reset service.
const flavorJourneyResetService = new FlavorJourneyResetService({
  childrenRepository,
  memoryRepository: new MemoryRepository(fastify.supabase),
  childPreferencesRepository,
  logger: fastify.log,
  audit: fastify.auditService,
});
```

**Route registration** (add BEFORE the closing brace of `childrenRoutesPlugin`):
```typescript
// Story 7-S7 — POST /v1/children/:childId/reset-flavor-journey
// Primary Parent only — irreversible annual action.
// 409 when called within 365 days of the previous reset.
// 404 when childId does not belong to the caller's household (no oracle).
fastify.post(
  '/v1/children/:childId/reset-flavor-journey',
  {
    preHandler: requirePrimaryParent,
    schema: {
      params: z.object({ childId: z.string().uuid() }),
      response: { 200: ResetFlavorJourneyResponseSchema },
    },
  },
  async (request, reply) => {
    const { childId } = request.params as { childId: string };
    const householdId = request.user.household_id;

    const outcome = await flavorJourneyResetService.reset(
      childId,
      householdId,
      request.user.id,
      request.id,
    );

    if (outcome.type === 'not_found') throw new NotFoundError(`child not found: ${childId}`);
    if (outcome.type === 'cooldown_active') {
      throw new ConflictError(
        `flavor journey was already reset on ${outcome.last_reset_at}`,
      );
    }

    return reply.status(200).send({
      child_id: outcome.child_id,
      reset_at: outcome.reset_at,
    });
  },
);
```

---

### Task 9 — `FlavorJourneyResetService` tests (new file: `apps/api/src/modules/children/flavor-journey-reset.service.test.ts`) (AC: #4, #5, #7)

Create comprehensive unit tests covering all outcome branches:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlavorJourneyResetService } from './flavor-journey-reset.service.js';

const CHILD_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

function makeChild() {
  return { id: CHILD_ID, household_id: HOUSEHOLD_ID, name: 'Layla' } as never;
}

function makeDeps(overrides: Partial<Parameters<typeof FlavorJourneyResetService.prototype.reset>> extends [] ? never : object = {}) {
  const childrenRepository = {
    findById: vi.fn().mockResolvedValue(makeChild()),
    getFlavorJourneyResetAt: vi.fn().mockResolvedValue(null),
    setFlavorJourneyResetAt: vi.fn().mockResolvedValue(undefined),
  };
  const memoryRepository = {
    softForgetChildNodes: vi.fn().mockResolvedValue(3),
  };
  const childPreferencesRepository = {
    deleteByChild: vi.fn().mockResolvedValue(5),
  };
  const audit = { write: vi.fn().mockResolvedValue(undefined) };
  const logger = { warn: vi.fn() } as never;
  return {
    childrenRepository,
    memoryRepository,
    childPreferencesRepository,
    audit,
    logger,
    ...overrides,
  };
}

describe('FlavorJourneyResetService', () => {
  describe('not_found', () => {
    it('returns not_found when child does not exist in household', async () => {
      const deps = makeDeps();
      deps.childrenRepository.findById.mockResolvedValue(null);
      const svc = new FlavorJourneyResetService(deps as never);
      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);
      expect(result).toEqual({ type: 'not_found' });
    });
  });

  describe('cooldown_active', () => {
    it('returns cooldown_active when last_reset_at is within 365 days', async () => {
      const deps = makeDeps();
      const recentDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      deps.childrenRepository.getFlavorJourneyResetAt.mockResolvedValue(recentDate);
      const svc = new FlavorJourneyResetService(deps as never);
      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);
      expect(result).toEqual({ type: 'cooldown_active', last_reset_at: recentDate });
    });
  });

  describe('ok', () => {
    it('proceeds when last_reset_at is null (never reset)', async () => {
      const deps = makeDeps();
      const svc = new FlavorJourneyResetService(deps as never);
      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);
      expect(result.type).toBe('ok');
      expect(deps.memoryRepository.softForgetChildNodes).toHaveBeenCalledWith(
        CHILD_ID,
        HOUSEHOLD_ID,
        expect.any(String),
      );
      expect(deps.childPreferencesRepository.deleteByChild).toHaveBeenCalledWith(
        CHILD_ID,
        HOUSEHOLD_ID,
      );
      expect(deps.childrenRepository.setFlavorJourneyResetAt).toHaveBeenCalledWith(
        CHILD_ID,
        HOUSEHOLD_ID,
        expect.any(String),
      );
    });

    it('proceeds when last_reset_at is exactly 365 days ago', async () => {
      const deps = makeDeps();
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 - 1).toISOString();
      deps.childrenRepository.getFlavorJourneyResetAt.mockResolvedValue(oldDate);
      const svc = new FlavorJourneyResetService(deps as never);
      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);
      expect(result.type).toBe('ok');
    });

    it('writes audit event on success', async () => {
      const deps = makeDeps();
      const svc = new FlavorJourneyResetService(deps as never);
      await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);
      expect(deps.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'child.flavor_journey_reset',
          household_id: HOUSEHOLD_ID,
          user_id: USER_ID,
          metadata: { child_id: CHILD_ID },
        }),
      );
    });

    it('does not throw if audit write fails (best-effort)', async () => {
      const deps = makeDeps();
      deps.audit.write.mockRejectedValue(new Error('db error'));
      const svc = new FlavorJourneyResetService(deps as never);
      await expect(svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID)).resolves.toMatchObject({
        type: 'ok',
      });
    });

    it('stamps cooldown after cascade completes, not before', async () => {
      const deps = makeDeps();
      const order: string[] = [];
      deps.memoryRepository.softForgetChildNodes.mockImplementation(async () => {
        order.push('memory');
        return 0;
      });
      deps.childPreferencesRepository.deleteByChild.mockImplementation(async () => {
        order.push('prefs');
        return 0;
      });
      deps.childrenRepository.setFlavorJourneyResetAt.mockImplementation(async () => {
        order.push('stamp');
      });
      const svc = new FlavorJourneyResetService(deps as never);
      await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);
      expect(order).toEqual(['memory', 'prefs', 'stamp']);
    });
  });
});
```

**Estimated test count:** 7 new service tests.

---

### Task 10 — Children route tests (add to `apps/api/src/modules/children/children.routes.test.ts`) (AC: #3–#9)

Add a new `describe('POST /v1/children/:childId/reset-flavor-journey (7-S7)')` block to the existing test file. The block needs a mock `FlavorJourneyResetService` injected via constructor override.

**Test cases to cover:**
- `200` on success (ok outcome) — response shape matches `ResetFlavorJourneyResponseSchema`
- `404` on not_found outcome
- `409` on cooldown_active outcome — detail contains the last_reset_at date
- `401` when no auth token
- `403` when caller has `secondary_caregiver` role
- `400` when `childId` is not a valid UUID

**Estimated test count:** 6 new route tests.

---

### Task 11 — Web: `child-flavor-passport.tsx` reset button + dialog (AC: #1–#3, #6)

File: `apps/web/src/routes/(app)/child-flavor-passport.tsx`

**Imports to add:**
```typescript
import { ResetFlavorJourneyResponseSchema } from '@hivekitchen/contracts';
import { Dialog } from '@/components/Dialog.js';
```

**New state** (add after existing state declarations):
```typescript
const [showResetModal, setShowResetModal] = useState(false);
const [isResetting, setIsResetting] = useState(false);
const [resetError, setResetError] = useState<string | null>(null);
const [resetAt, setResetAt] = useState<string | null>(null);
```

**Handler** (add after existing handlers):
```typescript
async function handleResetConfirm() {
  if (!childId || isResetting) return;
  setIsResetting(true);
  setResetError(null);
  try {
    const raw = await hkFetch<unknown>(
      `/v1/children/${childId}/reset-flavor-journey`,
      { method: 'POST' },
    );
    const parsed = ResetFlavorJourneyResponseSchema.parse(raw);
    setResetAt(parsed.reset_at);
    setPassport((prev) => (prev === null ? null : { ...prev, stamps: [] }));
    setShowResetModal(false);
  } catch (err) {
    if (err instanceof HkApiError && err.status === 409) {
      // Parse the date from the ConflictError detail: "flavor journey was already reset on <ISO>"
      const match = err.message.match(/reset on (.+)$/);
      const date = match ? new Date(match[1]).toLocaleDateString() : 'a recent date';
      const eligible = match
        ? new Date(new Date(match[1]).getTime() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString()
        : 'a year from now';
      setResetError(`Already reset on ${date}. You can reset again after ${eligible}.`);
      setShowResetModal(false);
    } else {
      setResetError('Could not reset flavor journey. Please try again later.');
      setShowResetModal(false);
    }
  } finally {
    setIsResetting(false);
  }
}
```

**Reset confirmation text** (add a stable ID for the dialog; use `useId()` imported from React):
```typescript
const resetModalId = useId();
const resetModalDescId = `${resetModalId}-desc`;
```

**JSX additions** — below the passport content (or empty state), before closing `</main>`:
```tsx
{/* 7-S7 — annual reset */}
{resetAt !== null && (
  <p className="mt-4 font-sans text-sm text-fg-muted">
    Flavor journey reset on {new Date(resetAt).toLocaleDateString()}.
  </p>
)}
{resetError !== null && (
  <p role="alert" className="mt-4 font-sans text-sm text-fg-muted">
    {resetError}
  </p>
)}
<div className="mt-8 border-t border-border pt-6">
  <button
    type="button"
    onClick={() => { setResetError(null); setShowResetModal(true); }}
    className="font-sans text-sm text-fg-muted hover:text-fg transition-colors rounded border border-warm-neutral-400 px-4 py-2"
  >
    Reset {childName ? `${childName}'s` : "this child's"} flavor journey
  </button>
</div>

<Dialog
  open={showResetModal}
  onClose={() => setShowResetModal(false)}
  titleId={resetModalId}
  descriptionId={resetModalDescId}
>
  <h2 id={resetModalId} className="font-serif text-xl text-fg mb-3">
    Reset {childName ? `${childName}'s` : "this child's"} flavor journey
  </h2>
  <p id={resetModalDescId} className="font-sans text-sm text-fg-muted leading-relaxed mb-6">
    All learned preferences, cultural priors, and FlavorPassport stamps will be
    soft-forgotten. This action takes 30 days to become permanent and can be done
    once per year.
  </p>
  <div className="flex gap-3 justify-end">
    <button
      type="button"
      onClick={() => setShowResetModal(false)}
      className="font-sans text-sm text-fg-muted hover:text-fg px-4 py-2 transition-colors"
    >
      Cancel
    </button>
    <button
      type="button"
      onClick={() => { void handleResetConfirm(); }}
      disabled={isResetting}
      className="font-sans text-sm text-fg border border-warm-neutral-400 rounded px-4 py-2 hover:bg-surface-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      aria-busy={isResetting}
    >
      {isResetting ? 'Resetting…' : 'Reset journey'}
    </button>
  </div>
</Dialog>
```

**⚠️ `useId` import:** Add `useId` to the `import { useEffect, useRef, useState } from 'react'` line → `import { useEffect, useId, useRef, useState } from 'react'`.

**⚠️ `setPassport` state:** Currently the page state is `passport: FlavorPassportResponse | null`. The handler clears stamps on success. Verify `FlavorPassportResponse` has a `stamps` field (from `FlavorPassportResponseSchema`).

---

### Task 12 — Web tests (add to `child-flavor-passport.test.tsx` or new file) (AC: #1–#3, #6)

The FlavorPassport page currently has no test file — check with `Glob apps/web/src/routes/(app)/child-flavor-passport.test.tsx`. If it doesn't exist, create it.

**Test cases:**
1. Reset button renders when passport loads (AC#1)
2. Clicking reset opens confirmation dialog (AC#2)
3. Cancel closes dialog without calling API (AC#2)
4. Confirm → API called → success state shown, stamps cleared (AC#3)
5. Confirm → API 409 → modal closes, cooldown error shown (AC#6)
6. Confirm → generic API error → error shown (AC#6 fallback)

**Estimated test count:** 6 new web tests.

---

### Task 13 — MemoryRepository and ChildPreferences repository tests (AC: #4)

**`apps/api/src/modules/memory/memory.repository.test.ts`** — add a new `describe('softForgetChildNodes (7-S7)')` block:
```typescript
it('bulk-updates memory nodes where subject_child_id matches and soft_forget_at is null')
it('does not update already-soft-forgotten nodes (IS NULL guard)')
it('returns count of updated rows')
```

**`apps/api/src/modules/child-preferences/child-preferences.repository.test.ts`** — if the file exists, add a `describe('deleteByChild (7-S7)')` block:
```typescript
it('deletes all preferences for the child in the household')
it('returns count of deleted rows')
it('does not affect rows belonging to other children or households')
```

---

## Dev Notes

### Scope guardrails — do NOT build these

- **No embeddings cascade in the reset.** `memory_embeddings` is not referenced in this story (no embedding pipeline exists at beta scale). The nightly 7-S5 job handles `memory_provenance` ON DELETE CASCADE when it hard-deletes memory nodes after 30 days.
- **No SSE fan-out for the reset.** This is a low-frequency admin action, not a real-time event. No `reset.completed` SSE event needed here.
- **No `household_allergens` or `child_allergens` deletion.** The "flavor journey" scoped by FR68 covers learned preferences and passport stamps — not declared allergens (those are safety data, not learned preferences).
- **No `cultural_priors` deletion.** Cultural identity is household-level, not per-child flavor data.
- **No UI route change.** The reset button lives on the existing `/app/children/:childId/flavor-passport` page — no new web route needed.
- **No pagination on the cascade.** The total number of memory nodes per child will be < 100 at beta scale. Single-batch delete is appropriate.
- **No E2E Playwright spec.** The reset requires a live database + real child profile. Unit tests cover the full behavior. An E2E spec can be authored in 7-S8 when the parental dashboard provides the navigation path.

### Why `child_preferences` are deleted (not soft-forgotten)

`memory_nodes` are authored prose with personal meaning — they deserve the 30-day soft-forget window before hard-deletion. `child_preferences` are ephemeral emoji-rating signals from lunch taps. They carry no authored content and the 30-day recovery window would only delay the "clean slate" the parent asked for. Immediate deletion matches the spirit of the action and avoids adding a `soft_forget_at` column to a high-volume signal table.

### Cooldown timestamp stamped LAST

`children.setFlavorJourneyResetAt` is called AFTER the cascade succeeds (memory nodes soft-forgotten, prefs deleted). If the cascade fails midway, the cooldown is not activated. This ensures a failed partial reset doesn't lock the parent out for 365 days.

### 409 Conflict detail parsing on the web

The API's `ConflictError` message format is: `"flavor journey was already reset on <ISO timestamp>"`. The web client extracts the date with a regex. This is an acceptable coupling at MVP — if the message format changes, the regex falls back gracefully to a generic message.

### Dialog component: `bg-white` vs v2.0 tokens

The existing `Dialog.tsx` (line 97) uses `bg-white` for the dialog panel — this is a v1 token that predates the γ design migration. Do NOT fix it in this story (surgical-changes rule). The reset modal will inherit the `bg-white` styling from the existing `Dialog` component as-is.

### Existing `<Dialog>` ARIA pattern

Looking at `Dialog.tsx`:
- The dialog panel has `role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}`
- Pass `titleId` (matches the `<h2 id={...}>`) and `descriptionId` (matches the `<p id={...}>`) from the parent

The `useId()` hook generates a stable ID per render. Since the dialog is rendered inline (not in a portal that needs stable IDs across remounts), `useId()` is the correct primitive.

### Route authorization: `requirePrimaryParent`

The `requirePrimaryParent` preHandler is already instantiated in `childrenRoutesPlugin`:
```typescript
const requirePrimaryParent = authorize(['primary_parent']);
```
No new auth code needed — reuse the existing binding.

### Mock pattern for children.routes.test.ts

The existing `children.routes.test.ts` instantiates a Fastify test app with inline mock repositories (e.g. in-memory objects). For the new route, follow the same pattern: add a mock `FlavorJourneyResetService` with a `reset` function that returns a configurable outcome.

The simplest injection is:
```typescript
// In the test's buildTestApp helper:
app.decorate('flavorJourneyResetService', mockFlavorJourneyResetService);
```
But since `FlavorJourneyResetService` is instantiated inline in `childrenRoutesPlugin`, you'll need to either:
a) Extract the service as a Fastify decorator (preferred — follows the `memoryService`/`auditService` decorator pattern), OR
b) Accept a factory function argument in `buildTestApp` and override the instance before registering the routes plugin (requires exposing the injection point).

**Recommended (option a):** Convert to a Fastify decorator in `children.routes.ts` to keep the test harness clean. Add `fastify.decorate('flavorJourneyResetService', flavorJourneyResetService)` and reference `fastify.flavorJourneyResetService.reset(...)` in the handler. Test file then mocks the decorator.

However, since all the other inline service instantiations in `children.routes.ts` (e.g. `schoolPoliciesService`, `flavorPassportService`) are NOT decorated on Fastify, the simplest approach that avoids architectural drift is to pass the mock via a factory function in the test harness. Check how the existing `children.routes.test.ts` file handles services for reference.

### FlavorPassportResponse type

From `packages/contracts/src/children.ts` (via flavor-passport contracts):
```typescript
FlavorPassportResponseSchema // contains stamps array
```
Verify the shape with `Glob packages/contracts/src/flavor-passport*` before writing the `setPassport` call.

### Test baseline (do not introduce NEW failures)

- **Web tests before this slice:** 443/443
- **API tests before this slice:** ~1499-pass/20-fail (documented pre-existing baseline)
- **Contracts tests before this slice:** memory 46/46, children — check current count
- **TypeScript:** API 11 pre-existing errors (≤14 allowed), web 3 pre-existing errors. Zero new errors allowed.
- **Lint:** Changed files must be lint-clean (`pnpm lint`). No new `// eslint-disable` comments.

---

## File List

**New files:**
- `supabase/migrations/20260607000000_children_flavor_journey_reset_at.sql`
- `supabase/migrations/20260607000100_add_child_flavor_journey_reset_audit_type.sql`
- `apps/api/src/modules/children/flavor-journey-reset.service.ts`
- `apps/api/src/modules/children/flavor-journey-reset.service.test.ts`

**Modified files:**
- `packages/contracts/src/children.ts` — add `ResetFlavorJourneyResponseSchema` + type
- `packages/types/src/index.ts` — import + re-export `ResetFlavorJourneyResponse`
- `apps/api/src/audit/audit.types.ts` — add `'child.flavor_journey_reset'`
- `apps/api/src/modules/memory/memory.repository.ts` — add `softForgetChildNodes`
- `apps/api/src/modules/memory/memory.repository.test.ts` — add test for new method
- `apps/api/src/modules/child-preferences/child-preferences.repository.ts` — add `deleteByChild`
- `apps/api/src/modules/children/children.repository.ts` — add `getFlavorJourneyResetAt` + `setFlavorJourneyResetAt`
- `apps/api/src/modules/children/children.routes.ts` — add POST route + service wiring
- `apps/api/src/modules/children/children.routes.test.ts` — add 6 route tests
- `apps/web/src/routes/(app)/child-flavor-passport.tsx` — add reset button + dialog + handlers

**May need to create (check first):**
- `apps/web/src/routes/(app)/child-flavor-passport.test.tsx` — 6 new web tests

### References

- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S7`] — demo path, layers, FR68
- [Source: `_bmad-output/planning-artifacts/epics.md#Story 7.4`] — full acceptance criteria + user story statement
- [Source: `apps/api/src/modules/memory/memory.repository.ts`] — existing `softForgetNode` pattern to follow for `softForgetChildNodes`
- [Source: `apps/api/src/modules/memory/memory.service.ts`] — best-effort audit + cascade ordering pattern
- [Source: `apps/api/src/modules/child-preferences/child-preferences.repository.ts`] — existing repository structure for `deleteByChild`
- [Source: `apps/api/src/modules/children/children.repository.ts`] — existing `findById` method; add `getFlavorJourneyResetAt` + `setFlavorJourneyResetAt` after it
- [Source: `apps/api/src/modules/children/children.routes.ts`] — `requirePrimaryParent` binding; add route + service at end of plugin
- [Source: `apps/api/src/common/errors.ts`] — `NotFoundError` + `ConflictError` classes used in route
- [Source: `apps/api/src/audit/audit.types.ts`] — AUDIT_EVENT_TYPES array; add `'child.flavor_journey_reset'` in children section
- [Source: `apps/web/src/routes/(app)/child-flavor-passport.tsx`] — existing page structure; add state + dialog + button
- [Source: `apps/web/src/components/Dialog.tsx`] — existing Dialog component; reuse as-is (do NOT fix `bg-white` in this story)
- [Source: `supabase/migrations/20260606000000_add_memory_hard_forgotten_audit_type.sql`] — template for the audit type migration
- [Source: `supabase/migrations/20260510000000_create_children_table.sql`] — confirms `children` table structure for the new column

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story workflow.

### Debug Log References

- API targeted suites (service + repos): 50/50 pass.
- API children route suite: 61/61 pass (6 new 7-S7 route tests).
- Web flavor-passport suite: 6/6 pass.
- Full web suite: 449/449 (443 baseline + 6 new).
- Full API suite: 1520 pass / 20 fail / 13 skip — the 20 failures are the documented
  pre-existing baseline (auth, children, extra-library, lunch-link, onboarding.tools,
  audit.types parity-drift, catalog-seed, households, plan-adjustment, memory partial-seeding).
  0 regressions; 1520 = 1499 baseline + 21 new tests.
- Typecheck: API 11 (≤14 baseline, 0 new), web 3 (baseline), contracts 1 (heart-notes baseline),
  types 1 (heart-notes baseline) — zero new errors in any changed file.
- Lint: all new code lint-clean. The 8 pre-existing errors reported across the two modified
  files (`children.routes.test.ts` `_fnName`/`_cols` mock params; `children.routes.ts:472`
  `!=` in the pre-existing lunch-link route) are in regions this slice did not author and were
  left untouched (surgical-changes rule).

### Completion Notes List

All 9 ACs implemented across 13 tasks. Behaviour:

- **DB (T1):** migrations `20260607000000_children_flavor_journey_reset_at.sql` (new nullable
  `children.flavor_journey_reset_at`) + `20260607000100_add_child_flavor_journey_reset_audit_type.sql`
  (`child.flavor_journey_reset` enum value).
- **Contracts/types (T2):** `ResetFlavorJourneyResponseSchema` + `ResetFlavorJourneyResponse`.
- **Audit (T3):** `child.flavor_journey_reset` added to `AUDIT_EVENT_TYPES` (children section).
- **Repos (T4–T6):** `MemoryRepository.softForgetChildNodes` (bulk, IS NULL-idempotent),
  `ChildPreferencesRepository.deleteByChild` (hard delete), `ChildrenRepository.getFlavorJourneyResetAt`
  + `setFlavorJourneyResetAt`.
- **Service (T7):** `FlavorJourneyResetService` with `not_found` / `cooldown_active` / `ok` outcomes;
  cooldown stamped LAST (after the cascade) so a failed partial reset never locks the parent out;
  best-effort audit (failure logged, never fails the reset).
- **Route (T8):** `POST /v1/children/:childId/reset-flavor-journey` — `requirePrimaryParent`
  (403 for secondary_caregiver), 404 on cross-household/absent child (no oracle), 409 within 365 days.
- **Web (T11):** reset button + confirmation `<Dialog>` on the FlavorPassport page; success clears
  the passport to empty + inline "Flavor journey reset on [date]"; 409 → inline cooldown error with
  next-eligible date.

**Reconciliations (codebase vs story snippets):**

1. **Web page structure (T11).** The production `child-flavor-passport.tsx` delegates its entire
   render to `<FlavorPassportView>` (which owns the `<main>`); there is no inline passport markup or
   `</main>` to insert before, as the story snippet assumed. The reset button + dialog are rendered in
   the page as siblings after the view, wrapped in a width-matched container (`mx-auto w-full max-w-2xl`).
2. **Clear-to-empty on success (T11/AC3).** The story snippet only set `stamps: []`. With `state` still
   `'developing'/'established'`, `FlavorPassportView` would still render its stamp grid header. To truly
   "clear to empty" (AC3) the success handler sets `{ ...prev, stamps: [], state: 'empty' }` so the view
   renders its empty-state prose.
3. **409 detail parsing (T11/AC6).** `HkApiError.message` is only `"HK API error 409"`; the
   `ConflictError` detail string lives in the parsed RFC-7807 body. The handler reads
   `err.problem.detail` (with a graceful fallback) instead of the story snippet's `err.message`.
4. **Route test injection (T10).** Rather than decorating/injecting a mock `FlavorJourneyResetService`
   (which would require a new Fastify decorator + type augmentation not in the File List), the route
   constructs the real service as written and the test harness runs it against an extended in-memory
   mock supabase — added a `memory_nodes` bulk-update table + a `child_preferences` `.delete()` chain +
   an optional `flavor_journey_reset_at` field on the mock child row. This matches the existing harness
   doctrine ("run the real repos/services against a mock DB") with zero production-code drift.
5. **Test helper (T13).** Added `'delete'` to the shared `buildChainClient` op list in
   `child-preferences.repository.test.ts` (additive passthrough; existing tests unaffected).
6. **Service test factory (T9).** Replaced the story snippet's malformed generic-conditional `makeDeps`
   signature with a plain typed factory; 7 service tests cover every outcome branch + cascade ordering +
   best-effort audit.

Per Dev Notes scope guardrails: no embeddings cascade, no SSE fan-out, no allergen/cultural-prior
deletion, no pagination, no new web route, no E2E Playwright spec (reset needs a live DB; unit coverage
is complete — E2E deferred to 7-S8 per the story).

### File List

**New files:**
- `supabase/migrations/20260607000000_children_flavor_journey_reset_at.sql`
- `supabase/migrations/20260607000100_add_child_flavor_journey_reset_audit_type.sql`
- `apps/api/src/modules/children/flavor-journey-reset.service.ts`
- `apps/api/src/modules/children/flavor-journey-reset.service.test.ts`
- `apps/web/src/routes/(app)/child-flavor-passport.test.tsx`

**Modified files:**
- `packages/contracts/src/children.ts` — `ResetFlavorJourneyResponseSchema` + type
- `packages/types/src/index.ts` — import + re-export `ResetFlavorJourneyResponse`
- `apps/api/src/audit/audit.types.ts` — `'child.flavor_journey_reset'`
- `apps/api/src/modules/memory/memory.repository.ts` — `softForgetChildNodes`
- `apps/api/src/modules/memory/memory.repository.test.ts` — `softForgetChildNodes` tests (4)
- `apps/api/src/modules/child-preferences/child-preferences.repository.ts` — `deleteByChild`
- `apps/api/src/modules/child-preferences/child-preferences.repository.test.ts` — `deleteByChild` tests (4) + `'delete'` op in helper
- `apps/api/src/modules/children/children.repository.ts` — `getFlavorJourneyResetAt` + `setFlavorJourneyResetAt`
- `apps/api/src/modules/children/children.routes.ts` — POST route + service wiring + `ConflictError` import
- `apps/api/src/modules/children/children.routes.test.ts` — 6 route tests + `memory_nodes`/`child_preferences.delete` mocks + `flavor_journey_reset_at` mock field
- `apps/web/src/routes/(app)/child-flavor-passport.tsx` — reset button + dialog + handler

### USER-SIDE GATE

`supabase db push --include-all` to apply the two new migrations (`20260607000000`,
`20260607000100`) before the endpoint runs against a real DB.

## Review Findings

### Decision-Needed

- [ ] [Review][Decision] **D-1 — Concurrent resets bypass cooldown check** — Two simultaneous POST requests both read `getFlavorJourneyResetAt` → both see `null` → both pass the `elapsedMs < COOLDOWN_MS` check → both execute the full cascade. The second call's `softForgetChildNodes` writes 0 rows (IS NULL guard), but `setFlavorJourneyResetAt` stamps a second, later `reset_at` value. Net result: double-trigger is effectively harmless but the cooldown window is silently shifted by the second stamp. Fix requires an atomic CAS update (`UPDATE children SET flavor_journey_reset_at = NOW() WHERE id = $id AND (flavor_journey_reset_at IS NULL OR flavor_journey_reset_at < NOW() - INTERVAL '365 days')`), replacing the read-then-write pattern. Options: (a) add DB-level CAS in `setFlavorJourneyResetAt` and check rowcount to detect the race, (b) accept the low-frequency risk at MVP (annual action, single household). `[flavor-journey-reset.service.ts:41-60]`

- [ ] [Review][Decision] **D-2 — 409 response embeds reset date in prose detail only** — The ConflictError message `"flavor journey was already reset on ${outcome.last_reset_at}"` is parsed by the client via regex `/reset on (.+)$/`. If the message format changes, the client silently falls back to "a recent date" / "a year from now". Additionally, the client computes `eligible_at` from its local clock + `COOLDOWN_MS`, which can diverge from the server's cutoff by the client's clock skew. Options: (a) add `last_reset_at` and `eligible_at` as structured fields in the 409 response body, (b) accept the regex coupling and clock-skew cosmetic risk at MVP. `[children.routes.ts — ConflictError throw], [child-flavor-passport.tsx:97-107]`

- [ ] [Review][Decision] **D-3 — Button label falls back to "this child's" when child name not loaded** — AC1 specifies "Reset [child name]'s flavor journey". When the child-name fetch fails (or hasn't resolved yet), `childName` is `''` and the button reads "Reset this child's flavor journey". The spec has no approved fallback. Options: (a) suppress the reset button until `childName` is non-empty, (b) accept the fallback as sufficient UX degradation, (c) update the spec to bless the fallback. `[child-flavor-passport.tsx:132]`

- [ ] [Review][Decision] **D-4 — No client-side cooldown guard before dialog open** — AC2 says "When no cooldown is active → Dialog opens." The implementation always opens the dialog on button click; the cooldown is discovered only after the user clicks "Reset journey" and the API returns 409. Options: (a) fetch/cache `flavor_journey_reset_at` in the initial data load and disable/hide the button when within the cooldown, (b) accept the current behaviour (user enters a one-step modal before learning the action is blocked — acceptable for a once-per-year action). `[child-flavor-passport.tsx:96-100]`

- [ ] [Review][Decision] **D-5 — `softForgetChildNodes` does not write `forget_reason`** — The individual `softForgetNode` (7-S4) writes both `soft_forget_at` AND `forget_reason`. The bulk `softForgetChildNodes` only writes `soft_forget_at`; all bulk-reset nodes have `forget_reason = NULL`, making them indistinguishable in audit queries from nodes that were never explicitly forgotten. Options: (a) add `forget_reason: 'annual_reset'` to the bulk update payload, (b) defer — `forget_reason` is advisory metadata and its absence doesn't affect system behaviour. `[memory.repository.ts — softForgetChildNodes]`

### Patch

- [ ] [Review][Patch] **P-1 — `resetAt` state not cleared on `childId` change — stale success banner on sibling-child navigation** — React Router re-renders the same component instance when navigating between two children's passport pages (same route pattern, different params). `resetAt` is only reset on unmount, not on param change. A user who resets child A's journey and then navigates to child B's passport page will see "Flavor journey reset on [date]" under child B's passport. Fix: add `useEffect(() => { setResetAt(null); setResetError(null); }, [childId])`. `[child-flavor-passport.tsx:30-35]`

- [ ] [Review][Patch] **P-2 — `resetAt` and `resetError` are not mutually exclusive** — After a successful reset (`resetAt` is set and the banner shows), clicking reset again opens the modal. On confirm, if the API returns 409 (cooldown active), `resetError` is set but `resetAt` is NOT cleared. Both `<p>` elements render simultaneously: "Flavor journey reset on [date]" immediately above "Already reset on [date]. You can reset again after [date]." Fix: in the catch block, add `setResetAt(null)` before `setResetError(...)`, OR clear `resetAt` in the onClick handler alongside `resetError`. `[child-flavor-passport.tsx:100-110, 83-85]`

- [ ] [Review][Patch] **P-3 — Success confirmation paragraph missing accessibility role** — The `resetAt` success paragraph has no ARIA live-region role; screen readers will not auto-announce it when it appears. The adjacent `resetError` paragraph correctly has `role="alert"`. Fix: add `role="status"` to the success `<p>` (non-urgent status, not alert). `[child-flavor-passport.tsx:148]`

### Deferred

- [x] [Review][Defer] **Non-transactional cascade accepted by spec** — The three cascade steps (softForgetChildNodes, deleteByChild, setFlavorJourneyResetAt) run as separate DB calls without a transaction. Partial failures leave the child in a mixed state, but the stamp-last ordering ensures retries are safe (IS NULL guard on step 1, idempotent hard-delete on step 2). Explicitly accepted design per Dev Notes. — deferred, accepted design
- [x] [Review][Defer] **`setFlavorJourneyResetAt` no rowcount assertion** — The update does not verify that exactly one row was stamped. In the extremely rare TOCTOU window where the child is deleted between `findById` and `setFlavorJourneyResetAt`, the service returns `{type: 'ok'}` for a deleted child. Benign at MVP scale. — deferred, too rare at MVP
- [x] [Review][Defer] **`COOLDOWN_MS` duplicated client/server** — Both `flavor-journey-reset.service.ts` and `child-flavor-passport.tsx` define `365 * 24 * 60 * 60 * 1000`. Client uses it only for display (computing eligible date from the 409 ISO timestamp). Cosmetic divergence risk. — deferred, display-only client use
- [x] [Review][Defer] **Two sequential round-trips to `children` table in service** — `findById` and `getFlavorJourneyResetAt` are separate queries against the same row. Could be a single query at the cost of extending `findById`'s return type. Performance non-issue at MVP frequency. — deferred, performance
- [x] [Review][Defer] **No `Idempotency-Key` support on reset endpoint** — A network timeout after the server completes the cascade returns a 409 on retry (cooldown now active), not the original 200. The client shows a confusing error even though the reset succeeded. Low risk for an annual action. — deferred, annual frequency mitigates risk
- [x] [Review][Defer] **`setPassport` optimistic update no server refetch** — After reset, the client sets `state: 'empty', stamps: []` locally without refetching. If the server-side cascade was partial, the client and server state diverge until reload. Acceptable MVP pattern. — deferred, acceptable optimistic update
- [x] [Review][Defer] **Non-`HkApiError` errors close modal with message below scroll fold** — Generic network/parse errors close the dialog and render `resetError` in the section below the passport view, which may be off-screen on small viewports. UX polish. — deferred, UX polish

### Independent Adversarial Review (2026-06-04)

Three blind layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run with no shared context. Acceptance Auditor verdict: **PASS — all 9 ACs satisfied; no scope-guardrail violations.** The pass independently reproduced the dev self-review's D-1, D-2, D-3, D-4, P-1, P-2 and 2 deferred items (strong corroboration), added one new patch + one new defer, and dismissed 3 as false positives. D-5 was NOT independently reproduced but remains open below.

**Decision-Needed (independent) — RESOLVED 2026-06-04 (Menon):**

- [x] [Review][Decision→Defer] **IR-1 — Concurrent-reset cooldown is not atomic (TOCTOU)** — read-then-write across `getFlavorJourneyResetAt` → in-memory `elapsedMs < COOLDOWN_MS` → later `setFlavorJourneyResetAt`. Two simultaneous POSTs both pass the guard and both run the cascade + stamp + audit. Cascade is idempotent (`IS NULL` guards) so no corruption, but the cooldown is advisory and audit double-counts. **Duplicate of D-1.** — **Deferred:** annual single-household action; idempotent cascade makes the race harmless beyond a duplicate audit row. Revisit if reset frequency rises. `[flavor-journey-reset.service.ts:33-60]`
- [x] [Review][Decision→Defer] **IR-2 — 409 reset date travels only in prose `detail`; client regex-scrapes it + computes eligible date from local clock** — `/reset on (.+)$/` against `"flavor journey was already reset on <ISO>"`, then `Date.now() + COOLDOWN_MS`. Wording change → silent fallback; clock skew → wrong eligible date. **Duplicate of D-2.** — **Deferred:** AC6 string is correct in the normal path; coupling + clock-skew are cosmetic at MVP. Move dates to structured 409 fields if the message format ever changes. `[children.routes.ts ConflictError throw], [child-flavor-passport.tsx 409 branch]`
- [x] [Review][Decision→Defer] **IR-3 — No client-side cooldown guard before the dialog opens (AC2 "when no cooldown is active")** — page never loads `flavor_journey_reset_at`; dialog always opens and the cooldown is only discovered post-confirm via 409. Partial AC2 satisfaction. **Duplicate of D-4.** — **Deferred:** once-a-year action; a single wasted click before the 409 is acceptable. Add an upfront cooldown load if the parental dashboard (7-S8) surfaces the date anyway. `[child-flavor-passport.tsx button onClick]`
- [ ] [Review][Decision→Patch] **IR-4 — Button/dialog title falls back to "this child's" — not the AC1 verbatim "Reset [child name]'s flavor journey"** — reachable while the separate child-name fetch is unresolved or failed. **Duplicate of D-3.** — **Resolved → PATCH:** suppress the reset button until `childName` is non-empty (see patch list below). `[child-flavor-passport.tsx possessive]`

**Patch (independent):**

- [x] [Review][Patch] **IR-4 — Gate the reset button + dialog on a non-empty `childName`** so AC1's verbatim "Reset [child name]'s flavor journey" is always shown (no "this child's" fallback). `[child-flavor-passport.tsx]` — **APPLIED 2026-06-04:** button block wrapped in `{childName && (…)}`.
- [x] [Review][Patch] **D-5 — Stamp `forget_reason: 'annual_reset'` in `softForgetChildNodes`** so bulk-reset nodes are distinguishable in audit queries from never-forgotten nodes, matching the per-node `softForgetNode` (7-S4). `[memory.repository.ts — softForgetChildNodes]` — **APPLIED 2026-06-04:** update payload now `{ soft_forget_at, forget_reason: 'annual_reset' }`; repo test assertion updated.

- [x] [Review][Patch] **IR-5 — Stale `resetAt`/`resetError` leak across `childId` navigation** — route renders a single un-keyed `<ChildFlavorPassportPage>` (verified `app.tsx`), load effect is one-shot-guarded, and reset state is never cleared on param change → child A's "Flavor journey reset on …" banner renders under child B's passport. Fix: `useEffect(() => { setResetAt(null); setResetError(null); }, [childId])`. **Duplicate of P-1.** `[child-flavor-passport.tsx:30-37]` — **APPLIED 2026-06-04.**
- [x] [Review][Patch] **IR-6 — `resetAt` and `resetError` not mutually exclusive** — after a success, a follow-up 409 sets `resetError` without clearing `resetAt`; both banners render together. Fix: `setResetAt(null)` in the catch before `setResetError(...)`. **Duplicate of P-2.** `[child-flavor-passport.tsx success/catch]` — **APPLIED 2026-06-04.**
- [x] [Review][Patch] **IR-7 — Success copy has a trailing period — not the AC3 verbatim "Flavor journey reset on [date]"** — code renders `Flavor journey reset on {date}.` Spec string has no terminal period. Fix: drop the period (the AC6 cooldown string already matches verbatim). `[child-flavor-passport.tsx success <p>]` — **APPLIED 2026-06-04.**

**Defer (independent):**

- [x] [Review][Defer] **IR-8 — Non-transactional cascade leaves a partial state on partial failure** — three independent awaits, no transaction; stamp-last + `IS NULL`/re-deletable idempotency make retry self-healing, but a non-retrying user is left half-reset with no cooldown. — deferred, accepted retry-safe design (matches existing deferred item)
- [x] [Review][Defer] **IR-9 — Service unit tests cast every mock + fixture to `never`** — `new FlavorJourneyResetService(deps as never)` / `... as never` defeats TS contract-checking, so a repo signature drift wouldn't be caught by the only behavioral coverage of the cascade. Test hardening, no production defect. — deferred, test-quality
- [x] [Review][Defer] **IR-10 — `findById` + `getFlavorJourneyResetAt` issue two round-trips for the same row** — also widens the IR-1 TOCTOU window. Perf non-issue at annual MVP frequency. — deferred, perf (matches existing deferred item)

**Dismissed (false positives, with evidence):**

- Migration `ALTER TYPE … ADD VALUE IF NOT EXISTS` "fails in a transaction" — byte-identical to the shipping 7-S5 migration `20260606000000`; on Supabase/PG15 `ADD VALUE` is legal in-transaction when the value isn't referenced in the same tx (it isn't). Blind Hunter lacked stack context; Edge Case Hunter with project access confirmed the precedent.
- `state: 'empty'` is an invalid literal — `'empty'` is a member of `FlavorPassportView` `state: 'empty' | 'developing' | 'established'` (`FlavorPassportView.tsx:17,37`).
- Stale `available_filters` in the optimistic update — the empty state early-returns prose only and renders neither stamps nor filters (`FlavorPassportView.tsx:37-46`), so the retained value is never read.

**Dev self-review D-1…D-5 — resolved via the independent pass (2026-06-04, Menon):**

- D-1 → **Deferred** (= IR-1 resolution).
- D-2 → **Deferred** (= IR-2 resolution).
- D-3 → **Patch** (= IR-4 — gate button on child name).
- D-4 → **Deferred** (= IR-3 resolution).
- D-5 → **Patch** — stamp `forget_reason: 'annual_reset'` in `softForgetChildNodes` (carried forward from dev self-review; not independently reproduced by the blind layers, but accepted as a cheap audit-traceability fix).

## Change Log

| Date       | Change                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| 2026-06-04 | Story file authored for 7-S7 Annual Flavor Journey Reset. Status → ready-for-dev. |
| 2026-06-04 | Implemented all 9 ACs / 13 tasks. New reset endpoint + service + cascade repos + contracts/audit + web dialog. 21 new API tests + 6 web tests; 0 regressions. Status → review. |
