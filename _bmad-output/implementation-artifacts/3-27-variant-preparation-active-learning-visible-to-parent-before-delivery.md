# Story 3.27: Variant Preparation Active-Learning (Visible to Parent Before Delivery)

Status: done

## Story

As a Primary Parent,
I want Lumi to occasionally propose variant preparations of an existing item to capture child-rating delta as an active-learning signal, with the variant visible to me before delivery,
So that the system probes preference space without bypassing my approval per Principle 1 (FR127).

## Acceptance Criteria

1. **Given** Stories 3.5+3.21 are complete and a child has rated an item ≥3 times,
   **When** the planner identifies a candidate variant (e.g., "baked" vs "pan-fried"),
   **Then** the variant proposal renders on the affected day's `<PlanTile>` in `pending-input` state with two pills: [Try the variant] [Keep the original]; I confirm before plan commit; rating delta tracked for learning.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `plan_items` table; `PlansService.commit()` — plan commit flow
- Story 3.9: `<PlanTile>` with `pending-input` state — this story adds the variant proposal as a reason for that state
- Story 3.21: `ExtraRulesRepository.findExtraRules()` + `extra_library` — planner already receives extra rules; extend to receive variant eligibility signal
- Story 4.3 (future): child rating data will come from `lunch_link_sessions.rating`; for MVP, variant eligibility is asserted via a `child_variant_ratings` stub — the actual rating signal is deferred to Epic 4 integration
- Story 3.12: `PATCH /v1/plans/:id/items/:itemId` — existing swap endpoint; variant confirmation follows similar pattern
- `AUDIT_EVENT_TYPES`

**Key invariants:**
- Parent confirms before the variant is committed — per Principle 1, Lumi never unilaterally modifies a committed plan
- The variant proposal is visible on the PlanTile BEFORE the plan is locked — not as a post-commit notification
- Variant is a preparation method change (baked vs. pan-fried, raw vs. roasted), not an ingredient substitution
- The planner proposes ONE variant per plan generation — not multiple variants per week to avoid cognitive overload
- Rating delta tracking is deferred to Epic 4 (actual rating data); MVP stores the confirmed/rejected state only
- No `framer-motion` — Tailwind animation utilities only
- `import type` for all type-only imports
- All DB access through API layer only

---

## Tasks / Subtasks

### Task 1 — DB Migration: `variant_proposals` table

Create `supabase/migrations/20260830000000_create_variant_proposals.sql`:

```sql
-- Story 3.27: records Lumi-proposed preparation variants for active learning.
-- A variant proposal is a suggestion to try a different preparation method
-- for an item the child has rated before, to capture preference delta.
-- One active proposal per household per plan week.
CREATE TABLE IF NOT EXISTS variant_proposals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL,
  child_id            UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  plan_item_id        UUID NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  plan_id             UUID NOT NULL,
  -- The base item (what was originally planned).
  base_recipe_name    TEXT NOT NULL,
  base_method         TEXT NOT NULL,     -- e.g., 'pan-fried', 'raw', 'baked'
  -- The proposed variant.
  variant_description TEXT NOT NULL,     -- e.g., 'oven-baked instead of pan-fried'
  variant_method      TEXT NOT NULL,
  -- Confirmation flow.
  proposed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ,       -- parent confirmed [Try the variant]
  rejected_at         TIMESTAMPTZ,       -- parent chose [Keep the original]
  -- Rating delta (populated post-Epic 4 rating integration).
  base_rating         SMALLINT,          -- child's prior rating of base item (1-3 emoji scale)
  variant_rating      SMALLINT,          -- child's rating of variant (populated after delivery)
  rating_delta_at     TIMESTAMPTZ
);

CREATE INDEX idx_variant_proposals_plan
  ON variant_proposals(plan_id)
  WHERE confirmed_at IS NULL AND rejected_at IS NULL;

CREATE INDEX idx_variant_proposals_household_active
  ON variant_proposals(household_id)
  WHERE confirmed_at IS NULL AND rejected_at IS NULL;
```

### Task 2 — Contracts: variant proposal schemas

In `packages/contracts/src/plan.ts`:

```typescript
export const VariantProposalSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid(),
  plan_item_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  base_recipe_name: z.string(),
  base_method: z.string(),
  variant_description: z.string(),
  variant_method: z.string(),
  proposed_at: z.string().datetime(),
  confirmed_at: z.string().datetime().nullable(),
  rejected_at: z.string().datetime().nullable(),
});

// POST /v1/plans/:planId/variant-proposals/:proposalId/confirm
export const ConfirmVariantProposalInputSchema = z.object({
  choice: z.enum(['try_variant', 'keep_original']),
});
```

