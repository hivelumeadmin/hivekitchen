# Story 3.22: Passive Bias from Extra Removals + High-Activity Extra Proposal

Status: ready-for-dev

## Story

As a Primary Parent,
I want the system to passively weight my repeated removal of an Extra item as a preference signal, and to propose adding an Extra on high-activity days for children whose Extra is normally off,
So that Lumi learns from my actions without making me explain (FR116, FR119).

## Acceptance Criteria

1. **Given** Stories 3.20 + 3.21 are complete,
   **When** I remove the same Extra type ≥3 times within 30 days,
   **Then** that type's selection probability for that child drops in subsequent plans (passive bias, no UI confirmation).

2. **And** when an on-calendar high-activity event (sport practice, field trip) is detected for a child whose Extra is off, planner proposes adding an Extra for that day; I confirm before commit.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.20: `extra_active` per-child flag; `snack_skus` table; `plan_items.item_sku_id`
- Story 3.21: `children.extra_rules JSONB { pins, bans }`; `ExtraRulesRepository.updateExtraRules()` and `findExtraRules()`; Extra library
- Story 3.12: `plan_items.paused_at`; item swap mechanics — when a parent swaps out an Extra item (slot='extra'), this is the signal source
- Story 3.19: `day_overrides` table with `sport_practice` and `field_trip` types; `DayOverridesRepository.findActiveByHousehold()`
- `AUDIT_EVENT_TYPES`
- Agent Layer is stateless — passive bias signals must be persisted by the API, not the agent

**Key invariants:**
- Passive bias = no parent confirmation, no explicit UI signal. Silent model update.
- High-activity Extra proposal = explicit parent confirmation required per Principle 1
- All DB access through API layer only
- No `framer-motion`, logical-property lint

---

## Tasks / Subtasks

### Task 1 — DB Migration: `extra_removal_signals` table

Create `supabase/migrations/20260810000000_create_extra_removal_signals.sql`:

```sql
-- Story 3.22: tracks each time a parent removes an Extra item from a plan slot.
-- Used to compute passive bias after ≥3 removals of the same component_type in 30 days.
-- Records are kept 90 days then archived (nightly job).
CREATE TABLE IF NOT EXISTS extra_removal_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL,
  child_id        UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  component_type  TEXT NOT NULL,       -- e.g., 'sweet treat', 'chocolate bar', 'granola bar'
  plan_item_id    UUID REFERENCES plan_items(id) ON DELETE SET NULL,
  removed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set to true once this signal has contributed to a bias update (avoids double-counting).
  bias_applied    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_extra_removal_signals_child_type_date
  ON extra_removal_signals(child_id, component_type, removed_at)
  WHERE NOT bias_applied;
```

### Task 2 — `ExtraRemovalSignalService`: record and evaluate signals

Create `apps/api/src/modules/plans/extra-removal-signal.service.ts`:

