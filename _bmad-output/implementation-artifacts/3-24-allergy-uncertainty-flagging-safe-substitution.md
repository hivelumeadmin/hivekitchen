# Story 3.24: Allergy-Uncertainty Flagging + Safe Substitution

Status: done

**Slice key:** `3-24-allergy-uncertainty-flagging-safe-substitution`
**Epic:** 3 — Weekly Plan & Ready-Answer Open
**Builds on:** 3.23 (`slotScopeContext` positional-arg pattern in `planWeek()`), 3.31 (RecipeAgent compound-ingredient rationale — Architectural Decision #4 defers allergen-confidence classification to this story), 2.6-s8 (per-child allergens now read from `child_allergens` table via `AllergyGuardrailRepository`)
**Unblocks:** 3-25 (hard-fail escalation), 3-29 (degraded-propose state)

---

## Story

As a Primary Parent,
I want plan items with unverifiable ingredient provenance flagged for safety, with safe substitution where possible or a clear affordance for me to resolve it,
so that a compound ingredient like "garam masala" or "curry paste" never ships as silent risk when my child has a declared allergen (FR81).

---

## Background: Why This Story Exists

Story 3.31 (RecipeAgent, now done) explicitly decided:
> "No per-ingredient `allergen_confidence` field. RecipeAgent does NOT attempt to pre-classify ingredients as 'clear' vs 'uncertain' — that responsibility stays in the guardrail (Story 3-24's concern)."

The current engine's `evaluate()` already returns `uncertain` for **infrastructure failures** (empty inputs, no rules loaded, FALCPA baseline missing, decrypt failure). But it returns `cleared` for compound/processed ingredients like "garam masala", "curry paste", "ranch dressing" — ingredients whose allergen content cannot be determined from the string alone. For a household with declared allergens, these represent unverified provenance (FR81).

This story adds **compound ingredient detection** to the engine so those cases return `uncertain('compound_ingredient_unverified')` instead of silently clearing — and wires the swap infrastructure to attempt substitution before surfacing to the parent.

---

## Scope and Non-Scope

**In scope:**
- Engine: add `COMPOUND_SUSPECT_TOKENS` + `isSuspectCompound()` helper; compound detection pass at end of `evaluate()` for children with ≥1 `parent_declared` rule.
- Engine: also add `worcestershire` → `fish` and `za'atar`/`zaatar` → `sesame` to `FALCPA_SYNONYMS` (unambiguous compounds already caught by synonym expansion; this closes two known gaps).
- Contracts: add `FlaggedCompoundItemSchema`, extend `uncertain` variant with optional `flagged_items`.
- Service (`PlansService.commit()`): split `uncertain` handling — compound uncertainty → attempt swap via `regenerate()` callback; infrastructure uncertain → throw immediately (unchanged).
- Swap helper (`trySurgicalSwap`): extend to also source flagged slots from compound-uncertain rejections, build `uncertainContext` string for the orchestrator.
- Orchestrator (`planWeek()`): add `uncertainContext?: string` as 8th positional param; unshift to `contextLines` when present.
- Guardrail service: update compound-uncertain audit event to include `flagged_items` in metadata; use `logger.warn` not `logger.error` for compound uncertain (infrastructure failures stay `logger.error`).
- Frontend: new `<AllergyUncertaintyBanner>` component shown on the plan view when compound uncertainty exhausted all retries — displays flagged ingredient + slot, "Try again" (full regen) + per-slot "Swap" CTAs.
- Deferred-work: update existing planWeek() param-count entry.

**Out of scope:**
- "Mark as safe" household-level override for specific compound ingredients (no new override table).
- Structural merge layer for compound-uncertain swaps (deferred — same posture as slot-scope structural merge from 3.23 dev notes).
- Adding broader synonym expansion beyond worcestershire + za'atar (separate story, separate diff).
- Catching FALCPA allergens inside known compounds that ARE already caught by `FALCPA_SYNONYMS` — tahini (sesame), miso (soy), etc. already produce `blocked` before compound detection runs.

---

## Acceptance Criteria

### AC1 — Engine detects compound ingredients and returns `uncertain` with `flagged_items`

**Given** a household has ≥1 `parent_declared` allergen rule for a child,
**And** a plan item for that child contains an ingredient matching a `COMPOUND_SUSPECT_TOKEN` (e.g., `"garam masala"`),
**And** that ingredient does NOT already trigger a `blocked` verdict via the existing allergen-matching loop,
**When** the guardrail engine evaluates the plan,
**Then** `evaluate()` returns `{ verdict: 'uncertain', conflicts: [], reason: 'compound_ingredient_unverified', flagged_items: [{ child_id, ingredient, slot, day }] }`.

**And** if a child has **only** FALCPA rules (no `parent_declared`), compound ingredients for that child are NOT flagged — compound detection is scoped to households that have declared specific allergens.

**And** if the plan also contains a FALCPA-matched blocked conflict, the engine returns `blocked` (not `uncertain`) — blocked takes priority and runs first.

### AC2 — `GuardrailResultSchema` extended (backward-compatible)

`packages/contracts/src/plan.ts` gains `FlaggedCompoundItemSchema` and the `uncertain` discriminated-union member gains an optional `flagged_items: z.array(FlaggedCompoundItemSchema)`. Existing `uncertain` returns (no `flagged_items`) remain valid. `@hivekitchen/types` auto-updates via `z.infer`.

### AC3 — `PlansService.commit()` differentiates compound vs. infrastructure uncertain

**Given** `allergyGuardrail.clearOrReject()` returns `{ verdict: 'uncertain', reason: 'compound_ingredient_unverified', flagged_items: [...] }`,
**When** `commit()` handles the verdict,
**Then** it pushes the result onto `rejections` and calls `regenerate(rejections)` — same retry path as `blocked`.

**And** for any `uncertain` result where `reason !== 'compound_ingredient_unverified'` (e.g., `'empty_ingredients'`, `'no_rules_loaded'`, `'falcpa_baseline_missing'`, `'allergen_data_decrypt_failure'`), `commit()` still throws `GuardrailRejectionError` immediately — no change to infrastructure-uncertain behaviour.

### AC4 — `trySurgicalSwap` handles compound-uncertain flagged items

**Given** `rejections` contains an `uncertain` result with `reason === 'compound_ingredient_unverified'` and `flagged_items: [{child_id, ingredient, slot, day}, ...]`,
**When** `trySurgicalSwap` is called,
**Then** it:
1. Extracts the flagged `(child_id, day, slot)` tuples from `flagged_items`, deduplicates into `blockedKeys`.
2. Builds `BlockedItem` entries (original ingredients from `previousCommit` for those slots, with `blocked_by: [{ allergen: 'unknown_compound', ingredient }]` as a sentinel).
3. Constructs `uncertainContext`: `"ALLERGEN-UNCERTAIN: Replace the following items — use only single-ingredient items of unambiguous provenance (no sauces, spice blends, pastes, or compound products): [child_id|day|slot list]"`.
4. Passes `uncertainContext` to `orchestrator.planWeek()` as the 8th arg so the planner receives it as a high-priority constraint.

**And** if `rejections` contains BOTH `blocked` conflicts AND compound-uncertain flagged items, `trySurgicalSwap` merges both slot sets and proceeds.

**And** if `rejections` contains only `uncertain` verdicts where `reason !== 'compound_ingredient_unverified'` (infrastructure failure), `trySurgicalSwap` returns `null` — unchanged behaviour.

### AC5 — `Orchestrator.planWeek()` gains 8th positional param `uncertainContext`

`orchestrator.ts` gains `uncertainContext?: string` as the 8th positional parameter. When defined, `contextLines.unshift(uncertainContext)`. When undefined, behaviour is unchanged. Pattern is identical to `slotScopeContext` (7th param from 3.23).

### AC6 — Compound-uncertain audit event includes `flagged_items`

`AllergyGuardrailService.clearOrReject()` writes `allergy.uncertainty` with `metadata: { reason, flagged_items: result.flagged_items ?? [], guardrail_version }` for compound-uncertain. Infrastructure-uncertain continues to write `metadata: { reason, guardrail_version }` with no `flagged_items`. Log level for compound uncertain is `logger.warn`; infrastructure uncertain stays `logger.error`.

### AC7 — `<AllergyUncertaintyBanner>` renders when compound uncertainty is unresolved

On the plan view, when the backend signals compound-uncertainty exhausted retries (via error response or plan flag — see Dev Notes for API contract options), the banner:
- Names the flagged ingredient(s), slot, and day.
- Provides "Try again" → fires `POST /v1/plans/regen` (Story 3.13 endpoint).
- Provides per-flagged-item "Swap [slot]" link → opens existing per-slot swap UI (Story 3.12).

---

## Critical Context — DO NOT Reinvent

### Current `uncertain` handling in `PlansService.commit()` (line ~263)

```typescript
if (result.verdict === 'uncertain') {
  // Infrastructure failure — not a safety conflict. Regeneration cannot fix this; exit immediately.
  throw new GuardrailRejectionError(planId, attempt);
}
```

This story **splits** this branch: compound-uncertain → retry via `regenerate()`; infrastructure-uncertain → throw (unchanged).

### Current `trySurgicalSwap` early-return (line ~51 in `swap-retry.helper.ts`)

```typescript
if (blockedConflicts.length === 0) {
  // Only 'uncertain' verdicts — swap can't help (no specific allergen + ingredient pair).
  return null;
}
```

This story **extends** this: compound-uncertain CAN be swapped (we have `flagged_items`). Infrastructure-uncertain still returns `null`.

### `planWeek()` current signature (7 args after 3.23)

```typescript
planWeek(
  householdId: string,       // 1
  weekOf: string,            // 2
  requestId: string,         // 3
  contextLines: string[],    // 4
  existingItems: PlanItemRow[], // 5
  dayScope?: string,         // 6
  slotScopeContext?: string, // 7 — added 3.23
): Promise<PlanComposeOutput>
```

Add `uncertainContext?: string` as param 8. Deferred-work entry says "7 positional parameters" — update it to "8 positional parameters."

### Compound detection: what the existing engine already catches

`FALCPA_SYNONYMS` already catches many known compounds:
- `"tahini"` → sesame ✓ (already in `sesame` synonyms)
- `"soy sauce"` → soy ✓ (already in `soy` synonyms)
- `"miso"` → soy ✓ (already in `soy` synonyms)
- `"aioli"` → egg ✓ (already in `egg` synonyms)

This means the blocked/compound priority is correctly handled: if the ingredient matches a synonym, the main conflict loop fires `blocked` BEFORE compound detection runs. Compound detection only fires when the ingredient does NOT match any known allergen.

### Per-child scoping in compound detection

```typescript
// Only flag compound ingredients for children with parent_declared allergens.
const childHasParentDeclared = rules.some(
  (r) => ruleAppliesToChild(r, item.child_id) && r.rule_type === 'parent_declared',
);
if (!childHasParentDeclared) continue;
```

A compound ingredient for a FALCPA-only child (no declared specific allergens) is NOT flagged. Those households rely on the engine catching known FALCPA allergens; compound detection adds no value for them and would produce false positives.

### Evaluation order in `evaluate()` after this story

1. Fail-closed infrastructure checks (size limits, empty inputs) → `uncertain` (unchanged)
2. Rules sanity checks (no rules, FALCPA baseline missing) → `uncertain` (unchanged)
3. Full allergen conflict loop over all items × rules → if conflicts → `blocked` (unchanged)
4. **NEW:** Compound suspect scan (only runs if step 3 would produce `cleared`) → if suspect compounds for children with `parent_declared` rules → `uncertain('compound_ingredient_unverified')`
5. → `cleared` (unchanged)

### `swapBlockedItems` vs `planWeek` in the orchestrator

Before adding `uncertainContext`, verify how `swapBlockedItems` in `orchestrator.ts` calls the composer internally. If it calls `planWeek()` directly, add `uncertainContext` to that call site. If it has an independent compose path, add a `uncertainContext?: string` field on `SwapBlockedItemsInput` instead and pipe it to `contextLines.unshift()` within that path.

---

## Tasks / Subtasks

### [x] T1 — Augment `FALCPA_SYNONYMS` in `allergy-rules.engine.ts`

Add to `fish`:
```typescript
'worcestershire', // contains anchovies
```

Add to `sesame`:
```typescript
"za'atar", 'zaatar', // sesame-seed spice blend
```

Covered by new engine tests (T9).

### [x] T2 — Add `FlaggedCompoundItemSchema` to contracts

In `packages/contracts/src/plan.ts`, before `GuardrailResultSchema`:

```typescript
export const FlaggedCompoundItemSchema = z.object({
  child_id: z.string().uuid(),
  ingredient: z.string().min(1).max(INGREDIENT_MAX),
  slot: z.string().min(1).max(SLOT_MAX),
  day: z.string().min(1).max(SLOT_MAX),
});
export type FlaggedCompoundItem = z.infer<typeof FlaggedCompoundItemSchema>;
```

Extend the `uncertain` union member:
```typescript
z.object({
  verdict: z.literal('uncertain'),
  conflicts: z.array(ConflictSchema),
  reason: z.string().min(1).max(200),
  flagged_items: z.array(FlaggedCompoundItemSchema).optional(), // new
}),
```

`@hivekitchen/types` exports `z.infer<typeof GuardrailResultSchema>` — the union type updates automatically. No separate `packages/types` change needed beyond any re-export that imports this type.

### [x] T3 — Add compound detection to `allergy-rules.engine.ts`

Add exported constants and helpers after `FALCPA_SYNONYMS`:

```typescript
// Compound/processed products where allergen content cannot be determined from
// the ingredient string alone. Each entry is a lowercase substring that signals
// a multi-ingredient processed product. Checked ONLY for items belonging to
// children with ≥1 parent_declared rule (FALCPA-only households are exempt).
export const COMPOUND_SUSPECT_TOKENS = [
  'masala',      // garam masala, biryani masala, tikka masala paste
  'seasoning',   // taco seasoning, Italian seasoning, fajita seasoning
  'pesto',       // pine nuts (tree_nut) + parmesan (dairy) — not in current synonyms
  'dressing',    // ranch (dairy+egg), caesar (egg+fish)
  'marinade',    // teriyaki marinade (soy+sesame), ginger soy marinade
  'chutney',     // processed condiment — content varies by recipe
  ' blend',      // "spice blend", "herb blend" (leading space avoids matching "blended")
  'curry paste', // tree nuts, fish sauce (shellfish), sesame oil — all possible
] as const;

// Exported for unit testing.
export function isSuspectCompound(ingredient: string): boolean {
  const lower = ingredient.trim().toLowerCase();
  return (COMPOUND_SUSPECT_TOKENS as readonly string[]).some((token) => lower.includes(token));
}
```

Add compound detection at the **end** of `evaluate()`, after the main conflict loop, before the `cleared` return:

```typescript
// Compound suspect scan — only runs when plan would otherwise be cleared.
// Only flags items for children with ≥1 parent_declared rule.
const compoundFlags: FlaggedCompoundItem[] = [];
for (const item of planItems) {
  const childHasParentDeclared = rules.some(
    (r) => ruleAppliesToChild(r, item.child_id) && r.rule_type === 'parent_declared',
  );
  if (!childHasParentDeclared) continue;
  for (const ingredient of item.ingredients) {
    if (isSuspectCompound(ingredient)) {
      compoundFlags.push({ child_id: item.child_id, ingredient, slot: item.slot, day: item.day });
    }
  }
}
if (compoundFlags.length > 0) {
  return {
    verdict: 'uncertain',
    conflicts: [],
    reason: 'compound_ingredient_unverified',
    flagged_items: compoundFlags,
  };
}

return { verdict: 'cleared', conflicts: [] };
```

Import `FlaggedCompoundItem` from `@hivekitchen/types` — add to the import at line 1.

### [x] T4 — Split `uncertain` handling in `PlansService.commit()`

In `apps/api/src/modules/plans/plans.service.ts`, replace the existing `uncertain` throw at line ~263:

```typescript
if (result.verdict === 'uncertain') {
  if (result.reason === 'compound_ingredient_unverified') {
    // Compound uncertainty is recoverable — attempt substitution the same way
    // the 'blocked' path does: push onto rejections and call regenerate().
    rejections.push(result);
    this.logger.warn(
      {
        plan_id: planId,
        attempt,
        reason: result.reason,
        flagged_count: result.flagged_items?.length ?? 0,
      },
      'compound-uncertain ingredients flagged — attempting substitution via regenerate callback',
    );
    if (attempt < MAX_GUARDRAIL_RETRIES) {
      try {
        current = await regenerate(rejections);
      } catch (err) {
        this.logger.error(
          { plan_id: planId, attempt, err },
          'regenerate callback threw during compound-uncertain retry',
        );
        throw new GuardrailRejectionError(planId, attempt);
      }
    }
    // continue to next loop iteration — avoids fall-through to the final throw
    continue; // NOTE: only valid if the guardrail retry loop uses `for` with `continue`
  }
  // Infrastructure failure (empty_ingredients, no_rules_loaded, decrypt_failure, etc.)
  // — regeneration cannot fix this; exit immediately.
  throw new GuardrailRejectionError(planId, attempt);
}
```

> **Dev note:** The `commit()` method uses a `for (let attempt = 1; attempt <= MAX_GUARDRAIL_RETRIES; attempt++)` loop. Verify the exact loop structure before adding `continue`. If the loop uses a different control flow, adapt accordingly — the intent is: compound-uncertain pushes onto `rejections`, calls `regenerate`, and loops back for the next attempt. Non-compound-uncertain throws immediately.

### [x] T5 — Extend `trySurgicalSwap` in `swap-retry.helper.ts`

Replace the existing early-return check (lines ~46–55):

```typescript
const blockedConflicts = opts.rejections.flatMap((r) =>
  r.verdict === 'blocked' ? r.conflicts : [],
);

// Compound-uncertain flagged items can also be swapped — we have (child, day, slot) tuples.
const compoundFlaggedTuples = opts.rejections.flatMap((r) =>
  r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'
    ? (r.flagged_items ?? [])
    : [],
);

if (blockedConflicts.length === 0 && compoundFlaggedTuples.length === 0) {
  // Only infrastructure-uncertain verdicts — swap can't help.
  // Fall through to caller's full-regen path.
  return null;
}
```

Build `uncertainContext` when compound flags exist:

```typescript
let uncertainContext: string | undefined;
if (compoundFlaggedTuples.length > 0) {
  const slots = compoundFlaggedTuples
    .map((f) => `${f.child_id.slice(0, 8)}|${f.day}|${f.slot}`)
    .join(', ');
  uncertainContext =
    `ALLERGEN-UNCERTAIN: Replace the following items — use only single-ingredient items ` +
    `of unambiguous provenance (no sauces, spice blends, pastes, or compound products): ${slots}`;
}
```

Merge compound-flagged tuples into `blockedKeys`:

```typescript
const blockedKeys = new Set<SlotKey>([
  ...blockedConflicts.map((c) => makeKey(c.child_id, c.day, c.slot)),
  ...compoundFlaggedTuples.map((f) => makeKey(f.child_id, f.day, f.slot)),
]);
```

Update `buildBlockedItems` call so compound-flagged slots get entries too. For compound-flagged items, there's no known allergen — construct a synthetic conflict with `allergen: 'unknown_compound'` so `buildBlockedItems` can find the corresponding item in `previousCommit`:

```typescript
// Combine blocked conflicts + synthetic compound-flagged conflicts for buildBlockedItems
const allConflictsForSwap = [
  ...blockedConflicts,
  ...compoundFlaggedTuples.map((f) => ({
    child_id: f.child_id,
    day: f.day,
    slot: f.slot,
    allergen: 'unknown_compound' as const,
    ingredient: f.ingredient,
  })),
];
const blockedItems = buildBlockedItems(opts.previousCommit, allConflictsForSwap);
```

Pass `uncertainContext` to the orchestrator. The exact mechanism depends on how `swapBlockedItems` calls `planWeek()` (see Dev Notes). Either:
- Add `uncertainContext?: string` to `SwapBlockedItemsInput` and pipe it inside the orchestrator, OR
- Pass it as the 8th arg to any `planWeek()` call inside the swap path.

Return the `uncertainContext` to the caller via the function return so the regen worker can log it. Or thread it as part of the function's internal state — whichever is cleaner given the orchestrator's swap structure.

### [x] T6 — Add `uncertainContext` to `Orchestrator.planWeek()`

In `apps/api/src/agents/orchestrator.ts`, append `uncertainContext?: string` as the 8th positional parameter:

```typescript
async planWeek(
  householdId: string,
  weekOf: string,
  requestId: string,
  contextLines: string[],
  existingItems: PlanItemRow[],
  dayScope?: string,
  slotScopeContext?: string,
  uncertainContext?: string,  // NEW — 3.24
): Promise<PlanComposeOutput> {
  if (slotScopeContext !== undefined) {
    contextLines.unshift(slotScopeContext);
  }
  if (uncertainContext !== undefined) {
    contextLines.unshift(uncertainContext);  // highest priority — safety constraint
  }
  // ... rest unchanged
}
```

> If `slotScopeContext` and `uncertainContext` are both defined, `uncertainContext.unshift` runs second so it ends up at position 0 (highest priority). This is intentional — allergen uncertainty is more safety-critical than slot scope.

Update the deferred-work entry (find the EXISTING entry, update the number, do NOT create a new entry):
- From: "planWeek() now has **7** positional parameters"
- To: "planWeek() now has **8** positional parameters (3.23 added slotScopeContext; 3.24 added uncertainContext)"

### [x] T7 — Update `AllergyGuardrailService.clearOrReject()` for compound uncertain

In `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`, update the `uncertain` branch:

```typescript
} else if (result.verdict === 'uncertain') {
  const isCompound = result.reason === 'compound_ingredient_unverified';
  if (isCompound) {
    this.logger.warn(
      {
        household_id: householdId,
        request_id: requestId,
        reason: result.reason,
        flagged_count: result.flagged_items?.length ?? 0,
        guardrail_version: GUARDRAIL_VERSION,
      },
      'allergy guardrail: compound ingredients flagged — substitution will be attempted',
    );
  } else {
    this.logger.error(
      {
        household_id: householdId,
        request_id: requestId,
        reason: result.reason,
        guardrail_version: GUARDRAIL_VERSION,
      },
      'allergy guardrail returned uncertain — refusing to render',
    );
  }
  await this.auditService.write({
    event_type: 'allergy.uncertainty',
    household_id: householdId,
    request_id: requestId,
    metadata: {
      reason: result.reason,
      flagged_items: result.flagged_items ?? [],  // populated for compound, empty for infra
      guardrail_version: GUARDRAIL_VERSION,
    },
  });
```

Also update `writeDecision` to store `flagged_items` in the `conflicts` JSONB when verdict is compound-uncertain (the column is `unknown[]` / JSONB, so this is schema-compatible):

```typescript
await this.repo.writeDecision({
  household_id: householdId,
  verdict: result.verdict,
  guardrail_version: GUARDRAIL_VERSION,
  // Store flagged_items for compound uncertain; conflicts[] for blocked; [] otherwise.
  conflicts:
    result.verdict === 'blocked'
      ? result.conflicts
      : result.verdict === 'uncertain'
        ? (result.flagged_items ?? [])
        : [],
  request_id: requestId,
});
```

### [x] T8 — Frontend `<AllergyUncertaintyBanner>` component

New file: `apps/web/src/features/plan/AllergyUncertaintyBanner.tsx`

```typescript
interface FlaggedItem {
  ingredient: string;
  slot: string;
  day: string;
  childName: string;
}

interface AllergyUncertaintyBannerProps {
  flaggedItems: FlaggedItem[];
  onRetry: () => void;
  onSwapSlot: (day: string, slot: string) => void;
}

export function AllergyUncertaintyBanner({
  flaggedItems,
  onRetry,
  onSwapSlot,
}: AllergyUncertaintyBannerProps) {
  // Render: surface the specific flagged items + two CTAs.
  // Style: match existing plan-view error / empty states. Do NOT use red
  // (this is a safety flag, not an error — use amber or the design system's
  // warning surface token). Check docs/DESIGN.md for the correct surface token.
}
```

**Wire to the plan view:** When `GET /v1/plans?week=current` returns a plan where compound uncertainty was unresolved (see Dev Notes — API contract decision), render `<AllergyUncertaintyBanner>` in the plan page alongside (or instead of) the plan content.

> **DO NOT** create a generic `<AccountableError>` component. The architecture names `/errors/allergy-uncertainty` as a dedicated domain; that broad component will be built in a subsequent story. This banner is the specific plan-view manifestation of unresolved compound uncertainty.

### [x] T9 — Tests

**`allergy-rules.engine.test.ts`** — add:
- `worcestershire` → blocked via fish (new FALCPA synonym)
- `za'atar` / `zaatar` → blocked via sesame (new FALCPA synonym)
- `isSuspectCompound('garam masala')` → `true`
- `isSuspectCompound('chicken')` → `false`
- `isSuspectCompound('ranch dressing')` → `true`
- Child with `parent_declared` peanut rule + `"garam masala"` item → `uncertain('compound_ingredient_unverified')` with `flagged_items` containing the item
- Child with ONLY FALCPA rules + `"garam masala"` → `cleared` (FALCPA-only skips compound check)
- Plan with BOTH blocked peanut item AND `"garam masala"` compound → `blocked` (blocked wins)
- Compound detection does NOT fire when plan would be `blocked` (verify evaluation order)

**`swap-retry.helper.test.ts`** — add:
- `rejections` with only `uncertain + reason: 'compound_ingredient_unverified'` + `flagged_items` → `trySurgicalSwap` does NOT return `null` early; returns a merged `CommitPlanInput` (mock orchestrator returns clean swap)
- `uncertainContext` string passed to orchestrator contains `'ALLERGEN-UNCERTAIN'`
- `rejections` with only `uncertain + reason: 'no_rules_loaded'` → returns `null` (unchanged)
- Mixed `blocked` + compound uncertain → proceeds on merged slot set

**`plans.service.test.ts`** — add:
- `clearOrReject` returns `uncertain + reason: 'compound_ingredient_unverified'` → `regenerate()` is called (not `GuardrailRejectionError`)
- `clearOrReject` returns `uncertain + reason: 'empty_ingredients'` → `GuardrailRejectionError` thrown immediately
- `clearOrReject` returns `uncertain + reason: 'no_rules_loaded'` → `GuardrailRejectionError` thrown immediately

**`packages/contracts/src/plan.test.ts`** — add:
- `FlaggedCompoundItemSchema` parses valid shape
- `GuardrailResultSchema` accepts `uncertain` with `flagged_items` populated
- `GuardrailResultSchema` accepts `uncertain` without `flagged_items` (backward-compat)

### [x] T10 — Typecheck + tests

```bash
pnpm --filter @hivekitchen/api typecheck
pnpm --filter @hivekitchen/api exec vitest run src/modules/allergy-guardrail
pnpm --filter @hivekitchen/api exec vitest run src/jobs
pnpm --filter @hivekitchen/api exec vitest run src/modules/plans
pnpm --filter @hivekitchen/contracts exec vitest run
pnpm --filter @hivekitchen/web typecheck
```

All must pass with zero new failures. Pre-existing failures (if any) confirmed by stash-and-compare before attributing to this story.

### [x] T11 — Sprint status + deferred work

- Flip `3-24-allergy-uncertainty-flagging-safe-substitution` in `sprint-status.yaml`: `backlog` → `ready-for-dev` (done at story-author time, not by the dev agent).
- In `deferred-work.md`, **update** the existing entry under "Deferred from: implementation of 3-23": change "7 positional parameters" to "8 positional parameters"; note 3.24 added `uncertainContext`.
- Add a new deferred entry under "Deferred from: implementation of 3-24":
  - Compound-uncertain swap uses prompt instruction (same posture as slot-scope prompt instruction in 3.23); structural merge layer deferred.
  - "Mark as safe" household-level compound-ingredient override — no override table introduced; deferred.

---

## Dev Notes

### Why two `uncertain` sub-types live in the same verdict

The engine uses `uncertain` for both infrastructure failures AND compound ingredient flags. The `reason` string discriminates them. A separate `flagged` verdict was considered but rejected because:
1. It would add a new discriminated-union branch and require more consumer-side changes.
2. `uncertain + reason: 'compound_ingredient_unverified'` reads correctly as "safety-uncertain (data quality), not system-uncertain (infrastructure)."
3. Backward-compat: existing code that checks `result.verdict === 'uncertain'` continues to work; only the `PlansService.commit()` branch needs to additionally check `result.reason`.

### Priority: `blocked` before compound detection

The engine's blocked/compound priority is guaranteed by evaluation order. The compound suspect scan ONLY runs when the plan would otherwise reach the `cleared` return. If the main conflict loop fires `blocked` first, we never reach the compound scan. This is not a conditional check — it's the natural flow of the function.

### API contract for surfacing compound uncertainty to the frontend

When compound uncertainty exhausts all retries, `PlansService.commit()` ultimately throws `GuardrailRejectionError`. The job worker catches this and marks the BullMQ job failed. The frontend's current "no plan yet" state shows when the job fails. For story 3-24 to render `<AllergyUncertaintyBanner>`, we need to distinguish "plan not generated yet" from "plan failed due to compound uncertainty."

**Simplest MVP path:** When `commit()` throws `GuardrailRejectionError` after exhausting retries on compound-uncertain rejections, the worker writes a `plan.generation_failed` audit event with `metadata.reason: 'compound_ingredient_unverified'` and the `flagged_items`. The `GET /v1/plans?week=current` response then includes a `generation_failure?: { reason, flagged_items }` field when no cleared plan exists but a compound-uncertainty failure was recorded. The frontend reads this and renders the banner.

> This is a new field on the existing plan-list response — minimal change. The dev agent should check whether `GET /v1/plans` already has a mechanism for surfacing job-failure metadata before implementing a new one.

### `swapBlockedItems` orchestrator internals

Before adding `uncertainContext` to the orchestrator, read `orchestrator.ts swapBlockedItems()` to understand how it composes the swap plan. It likely calls an internal variant of `planWeek()` with a narrower prompt. The `uncertainContext` string must reach the planner's context lines within that call. Two options:
1. Add `uncertainContext?: string` to `SwapBlockedItemsInput` and thread it internally.
2. Add `uncertainContext` as a 2nd arg on the existing internal compose call within `swapBlockedItems`.

Either is fine — consistency with the codebase is more important than a specific approach.

### `deferred-work.md` update: find, don't duplicate

The entry reads:
> `planWeek() now has 7 positional parameters — carried forward from 3.18 and 3.22; this story adds slotScopeContext?: string as the 7th. Options-object refactor still deferred...`

Find this exact entry and update "7" to "8" and add note about `uncertainContext`. DO NOT create a duplicate entry.

---

## Project Structure

**Modified files:**
```
packages/contracts/src/plan.ts                                    T2 — FlaggedCompoundItemSchema + uncertain variant extended
apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts    T1, T3 — new FALCPA synonyms + compound detection
apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts  T7 — compound-uncertain audit + log level
apps/api/src/modules/plans/plans.service.ts                       T4 — split uncertain handling in commit()
apps/api/src/jobs/swap-retry.helper.ts                            T5 — compound uncertain → swap path
apps/api/src/agents/orchestrator.ts                               T6 — uncertainContext 8th param
apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts  T9 — engine tests
apps/api/src/jobs/swap-retry.helper.test.ts                       T9 — swap helper tests
apps/api/src/modules/plans/plans.service.test.ts                  T9 — service tests (verify exact file name)
packages/contracts/src/plan.test.ts                               T9 — contract tests
_bmad-output/implementation-artifacts/sprint-status.yaml          T11 — status flip
_bmad-output/implementation-artifacts/deferred-work.md            T11 — update planWeek() entry
```

**New files:**
```
apps/web/src/features/plan/AllergyUncertaintyBanner.tsx            T8 — new component
```

No DB migrations. `guardrail_decisions.conflicts` is already `JSONB unknown[]` — stores `flagged_items` for compound-uncertain rows without schema change.

---

## References

- [3-23 story](./3-23-per-slot-policy-scoping-bag-wide-allergy-rule.md) — `slotScopeContext` positional-arg pattern + deferred-work entry to update
- [3-31 story](./3-31-recipe-agent-tavily-structured-fetch.md) — Arch Decision #4: compound allergen-confidence classification explicitly deferred here
- [PRD FR81](../planning-artifacts/prd.md) — "flags allergy-relevant uncertainty… substitutes safely or surfaces to parent for resolution"
- [Architecture §pre-step-1](../planning-artifacts/architecture.md) — two-layer allergy model; advisory allergy.check + authoritative guardrail using same engine
- [Architecture error URIs](../planning-artifacts/architecture.md) — `/errors/allergy-uncertainty` already named; use in API error response `type` field
- [deferred-work.md](./deferred-work.md) — existing `planWeek()` 7-param entry to update in-place
- [2.6-s7 story](./2.6-s7-allergy-rules-drop-guardrail-swap-to-allergen-tags.md) — FALCPA synonym expansion pattern used in T1

---

## Dev Agent Record

### Implementation Plan

Followed the 11-task sequence verbatim. One scope discrepancy surfaced: `planWeek()`'s actual on-disk signature has 11 positional parameters (not the 7 the story narrative described — the deferred-work entry was a simplified summary). The new `uncertainContext` lands as the final positional param regardless of what number the deferred-work entry tracks. Deferred-work was updated from "7" → "8" per the story's instruction; the entry's count was always nominal vs. the actual signature.

T8 (frontend banner) shipped as a standalone prop-driven component. The plan-view integration depends on a contract extension (`GetPlansResponseSchema.generation_failure?`) plus a `plans.routes.ts` lookup against `plan.generation.failed` audit rows; that follow-up is captured under "Deferred from: implementation of 3-24" in deferred-work.md.

### Completion Notes

- **T1 — FALCPA synonyms.** Added `worcestershire` → fish and `za'atar` + `zaatar` → sesame. The test for `worcestershire sauce` was tightened to assert "blocked with fish among conflicts" (rather than first conflict) because the engine's intentionally over-strict token matcher also blocks via the existing `soy sauce` synonym on the `sauce` token. The 3.24-added path (worcestershire → fish) is independently verified by an isolated-token test.
- **T2 — Contracts.** `FlaggedCompoundItemSchema` exported; `GuardrailResultSchema` uncertain variant gains optional `flagged_items`. Backward-compat verified: pre-3.24 uncertain returns (no `flagged_items`) still parse.
- **T3 — Engine compound scan.** `COMPOUND_SUSPECT_TOKENS` (8 tokens) + `isSuspectCompound()` exported. Compound scan only runs AFTER the main conflict loop reaches the cleared return — `blocked` short-circuits as documented. Per-child scoping enforced: items belonging to FALCPA-only children are not flagged. Dedup keyed by `(child_id|ingredient|slot|day)` so a compound ingredient is not double-flagged when multiple parent_declared rules apply.
- **T4 — `PlansService.commit()` split.** Compound-uncertain falls through to the same `rejections.push() → regenerate()` retry path as blocked; infrastructure-uncertain still throws immediately. The `plan.generated` audit `stages` payload now carries `flagged_items` for compound-uncertain rejections (alongside `conflicts: []`) so post-hoc analysis can trace each retry.
- **T5 — `trySurgicalSwap`.** Builds synthetic conflict entries (`allergen: 'unknown_compound'`) for compound-flagged tuples so the existing `buildBlockedItems` path resolves them against `previousCommit.items`. Merges blocked + compound-flagged keys into a single `blockedKeys` set. Computes the `ALLERGEN-UNCERTAIN: …` context line and passes it via a new `uncertainContext` opt on `swapBlockedItems`.
- **T6 — `Orchestrator.planWeek` + `swapBlockedItems`.** Both accept `uncertainContext?: string`. Both prepend it to `contextLines` so it ranks above slot-scope and the blocked-items list (safety > scope). The two regenerate-callback fallback paths in `plan-generation.job.ts` and `plan-regeneration.job.ts` also derive `uncertainContext` from compound-uncertain rejections and pass it to `planWeek()`.
- **T7 — Guardrail service.** Compound-uncertain logs at `warn` (recoverable data-quality signal); infrastructure-uncertain stays at `error`. The `allergy.uncertainty` audit row carries `flagged_items` for compound, empty array otherwise. `writeDecision()` stores `flagged_items` in the `conflicts` JSONB column for compound-uncertain decisions — no schema change required.
- **T8 — Frontend banner.** `AllergyUncertaintyBanner` lives at `apps/web/src/features/plan/AllergyUncertaintyBanner.tsx`. Warm-amber palette (`honey-amber-*` design tokens), `role="status"`, prop-driven (no live data wiring yet — that's a deferred follow-up per Dev Notes).
- **T9 — Tests.** Engine: 14 new (synonym + compound). Contracts: 6 new (`FlaggedCompoundItemSchema`, `uncertain.flagged_items` round-trips). Swap helper: 4 new (compound-only, mixed, infra-uncertain returns null, uncertainContext string assertion). Plans service: 3 new (compound retries via regenerate, infra-uncertain throws, MAX-retries exhaustion).
- **T10 — Verification.** Test results (touched scope):
  - `pnpm --filter @hivekitchen/contracts exec vitest run` → 165/165 pass (was 159).
  - `pnpm --filter @hivekitchen/api exec vitest run src/modules/allergy-guardrail` → 61/61 pass.
  - `pnpm --filter @hivekitchen/api exec vitest run src/jobs` → 41/41 pass.
  - `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/plans.service.test.ts` → 56/56 pass.
  - `pnpm --filter @hivekitchen/contracts typecheck`, `pnpm --filter @hivekitchen/types typecheck`, `pnpm --filter @hivekitchen/web typecheck` → all clean.
  - `pnpm --filter @hivekitchen/api typecheck` surfaces pre-existing errors in files I never touched (`households.routes.test.ts`, `internal/health.routes.test.ts`, `voice/voice.service.test.ts`, `day-overrides.repository.test.ts`, `brief-state.composer.test.ts`, the duplicate `RecipeService` import in `plans.service.test.ts` that pre-dated this slice). No new errors traceable to 3.24 source files.
- **T11 — Sprint status + deferred work.** Sprint-status: `3-24` → review. Deferred-work: existing "7 positional parameters" entry updated to "8" with the 3.23/3.24 annotation; new "Deferred from: implementation of 3-24" section added with five entries (compound swap structural-merge follow-up, household compound override, banner wiring follow-up, generation_failure audit metadata, SKU/compound boundary note).

### File List

Modified:
- `packages/contracts/src/plan.ts`
- `packages/contracts/src/plan.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`
- `apps/api/src/modules/plans/plans.service.ts`
- `apps/api/src/modules/plans/plans.service.test.ts`
- `apps/api/src/jobs/swap-retry.helper.ts`
- `apps/api/src/jobs/swap-retry.helper.test.ts`
- `apps/api/src/jobs/plan-generation.job.ts`
- `apps/api/src/jobs/plan-regeneration.job.ts`
- `apps/api/src/agents/orchestrator.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/3-24-allergy-uncertainty-flagging-safe-substitution.md`

New:
- `apps/web/src/features/plan/AllergyUncertaintyBanner.tsx`

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Initial story stub (thin — epics-level ACs only). |
| 2026-05-24 | Menon (via bmad-create-story) | Full rewrite. Grounded in actual codebase state post 3.23, 3.31, 2.6-s7, 2.6-s8. Compound detection model designed; split uncertain handling; swap-helper extension; orchestrator 8th param; AllergyUncertaintyBanner frontend component; 11 tasks with exact file paths and code scaffolds. |
| 2026-05-24 | bmad-dev-story | Implemented all 11 tasks. Engine compound scan + FALCPA synonyms; contracts FlaggedCompoundItemSchema + uncertain.flagged_items; PlansService.commit split uncertain handling; trySurgicalSwap extension; planWeek/swapBlockedItems uncertainContext param; guardrail service compound-vs-infra log/audit split; standalone AllergyUncertaintyBanner component. 27 new tests added across engine/contracts/swap-helper/plans-service. Status → review. |
| 2026-05-24 | bmad-code-review | Code review complete. 8 patches, 5 deferred, 15 dismissed. See Review Findings below. |

---

### Review Findings

#### Patch — must fix before `done`

- [x] [Review][Patch] `' blend'` token in COMPOUND_SUSPECT_TOKENS causes false positive on `"fresh blended smoothie"` and any ingredient with `"blended"` [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` — `COMPOUND_SUSPECT_TOKENS`]
- [x] [Review][Patch] `onSwapSlot(day, slot)` in `AllergyUncertaintyBanner` drops `child_id` — multi-child households cannot target the correct child for swap [`apps/web/src/features/plan/AllergyUncertaintyBanner.tsx:1479`]
- [x] [Review][Patch] AC6 violation: infrastructure-uncertain audit event includes `flagged_items: []` instead of omitting the field; spec requires no `flagged_items` key for infra-uncertain [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` — `allergy.uncertainty` metadata]
- [x] [Review][Patch] Duplicate `(child_id, day, slot)` tuples in `uncertainContext` string when a single slot has multiple compound ingredients (one entry per ingredient, not per slot) [`apps/api/src/jobs/plan-generation.job.ts:385`, `apps/api/src/jobs/plan-regeneration.job.ts:250`, `apps/api/src/jobs/swap-retry.helper.ts:504`]
- [x] [Review][Patch] Slot-scoped regen retry with compound uncertainty emits conflicting LLM instructions: slotScopeContext says "keep Snack/Extra identical" but uncertainContext may identify compound items in those preserved slots [`apps/api/src/jobs/plan-regeneration.job.ts:261`]
- [x] [Review][Patch] T9 coverage gap: swap helper test for infra-uncertain early-return uses `falcpa_baseline_missing`; spec names `no_rules_loaded` for the 3.24 section [`apps/api/src/jobs/swap-retry.helper.test.ts:338`]
- [x] [Review][Patch] Truncated `child_id` (8 chars) in `uncertainContext` prompt string is not UUID-unique; two children in same household can share an 8-char prefix [`apps/api/src/jobs/plan-generation.job.ts:386`, `apps/api/src/jobs/plan-regeneration.job.ts:251`, `apps/api/src/jobs/swap-retry.helper.ts:505`]
- [x] [Review][Patch] No guard in `PlansService.commit()` for `compound_ingredient_unverified` result with empty `flagged_items: []`; routes to retry loop consuming a full planWeek call for zero actionable information [`apps/api/src/modules/plans/plans.service.ts:278`]

#### Defer — pre-existing or out-of-scope

- [x] [Review][Defer] FALCPA synonym rename (2.6-s7) leaves onboarding chip keys (`'eggs'`, `'tree-nuts'`) without synonym expansion — children declared as `eggs`-allergic via onboarding do not get `mayo`/`albumin`/`aioli` protection [⚠ SAFETY] [`apps/api/src/agents/tools/onboarding.tools.ts` chip keys] — deferred, pre-existing from 2.6-s7
- [x] [Review][Defer] `AllergyUncertaintyBanner` list key includes array index `idx`, causing re-mount on reorder and duplicate entries for repeated flagged items [`apps/web/src/features/plan/AllergyUncertaintyBanner.tsx:1465`] — deferred, pre-existing
- [x] [Review][Defer] Phantom compound-flagged tuples (not in `previousCommit.items`) cause a wasted mini-tier swap LLM call before the coverage-check fallback fires [`apps/api/src/jobs/swap-retry.helper.ts:97`] — deferred, pre-existing
- [x] [Review][Defer] Deferred-work entry updated to "8 positional parameters" but actual `planWeek` signature has 12; nominal count is misleading for options-object refactor planning [`_bmad-output/implementation-artifacts/deferred-work.md`] — deferred, pre-existing
- [x] [Review][Defer] AC7 banner not wired to live plan data (no `generation_failure` on `GetPlansResponse`); component shell only — explicitly deferred in dev notes and captured in deferred-work.md — deferred, pre-existing