Update `packages/types/src/index.ts`.

### Task 3 — `VariantProposalRepository`

Create `apps/api/src/modules/plans/variant-proposal.repository.ts`:

```typescript
export class VariantProposalRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: {
    householdId: string;
    childId: string;
    planItemId: string;
    planId: string;
    baseRecipeName: string;
    baseMethod: string;
    variantDescription: string;
    variantMethod: string;
    baseRating?: number | null;
  }): Promise<VariantProposal> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        plan_item_id: input.planItemId,
        plan_id: input.planId,
        base_recipe_name: input.baseRecipeName,
        base_method: input.baseMethod,
        variant_description: input.variantDescription,
        variant_method: input.variantMethod,
        base_rating: input.baseRating ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as VariantProposal;
  }

  async findActiveByPlan(planId: string): Promise<VariantProposal[]> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .select('*')
      .eq('plan_id', planId)
      .is('confirmed_at', null)
      .is('rejected_at', null);
    if (error) throw error;
    return (data ?? []) as VariantProposal[];
  }

  async confirm(proposalId: string, householdId: string): Promise<void> {
    const { error } = await this.client
      .from('variant_proposals')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('household_id', householdId)
      .is('confirmed_at', null)
      .is('rejected_at', null);
    if (error) throw error;
  }

  async reject(proposalId: string, householdId: string): Promise<void> {
    const { error } = await this.client
      .from('variant_proposals')
      .update({ rejected_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('household_id', householdId)
      .is('confirmed_at', null)
      .is('rejected_at', null);
    if (error) throw error;
  }
}
```

### Task 4 — Planner variant-proposal injection

The planner (via plan-generation.job.ts contextLines) needs to know:
1. Which children are eligible for variant proposals (rated ≥3 times)
2. Which items they've rated (so it can propose variants of rated items)

For MVP, variant eligibility is a static flag in `children` (Epic 4 provides real rating counts). Add a migration stub:

```sql
-- Temporary stub column — populated by Epic 4 rating integration.
-- When true, planner may propose a variant for this child's plan items.
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS variant_eligible BOOLEAN NOT NULL DEFAULT false;
```

In `plan-generation.job.ts`, add context:
```typescript
if (child.variant_eligible) {
  contextLines.push(
    `${childName} is eligible for a variant proposal this week. ` +
    `If you identify a preparation method variant (e.g., baked vs pan-fried) for an item ` +
    `they've had before, include it as a VARIANT_PROPOSAL in the plan output with fields: ` +
    `base_method, variant_method, variant_description. ONE proposal maximum per plan.`,
  );
}
```

Extend `PlanComposeOutput` in `packages/contracts/src/plan.ts`:
```typescript
export const PlanVariantProposalOutputSchema = z.object({
  plan_item_id: z.string(),   // references the day+slot item being varied
  base_method: z.string(),
  variant_method: z.string(),
  variant_description: z.string(),
}).optional();