```typescript
export class ExtraRemovalSignalService {
  private readonly BIAS_THRESHOLD = 3;     // removals needed to trigger bias
  private readonly WINDOW_DAYS = 30;       // rolling window

  constructor(
    private readonly client: SupabaseClient,
    private readonly extraRulesRepo: ExtraRulesRepository,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Called when a parent swaps out an Extra plan item.
  // Records the signal and triggers bias update if threshold is met.
  async recordRemoval(opts: {
    householdId: string;
    childId: string;
    componentType: string;
    planItemId: string;
    requestId: string;
  }): Promise<void> {
    if (!opts.componentType || opts.componentType.trim() === '') return;

    // 1. Insert the removal signal.
    const { error: insertError } = await this.client
      .from('extra_removal_signals')
      .insert({
        household_id: opts.householdId,
        child_id: opts.childId,
        component_type: opts.componentType,
        plan_item_id: opts.planItemId,
      });
    if (insertError) {
      this.logger.error({ insertError }, 'failed to insert extra_removal_signal');
      return;
    }

    // 2. Count unapplied removals for this (child, component_type) in the 30-day window.
    const windowStart = new Date();
    windowStart.setUTCDate(windowStart.getUTCDate() - this.WINDOW_DAYS);

    const { count, error: countError } = await this.client
      .from('extra_removal_signals')
      .select('id', { count: 'exact', head: true })
      .eq('child_id', opts.childId)
      .eq('component_type', opts.componentType)
      .eq('bias_applied', false)
      .gte('removed_at', windowStart.toISOString());

    if (countError || count === null) {
      this.logger.error({ countError }, 'failed to count extra_removal_signals');
      return;
    }

    // 3. If threshold met, add component_type to bans and mark signals as applied.
    if (count >= this.BIAS_THRESHOLD) {
      await this.applyBias({ childId: opts.childId, householdId: opts.householdId, componentType: opts.componentType, requestId: opts.requestId });
    }
  }

  private async applyBias(opts: {
    childId: string;
    householdId: string;
    componentType: string;
    requestId: string;
  }): Promise<void> {
    // Load current extra_rules and add the component_type to bans (if not already there).
    const current = await this.extraRulesRepo.findExtraRules(opts.childId);
    if (current.bans.includes(opts.componentType)) {
      return; // already banned — no action
    }

    const newRules = { pins: current.pins, bans: [...current.bans, opts.componentType] };
    await this.extraRulesRepo.updateExtraRules({
      childId: opts.childId,
      householdId: opts.householdId,
      pins: newRules.pins,
      bans: newRules.bans,
    });

    // Mark signals as applied.
    const windowStart = new Date();
    windowStart.setUTCDate(windowStart.getUTCDate() - this.WINDOW_DAYS);
    await this.client
      .from('extra_removal_signals')
      .update({ bias_applied: true })
      .eq('child_id', opts.childId)
      .eq('component_type', opts.componentType)
      .eq('bias_applied', false)
      .gte('removed_at', windowStart.toISOString());

    try {
      await this.auditService.write({
        event_type: 'plan.extra_bias_applied',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          child_id: opts.childId,
          component_type: opts.componentType,
          action: 'added_to_bans',
        },
      });
    } catch (err) {
      this.logger.error({ err }, 'audit write failed for extra_bias_applied — continuing');
    }

    this.logger.info(
      { childId: opts.childId, componentType: opts.componentType },
      'extra bias applied: component_type added to child extra bans',
    );
  }
}
```

### Task 3 — Hook into swap endpoint (Story 3.12) to record Extra removals

In `apps/api/src/modules/plans/plans.service.ts`, in the `swapItem()` method:

When a slot='extra' item is swapped (replaced), record the removal of the previous item's component_type.

The `plan_items` row for the old item has `item_sku_id` (for Snack SKUs) or `ingredients[0]` (for recipe-based extras). The component_type can be inferred from `item_sku_id` via `SnackSkusRepository.findById()`, or from the Extra library item name.

For MVP, record the component_type as the `slot` + `ingredients` first element (if any) — a coarse signal. Refine with `snack_skus.category` lookup if `item_sku_id` is set.

Add to `PlansService` constructor deps: `ExtraRemovalSignalService`.

In `swapItem()`, after the swap succeeds:
```typescript
// If the swapped-out item was in the 'extra' slot, record removal signal.
if (oldItem.slot === 'extra') {
  const componentType = await inferComponentType(oldItem);
  if (componentType) {
    void this.extraRemovalSignalService.recordRemoval({
      householdId: opts.householdId,
      childId: oldItem.child_id,
      componentType,
      planItemId: oldItem.id,
      requestId: opts.requestId,
    }).catch((err) => this.logger.error({ err }, 'extra removal signal failed — continuing'));
  }
}
```

`inferComponentType` helper:
```typescript
async function inferComponentType(item: PlanItemRow): Promise<string | null> {
  if (item.item_sku_id) {
    const sku = await snackSkusRepository.findById(item.item_sku_id);
    return sku?.category ?? null;
  }
  return item.ingredients[0] ?? null; // fallback: first ingredient as component type
}
```

### Task 4 — High-activity Extra proposal (FR119)

**When Lumi detects a high-activity day override for a child whose Extra is off:**

In `apps/api/src/modules/plans/day-overrides.service.ts` (Story 3.19), when creating a `sport_practice` or `field_trip` override for a child whose `extra_active` is false:

```typescript
// After creating the override, check if the child's Extra slot is off.
// If so, propose an Extra addition for that day (a Lumi-proposed override).
if (
  ['sport_practice', 'field_trip'].includes(opts.input.override_type) &&
  !childExtraActive // load from children table
) {
  // Create a proposal record: a Lumi-proposed day_override of a new type 'extra_proposed'.
  // For now, just flag it in audit — actual proposal delivery is via SSE (Story 5.2)
  // or Brief notification (Story 3.26).
  // MVP: surface the proposal in the PlanTile as a pending-input state.
  // See Dev Notes.
}
```