// Add to PlanComposeOutputSchema:
variant_proposal: PlanVariantProposalOutputSchema,
```

### Task 5 — `VariantProposalService`: create proposal when planner returns one

Create `apps/api/src/modules/plans/variant-proposal.service.ts`:

```typescript
export class VariantProposalService {
  constructor(
    private readonly repo: VariantProposalRepository,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Called from PlansService after a plan is committed — if the planner returned a variant_proposal.
  async createFromPlanOutput(
    planOutput: PlanComposeOutput,
    planId: string,
    householdId: string,
    requestId: string,
  ): Promise<void> {
    if (!planOutput.variant_proposal) return;

    const proposal = planOutput.variant_proposal;
    // Resolve plan_item_id from plan_item_id field in the proposal.
    // (The LLM references the item by plan_item_id from the plan output.)
    const childId = this.resolveChildId(planOutput, proposal.plan_item_id);
    if (!childId) {
      this.logger.warn({ proposal }, 'variant_proposal references unknown plan_item_id — skipping');
      return;
    }

    try {
      await this.repo.create({
        householdId,
        childId,
        planItemId: proposal.plan_item_id,
        planId,
        baseRecipeName: this.resolveRecipeName(planOutput, proposal.plan_item_id),
        baseMethod: proposal.base_method,
        variantDescription: proposal.variant_description,
        variantMethod: proposal.variant_method,
      });

      await this.auditService.write({
        event_type: 'plan.variant_proposal_created',
        household_id: householdId,
        request_id: requestId,
        metadata: { plan_id: planId, variant_method: proposal.variant_method },
      });
    } catch (err) {
      this.logger.error({ err }, 'failed to create variant_proposal — continuing');
    }
  }

  async confirmProposal(opts: {
    proposalId: string;
    householdId: string;
    choice: 'try_variant' | 'keep_original';
    requestId: string;
  }): Promise<void> {
    if (opts.choice === 'try_variant') {
      await this.repo.confirm(opts.proposalId, opts.householdId);
    } else {
      await this.repo.reject(opts.proposalId, opts.householdId);
    }

    await this.auditService.write({
      event_type: opts.choice === 'try_variant'
        ? 'plan.variant_proposal_confirmed'
        : 'plan.variant_proposal_rejected',
      household_id: opts.householdId,
      request_id: opts.requestId,
      metadata: { proposal_id: opts.proposalId },
    });
  }

  private resolveChildId(planOutput: PlanComposeOutput, planItemId: string): string | null {
    for (const day of planOutput.days) {
      for (const item of day.items) {
        if (item.id === planItemId) return item.child_id;
      }
    }
    return null;
  }

  private resolveRecipeName(planOutput: PlanComposeOutput, planItemId: string): string {
    for (const day of planOutput.days) {
      for (const item of day.items) {
        if (item.id === planItemId) return item.recipe_name ?? 'Unknown dish';
      }
    }
    return 'Unknown dish';
  }
}
```

### Task 6 — Route: `POST /v1/plans/:planId/variant-proposals/:proposalId/confirm`

In `apps/api/src/modules/plans/plans.routes.ts`:

```typescript
fastify.post(
  '/v1/plans/:planId/variant-proposals/:proposalId/confirm',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ planId: z.string().uuid(), proposalId: z.string().uuid() }),
      body: ConfirmVariantProposalInputSchema,
      response: { 204: z.object({}) },
    },
  },
  async (request, reply) => {
    const { planId, proposalId } = request.params as { planId: string; proposalId: string };
    const body = request.body as ConfirmVariantProposalInput;
    await fastify.variantProposalService.confirmProposal({
      proposalId,
      householdId: request.user.household_id,
      choice: body.choice,
      requestId: request.id,
    });
    return reply.status(204).send();
  },
);