**FR119 implementation for MVP:** When the orchestrator is generating a plan for a week that contains an active `sport_practice` or `field_trip` day_override for a child whose Extra is off, inject a prompt instruction:

```typescript
// In plan-generation.job.ts contextLines:
const highActivityOverrides = activeOverrides.filter(
  (o) => ['sport_practice', 'field_trip'].includes(o.override_type) && !child.extra_active,
);
for (const override of highActivityOverrides) {
  contextLines.push(
    `On ${override.override_date}, ${childName} has a ${override.override_type}. ` +
    `Their Extra slot is normally OFF. Propose one Extra item for this day only — ` +
    `mark it as PENDING_PARENT_CONFIRMATION in the plan output.`,
  );
}
```

The `plan.compose` tool output must support a `requires_confirmation: boolean` flag on individual items. This may require extending `PlanComposeOutput` — defer a full implementation to a follow-up story if the schema change is too large. For MVP, create the proposal as a `day_override` row with `is_lumi_proposed=true, confirmed_at=null` and surface it on the PlanTile as a pending-input card.

### Task 5 — Audit event types

```typescript
'plan.extra_bias_applied',
'plan.extra_proposal_created',
```

### Task 6 — Tests

- `ExtraRemovalSignalService.recordRemoval()` — below threshold: no ban; at threshold: adds to bans; already banned: no duplicate
- `ExtraRemovalSignalService.applyBias()` — marks signals as `bias_applied=true`
- `ExtraRemovalSignalService.recordRemoval()` — failure to insert signal does NOT throw (fire-and-forget)

---

## Dev Notes

### Passive bias is silent — no UI confirmation

FR116 says "silently biasing future Extra-slot content selection for that child." This is implemented by adding the component_type to `children.extra_rules.bans` after ≥3 removals. The planner agent sees the ban in its prompt context and excludes that type. No notification, no confirmation prompt, no banner.

This is a product decision: passive learning is invisible to the parent. The audit log records `plan.extra_bias_applied` for ops visibility.

### Component type inference is coarse for MVP

The `inferComponentType()` function in Task 3 uses snack SKU category or the first ingredient as a proxy for component type. This is imprecise (e.g., "apple" → "fruit" only if it's a SKU; otherwise just "apple"). Consider adding a `component_type` column to `plan_items` (populated at plan-compose time) in a follow-up story. For MVP, coarse inference is acceptable. Defer to `deferred-work.md`.

### FR119 high-activity proposal complexity

The full FR119 implementation (planner proposes Extra for sport/field-trip days with Extra off) requires:
1. Plan output format supports `requires_confirmation` per item
2. Frontend shows a "Lumi is suggesting an Extra — confirm?" card in PlanTile `pending-input` state
3. Parent confirms → item is committed; declines → item is dropped

This is a non-trivial schema + UX change. For MVP, inject the proposal as context into the planner prompt and create a Lumi-proposed `day_override` row. Full confirmation flow is a Story 3.22 follow-up. Defer to `deferred-work.md`.

### Signal decay / window

The 30-day rolling window means the same parent could remove "granola bar" 3 times over 6 weeks (2+1 in 30 days) without triggering the bias. The threshold resets after `bias_applied=true` marks the signals. This means a parent who genuinely dislikes a type and removes it repeatedly will keep triggering the bias (which adds to bans repeatedly — but the duplicate guard in `applyBias` prevents double-adding). Acceptable at MVP scale.

---

## Project Structure

**New files:**
```
supabase/migrations/20260810000000_create_extra_removal_signals.sql
apps/api/src/modules/plans/extra-removal-signal.service.ts
apps/api/src/modules/plans/extra-removal-signal.service.test.ts
```

**Modified files:**
```
apps/api/src/audit/audit.types.ts                          + plan.extra_bias_applied, plan.extra_proposal_created
apps/api/src/modules/plans/plans.service.ts                + swapItem() hooks into ExtraRemovalSignalService; inject ExtraRemovalSignalService dep
apps/api/src/modules/plans/plans.hook.ts                   + instantiate ExtraRemovalSignalService; inject into PlansService
apps/api/src/jobs/plan-generation.job.ts                   + high-activity override detection + prompt injection
_bmad-output/implementation-artifacts/sprint-status.yaml   3-22 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md     + component_type column on plan_items; FR119 full confirmation flow
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.22 created — ready-for-dev. |