// GET: include active proposals in the plan response so frontend can render pending-input state.
// When GET /v1/plans/:id is called, include variant_proposals in the response alongside plan_items.
```

Update `GET /v1/plans/:id` (or the brief_state endpoint) to include `variant_proposals` so the frontend can render the `pending-input` state.

### Task 7 — Frontend: `<PlanTile>` in `pending-input` state for variant proposals

In `apps/web/src/features/plan/PlanTile.tsx`, when `tile.variant_proposal` is present (active, unconfirmed):

```typescript
{tile.variant_proposal && (
  <div className="mt-2 flex flex-col gap-1">
    <p className="font-sans text-[13px] text-warm-neutral-700 leading-relaxed">
      {tile.variant_proposal.variant_description}
    </p>
    <div className="flex gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => handleVariantChoice('try_variant')}
        className="rounded-full border border-terracotta-400 px-3 py-1 font-sans text-[13px] text-terracotta-800 hover:bg-terracotta-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terracotta-400"
      >
        Try the variant
      </button>
      <button
        type="button"
        onClick={() => handleVariantChoice('keep_original')}
        className="rounded-full border border-warm-neutral-300 px-3 py-1 font-sans text-[13px] text-warm-neutral-700 hover:bg-warm-neutral-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warm-neutral-300"
      >
        Keep the original
      </button>
    </div>
  </div>
)}
```

The tile itself should show `pending-input` visual state (from Story 3.9) when a variant proposal is active.

### Task 8 — Audit event types

```typescript
'plan.variant_proposal_created',
'plan.variant_proposal_confirmed',
'plan.variant_proposal_rejected',
```

### Task 9 — Tests

**`variant-proposal.repository.test.ts` (new):**
- `create()` — inserts row; `findActiveByPlan()` returns it; after `confirm()`, no longer in active list
- `reject()` — sets `rejected_at`; no longer in active list

**`variant-proposal.service.test.ts` (new):**
- `createFromPlanOutput()` — with variant_proposal in plan output → inserts row + audit
- `createFromPlanOutput()` — with no variant_proposal → no-op
- `confirmProposal('try_variant')` → calls `repo.confirm()` + audit `plan.variant_proposal_confirmed`
- `confirmProposal('keep_original')` → calls `repo.reject()` + audit `plan.variant_proposal_rejected`

**`PlanTile.test.tsx` (extend):**
- With active `variant_proposal` → renders two pills with correct labels
- Without `variant_proposal` → no pills rendered

---

## Dev Notes

### Variant proposals are a forward-looking learning mechanism

The parent confirms the variant for this week's plan; the child rates it at lunchtime (Epic 4). The difference between the base_rating and variant_rating is the learning signal. For MVP, we capture the variant proposal and confirmation, but the actual rating delta comparison is deferred to Epic 4 integration.

The `variant_eligible` flag on children is a temporary MVP stub. Epic 4 Story 4.14 introduces proper per-child per-slot preference data. When 4.14 ships, `plan-generation.job.ts` should switch from reading `variant_eligible` to computing eligibility from actual rating counts.

### One variant per plan maximum

The planner instruction says "ONE proposal maximum per plan." The service enforces this at creation time — if `findActiveByPlan()` returns a non-empty list, skip creating another. This prevents cognitive overload and keeps the pending-input state rare enough to feel signal-worthy.

### Variant is a method change, not an ingredient swap

Variants are preparation method alternatives ("baked" vs "pan-fried", "raw" vs "pickled"). They are not ingredient substitutions — that's Story 3.24 (safe substitution for allergens). The planner instruction clarifies this distinction. If the LLM outputs an ingredient swap as a variant_proposal, the service should log a warning and skip creation.

---

## Project Structure

**New files:**
```
supabase/migrations/20260830000000_create_variant_proposals.sql
apps/api/src/modules/plans/variant-proposal.repository.ts
apps/api/src/modules/plans/variant-proposal.service.ts
apps/api/src/modules/plans/variant-proposal.repository.test.ts
apps/api/src/modules/plans/variant-proposal.service.test.ts
```

**Modified files:**
```
packages/contracts/src/plan.ts                             + VariantProposalSchema, ConfirmVariantProposalInputSchema, PlanVariantProposalOutputSchema
packages/types/src/index.ts                                + VariantProposal, ConfirmVariantProposalInput types
apps/api/src/audit/audit.types.ts                          + plan.variant_proposal_created, confirmed, rejected
apps/api/src/jobs/plan-generation.job.ts                   + variant_eligible context injection
apps/api/src/modules/plans/plans.service.ts                + call VariantProposalService.createFromPlanOutput() post-commit
apps/api/src/modules/plans/plans.routes.ts                 + POST confirm route; GET plan response includes variant_proposals
apps/api/src/modules/plans/plans.hook.ts                   + VariantProposalRepository + VariantProposalService wired
apps/web/src/features/plan/PlanTile.tsx                    + pending-input variant proposal pills
_bmad-output/implementation-artifacts/sprint-status.yaml   3-27 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md     + Epic 4 variant_eligible real rating signal integration; rating delta tracking
```

---

## Dev Agent Record

### Implementation Notes (2026-05-25)

**Deviations from story spec:**
- `PlanVariantProposalOutputSchema` references the target item by `(child_id, day, slot)` rather than a synthetic `plan_item_id`. The planner's `PlanComposeItem` doesn't carry recipe name and `item_id` is optional — `(child_id, day, slot)` is the only unambiguous, contract-stable identifier. The service maps to the committed `plan_items.id` via `PlansRepository.findItemsByPlanId`.
- Migration timestamp moved from `20260830000000` (would land before existing 09xx files) to `20260911000000` (newer than the last migration, `20260910000000_2_6_s3_stage1_schema.sql`).
- `GetPlansResponse.variant_proposals` is `.optional()` rather than `.default([])` so existing fixtures and test paths that omit the field stay valid. Consumers use `?? []` at the read site.
- `base_recipe_name` is derived from `item.ingredients.slice(0,3).join(', ')` since `plan_items` has no `recipe_name` column. Forward-compatible — a future migration adding `recipe_name` would replace the derivation.
- Post-commit variant persistence runs from `plan-generation.job.ts` (not from inside `PlansService.commit`) using the latest `PlanComposeOutput` captured during the guardrail retry loop. Keeps `PlansService.commit` unchanged and uses the FINAL accepted plan rather than the first attempt that may have been rewritten.
- Story spec's Task 4 talks about `variant_eligible` as a fresh DB column. Migration bundles it with the `variant_proposals` table so both ship atomically; no separate stub migration.

**Validation:**
- API: 13 new variant-proposal tests pass (`variant-proposal.repository.test.ts`, `variant-proposal.service.test.ts`).
- API: existing plan-generation/context/routes regression suite (61 tests) — all green.
- API: orchestrator regression suite (45 tests) — all green.
- Web: existing PlanTile suite extended to 32 tests (5 new for variant proposal) — all green.
- `pnpm typecheck`: all pre-existing failures unchanged by this story; no new errors introduced (verified by `git stash` → typecheck → restore baseline diff).

**Audit event types added:** `plan.variant_proposal_created`, `plan.variant_proposal_confirmed`, `plan.variant_proposal_rejected`.

**Deferred (out of scope, per Dev Notes):**
- Real `variant_eligible` derivation from `lunch_link_sessions.rating` counts (Epic 4 / Story 4.14).
- Rating delta tracking via `variant_proposals.base_rating` / `variant_proposals.variant_rating` — columns exist but are not populated by this story.
- `recipe_name` column on `plan_items` (deferred — derivation from ingredients is the MVP).

## File List

**New files:**
- `supabase/migrations/20260911000000_create_variant_proposals.sql`
- `apps/api/src/modules/plans/variant-proposal.repository.ts`
- `apps/api/src/modules/plans/variant-proposal.service.ts`
- `apps/api/src/modules/plans/variant-proposal.repository.test.ts`
- `apps/api/src/modules/plans/variant-proposal.service.test.ts`

**Modified files:**
- `packages/contracts/src/plan.ts` — added `VariantProposalSchema`, `ConfirmVariantProposalInputSchema`, `PlanVariantProposalOutputSchema`; extended `PlanComposeOutputSchema` and `GetPlansResponseSchema`.
- `packages/types/src/index.ts` — exported `VariantProposal`, `ConfirmVariantProposalInput`, `PlanVariantProposalOutput`.
- `apps/api/src/audit/audit.types.ts` — added 3 new audit event types.
- `apps/api/src/types/fastify.d.ts` — added `variantProposalService` decorator type.
- `apps/api/src/agents/orchestrator.ts` — added `PlannerVariantEligibleChild`, `buildVariantEligibilityLines`, threaded through `planWeek`.
- `apps/api/src/modules/children/children.repository.ts` — added `findVariantEligibleByHousehold`.
- `apps/api/src/jobs/planner-context.loader.ts` — added `loadVariantEligibleChildrenForHousehold`.
- `apps/api/src/jobs/plan-generation.job.ts` — load variant-eligible children, pass to `planWeek`, persist post-commit.
- `apps/api/src/modules/plans/plans.service.ts` — accept optional `variantProposalService` dependency.
- `apps/api/src/modules/plans/plans.hook.ts` — wire `VariantProposalRepository` + `VariantProposalService`, decorate Fastify.
- `apps/api/src/modules/plans/plans.routes.ts` — `POST /v1/plans/:planId/variant-proposals/:proposalId/confirm`; include `variant_proposals` in `GET /v1/plans` response.
- `apps/web/src/features/plan/PlanTile.tsx` — render variant-proposal pills + `pending-input` border when a proposal is active.
- `apps/web/src/features/plan/PlanTile.test.tsx` — 5 new variant-proposal tests.
- `apps/web/src/features/plan/mutations.ts` — `useConfirmVariantProposalMutation`.
- `apps/web/src/features/plan/PlanPage.tsx` — index active proposals by `plan_item_id`, dispatch confirm mutation per tile.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 3-27 → review.

### Review Findings (2026-05-25 — 3-layer adversarial review)

- [x] [Review][Patch] **P1 — `confirm`/`reject` silently succeed on zero-row update** — No row-count check after UPDATE; adversary can POST any proposalId and receive 204 with no indication the operation was a no-op. Fix: inspect PostgREST `count` field; throw 404 if zero rows matched. [`apps/api/src/modules/plans/variant-proposal.repository.ts:53–73`]
- [x] [Review][Patch] **P2 — `commitInput.plan_id` passed to `createFromPlanOutput`, not the committed plan's actual UUID** — `plansService.commit()` may upsert to an existing plan row (different UUID); variant is stored against stale `plan_id`, so `findActiveByPlan` never returns it. Fix: use the plan_id returned from `commit()` rather than `commitInput.plan_id`. [`apps/api/src/jobs/plan-generation.job.ts:~434`]
- [x] [Review][Patch] **P3 — `findVariantEligibleByHousehold` reads `children.name` without decryption** — DISMISSED: `children.name` is stored plaintext; decryptRow confirms no decryption applied to name field in any path. — `children.name` is envelope-encrypted; every other repository path decrypts before returning. Raw ciphertext is injected as `child_name` into the planner prompt. Fix: apply `decryptField` to `row.name` consistent with the rest of the repository. [`apps/api/src/modules/children/children.repository.ts:204–216`]
- [x] [Review][Patch] **P4 — `plan-regeneration.job.ts` never calls `createFromPlanOutput`** — Variant proposals from user-triggered regenerations are silently discarded; no pending-input pills appear after manual regen. Fix: call `variantProposalService.createFromPlanOutput` post-commit in plan-regeneration.job.ts, matching the plan-generation pattern. [`apps/api/src/jobs/plan-regeneration.job.ts`]
- [x] [Review][Patch] **P5 — Surgical-swap retry path never updates `lastAttemptComposeOutput`** — `lastAttemptCommit` is updated but `lastAttemptComposeOutput` is not; `createFromPlanOutput` receives stale output when the swap rewrites the variant-proposal slot. Fix: set `lastAttemptComposeOutput = surgicalOutput` alongside `lastAttemptCommit` in the surgical-swap branch. [`apps/api/src/jobs/plan-generation.job.ts:~375`]
- [x] [Review][Patch] **P6 — Variant pills render unconditionally regardless of tile state** — Pills render whenever `variantProposal !== undefined`, including during `swap-in-progress` (keyboard-accessible behind the spinner overlay). Fix: guard pill rendering on `effectiveState === 'pending-input'` so pills only appear when the tile is in an interactable state. [`apps/web/src/features/plan/PlanTile.tsx:~190`]
- [x] [Review][Patch] **P7 — `PlanVariantProposalOutputSchema.day` allows `'saturday'`; plan items are Mon–Fri only** — A Saturday proposal passes Zod, matches no plan item, is silently skipped, and stays active indefinitely. Fix: narrow the enum to `['monday','tuesday','wednesday','thursday','friday']` to match `PlanComposeDaySchema`. [`packages/contracts/src/plan.ts:~720`]
- [x] [Review][Patch] **P8 — No test asserting `pending-input` border class when `variantProposal` is present** — Five new PlanTile tests confirm pill rendering and callbacks but none assert the `border-dashed border-amber-warm` treatment. Fix: add a test checking that the article element carries `border-dashed` when `variantProposal` is supplied with `state='decided'`. [`apps/web/src/features/plan/PlanTile.test.tsx`]

- [x] [Review][Defer] **D1 — No DB unique constraint preventing duplicate active proposals per plan** — Service-layer dedup is codebase norm; concurrent race is low probability. — deferred, pre-existing pattern
- [x] [Review][Defer] **D2 — Fresh `safeRandomUuid()` per mutation call** — Established pattern; server-side `.is('confirmed_at', null)` guard makes double-confirm a no-op. — deferred, pre-existing pattern
- [x] [Review][Defer] **D3 — No FK `plan_id → plans(id)` in `variant_proposals`** — Intentional design choice; UUID non-reuse makes orphans benign. — deferred, pre-existing
- [x] [Review][Defer] **D4 — `VariantProposalSchema` omits `base_rating`, `variant_rating`, `rating_delta_at`** — Explicitly deferred to Epic 4 per spec Dev Notes. — deferred, Epic 4
- [x] [Review][Defer] **D5 — `deriveBaseRecipeName` returns ingredient join, not a dish name** — Documented MVP deviation; forward-compatible once `plan_items.recipe_name` lands. — deferred, pre-existing
- [x] [Review][Defer] **D6 — `planId` URL param unused in confirm route** — Security invariant maintained via `householdId` check on proposal row; URL follows REST convention. — deferred, pre-existing

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.27 created — ready-for-dev. |
| 2026-05-25 | Amelia (Dev Agent) | Implementation complete — all 9 tasks done; 13 new API tests + 5 new web tests pass; status → review. |
| 2026-05-25 | Code Review | 3-layer adversarial review: 8 patches, 6 deferred, 6 dismissed. Status → in-progress. |
