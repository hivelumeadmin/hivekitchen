# Story 3.24: Allergy-Uncertainty Flagging + Safe Substitution

Status: ready-for-dev

## Story

As a Primary Parent,
I want plan items with unverifiable ingredient provenance flagged for safety, with safe substitution where possible or surface to me for resolution,
So that uncertainty doesn't ship as silent risk (FR81).

## Acceptance Criteria

1. **Given** Story 3.1 is complete,
   **When** the guardrail evaluates a plan and an ingredient lacks verified allergen-status,
   **Then** the engine returns `verdict: 'uncertain'` with the specific ingredient flagged; orchestrator first attempts safe substitution; on failure, plan surfaces uncertainty to me via `<AccountableError>` with explicit substitute-or-pick affordance.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.1: `AllergyGuardrailService.clearOrReject()` returns `{ verdict: 'cleared' | 'blocked', conflicts: Conflict[] }`. This story adds a third verdict: `'uncertain'`.
- Story 3.1: `allergy_rules` table (top-9 FALCPA allergens + parent-declared); `guardrail_decisions` table
- Story 3.5: `PlansService.commit()` calls `allergyGuardrail.clearOrReject()` and handles `'blocked'` (retries). Extend to handle `'uncertain'`.
- Story 3.2: `DomainOrchestrator.planWeek()` accepts `rejectionContext` for retry with blocked ingredients. Extend to accept `uncertainContext`.
- Story 3.20: `snack_skus` table with structured allergen flags — these are verified, not uncertain; only recipe-derived ingredients from LLM output can be uncertain
- Story 3.11: `<AccountableError>` — check if this component exists in the codebase. If not, create it. It is the loud surface for safety-relevant issues.
- `AUDIT_EVENT_TYPES`

**Key invariants:**
- Guardrail is deterministic and runs OUTSIDE the agent boundary — no LLM call inside it
- `verdict: 'uncertain'` is distinct from `'blocked'` (known conflict) and `'cleared'` (no conflict)
- Safe substitution is attempted automatically before surfacing to parent
- `AccountableError` is never destructive-red; uses safety language per UX-DR24
- All DB access through API layer only
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — Update `allergy-rules.engine.ts` to return `'uncertain'` verdict

In `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`:

**Update the return type:**

```typescript
// Current:
export type GuardrailVerdict = 'cleared' | 'blocked';

// Updated:
export type GuardrailVerdict = 'cleared' | 'blocked' | 'uncertain';

export interface UncertainIngredient {
  ingredient: string;
  reason: 'no_allergen_data' | 'ambiguous_name' | 'cross_contamination_unknown';
  child_id: string;
}

export interface GuardrailResult {
  verdict: GuardrailVerdict;
  conflicts: Conflict[];          // populated when verdict='blocked'
  uncertain_ingredients: UncertainIngredient[]; // populated when verdict='uncertain'
}
```

**Update `clearOrReject()` logic:**

An ingredient is uncertain when:
1. It appears in the plan's ingredients list
2. Its allergen status cannot be determined from the `allergy_rules` table or `snack_skus` allergen flags
3. A household has declared allergens that *could* be present (e.g., "curry powder" when peanut allergy declared — cross-contamination risk)

```typescript
// In the engine evaluation loop, after checking known allergens:
// If an ingredient is neither confirmed safe nor confirmed blocked,
// and the household has declared allergens, flag as uncertain.
function isIngredientUncertain(ingredient: string, declaredAllergens: string[]): boolean {
  // Ambiguous ingredient names that could conceal allergens:
  const AMBIGUOUS_PATTERNS = [
    /\bspices?\b/i,           // "spices" — could contain anything
    /\bseasonings?\b/i,       // "seasoning blend"
    /\bflavou?r(ing)?\b/i,    // "natural flavoring"
    /\bsauce\b/i,             // "sauce" — often has many ingredients
    /\bbroth\b/i,             // "chicken broth" — may contain wheat
    /\bgravy\b/i,             // "gravy" — often has wheat
    /\bmarinade\b/i,
  ];

  // Only flag uncertainty when there are declared allergens to check against.
  if (declaredAllergens.length === 0) return false;

  return AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(ingredient));
}
```

When `isIngredientUncertain()` returns true for any ingredient and there is no confirmed block:
- Set `verdict: 'uncertain'`
- Populate `uncertain_ingredients` with the flagged items
- Do NOT block the plan — uncertainty is not the same as a known conflict

**Priority order:** `'blocked'` > `'uncertain'` > `'cleared'`. If any item is blocked, return blocked (don't bother surfacing uncertainty when there's already a hard conflict).

### Task 2 — Update `GuardrailResult` contract type

In `packages/contracts/src/plan.ts` (or wherever `GuardrailResult` is exported), update:

```typescript
export const UncertainIngredientSchema = z.object({
  ingredient: z.string(),
  reason: z.enum(['no_allergen_data', 'ambiguous_name', 'cross_contamination_unknown']),
  child_id: z.string().uuid(),
});

export const GuardrailResultSchema = z.object({
  verdict: z.enum(['cleared', 'blocked', 'uncertain']),
  conflicts: z.array(ConflictSchema),
  uncertain_ingredients: z.array(UncertainIngredientSchema),
});
```

Update `packages/types/src/index.ts` accordingly.

### Task 3 — Update `PlansService.commit()` to handle `'uncertain'` verdict

In `apps/api/src/modules/plans/plans.service.ts`, in the `commit()` method:

After calling `allergyGuardrail.clearOrReject()`:

```typescript
const result = await this.allergyGuardrail.clearOrReject(plan, household);

if (result.verdict === 'blocked') {
  // existing retry logic...
  return await this.retryWithRejectionContext(result.conflicts, ...);
}

if (result.verdict === 'uncertain') {
  // Attempt safe substitution for each uncertain ingredient.
  const substituted = await this.attemptSafeSubstitution(plan, result.uncertain_ingredients, requestId);
  if (substituted.success) {
    // Re-run guardrail on substituted plan.
    const retryResult = await this.allergyGuardrail.clearOrReject(substituted.plan, household);
    if (retryResult.verdict === 'cleared') {
      // Proceed with substituted plan.
      return this.commitPlan(substituted.plan, requestId);
    }
    // Substitution still uncertain/blocked — surface to parent.
  }
  // Surface uncertainty to parent via audit + SSE flag.
  await this.surfaceUncertaintyToParent(plan, result.uncertain_ingredients, requestId);
  // Commit the plan anyway but mark it with uncertainty flag.
  return this.commitPlan(plan, requestId, { hasUncertainIngredients: true });
}

// verdict === 'cleared'
return this.commitPlan(plan, requestId);
```

### Task 4 — Safe substitution logic

Create `apps/api/src/modules/allergy-guardrail/safe-substitution.service.ts`:

```typescript
// Attempts to substitute ambiguous ingredients with safe, known alternatives.
// This is a rule-based substitution — NOT an LLM call (stays outside agent boundary).

const SAFE_SUBSTITUTIONS: Record<string, string[]> = {
  'spices': ['salt', 'pepper', 'turmeric', 'cumin'],       // remove ambiguous blend
  'seasoning': ['salt', 'pepper'],
  'natural flavoring': [],                                  // no safe sub — surface to parent
  'broth': ['water', 'vegetable stock'],                    // wheat-free alternatives
  'gravy': [],                                              // too complex — surface to parent
  'sauce': [],                                              // too vague — surface to parent
};

export class SafeSubstitutionService {
  // Returns { success: true, plan: modifiedPlan } if substitution found,
  // or { success: false } if no substitution available.
  attemptSubstitution(
    plan: PlanComposeOutput,
    uncertainIngredients: UncertainIngredient[],
  ): { success: boolean; plan?: PlanComposeOutput } {
    let modified = { ...plan, days: [...plan.days] };
    let allSubstituted = true;

    for (const uncertain of uncertainIngredients) {
      const lowerIngredient = uncertain.ingredient.toLowerCase();
      const subs = Object.entries(SAFE_SUBSTITUTIONS).find(
        ([key]) => lowerIngredient.includes(key),
      );
      if (!subs || subs[1].length === 0) {
        allSubstituted = false;
        continue;
      }
      // Replace the ambiguous ingredient with safe alternatives in the plan.
      modified = replacIngredientInPlan(modified, uncertain.ingredient, subs[1]);
    }

    return allSubstituted ? { success: true, plan: modified } : { success: false };
  }
}

function replacIngredientInPlan(
  plan: PlanComposeOutput,
  target: string,
  replacements: string[],
): PlanComposeOutput {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      items: day.items.map((item) => ({
        ...item,
        ingredients: item.ingredients.flatMap((ing) =>
          ing.toLowerCase().includes(target.toLowerCase())
            ? replacements
            : [ing],
        ),
      })),
    })),
  };
}
```

### Task 5 — `surfaceUncertaintyToParent()` — audit + brief_state flag

When safe substitution fails, the uncertainty must be surfaced to the parent. For MVP:

1. Write an audit row: `plan.allergy_uncertainty_flagged`
2. Commit the plan with a flag in `brief_state` so the Brief can render `<AccountableError>`

In `brief_state`, add an `uncertainty_flags JSONB` column (or reuse `mutation_summary` with a special prefix — check the current `brief_state` schema from Story 3.6 before deciding).

```typescript
private async surfaceUncertaintyToParent(
  plan: CommitPlanInput,
  uncertainIngredients: UncertainIngredient[],
  requestId: string,
): Promise<void> {
  await this.auditService.write({
    event_type: 'plan.allergy_uncertainty_flagged',
    household_id: plan.household_id,
    request_id: requestId,
    metadata: {
      plan_id: plan.plan_id,
      uncertain_ingredients: uncertainIngredients,
    },
  });
  // TODO: Update brief_state.uncertainty_flags to surface AccountableError in Brief.
  // Deferred to a follow-up once brief_state schema is confirmed.
}
```

### Task 6 — `<AccountableError>` component

If the `<AccountableError>` component doesn't exist in `apps/web/src/features/plan/`:

Create `apps/web/src/features/plan/AccountableError.tsx`:

```typescript
// Loud, honest error surface for safety-relevant issues.
// Never destructive-red — uses safety-cleared-teal palette with a warm-neutral body.
// Per UX-DR24: transparent about what happened and what the parent can do.

interface AccountableErrorProps {
  headline: string;
  body: string;
  // Optional affordance buttons (e.g., "Choose a substitute", "Skip this item").
  actions?: Array<{ label: string; onClick: () => void }>;
}

export function AccountableError({ headline, body, actions }: AccountableErrorProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 flex flex-col gap-2"
    >
      <p className="font-serif text-[16px] text-teal-900 font-medium">{headline}</p>
      <p className="font-sans text-[14px] text-teal-800 leading-relaxed">{body}</p>
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {actions.map(({ label, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="rounded-full border border-teal-400 px-3 py-1 font-sans text-[13px] text-teal-800 hover:bg-teal-100 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

The `safety-cleared-teal` design token from the design system should map to `teal-*` in Tailwind (verify with `Design System.md` spec and `tailwind.config.ts`).

### Task 7 — Surface `AccountableError` in `BriefCanvas`

In `apps/web/src/features/plan/BriefCanvas.tsx`, check if `brief_state` has uncertainty flags and render `<AccountableError>`:

```typescript
{brief.uncertainty_flags && brief.uncertainty_flags.length > 0 && (
  <AccountableError
    headline="We flagged an ingredient we couldn't verify"
    body="One or more ingredients in this week's plan couldn't be confirmed allergen-free. We've marked them below — tap 'Choose substitute' to pick an alternative, or 'Skip this item' to remove it."
    actions={[
      { label: 'Choose a substitute', onClick: () => { /* open substitute picker */ } },
    ]}
  />
)}
```

The full substitute picker UI (parent selects a replacement ingredient) is deferred — flag it in `deferred-work.md`. For MVP, the `<AccountableError>` renders the message and a "Contact us" or "Request review" affordance.

### Task 8 — Audit event types

```typescript
'plan.allergy_uncertainty_flagged',
'plan.safe_substitution_applied',
```

### Task 9 — Tests

**`allergy-rules.engine.test.ts` (extend):**
- Ingredient "spices" in plan for peanut-allergic child → `verdict: 'uncertain'`, `uncertain_ingredients` populated
- Ingredient "apple" in plan for peanut-allergic child → `verdict: 'cleared'` (apple is not ambiguous)
- Known allergen + uncertain ingredient → `verdict: 'blocked'` (blocked takes precedence)
- No declared allergens + ambiguous ingredient → `verdict: 'cleared'` (uncertainty only matters when allergens declared)

**`safe-substitution.service.test.ts`:**
- "spices" → substituted with `['salt', 'pepper', 'turmeric', 'cumin']` → `success: true`
- "sauce" → no substitution available → `success: false`

**`plans.service.test.ts` (extend):**
- `commit()` with `verdict: 'uncertain'` + successful substitution → commits substituted plan
- `commit()` with `verdict: 'uncertain'` + failed substitution → commits original plan + calls `surfaceUncertaintyToParent()`

---

## Dev Notes

### Uncertainty vs. blocked — priority order is critical

`'blocked'` (known allergen conflict) is always returned ahead of `'uncertain'`. If a plan has both a known conflict AND uncertain ingredients, return `'blocked'` — the parent needs to know about the confirmed conflict first. The uncertain ingredients can be revisited in the substituted plan.

### Safe substitution is rule-based, not LLM

Safe substitution must remain entirely deterministic and outside the agent boundary. The `SafeSubstitutionService` uses a static lookup table of ambiguous-to-safe mappings. This avoids introducing LLM latency or non-determinism into the guardrail path.

The substitution table is conservative — when in doubt, return `{ success: false }` and surface to parent. Do not attempt to substitute complex ingredients (sauces, gravies) that have many possible compositions.

### `brief_state.uncertainty_flags` schema

The current `brief_state` schema (from Story 3.6) may not have an `uncertainty_flags` column. Before implementing Task 5 and Task 7, read the `brief_state` migration and `brief-state.composer.ts` to understand what columns exist. If `uncertainty_flags` needs to be added, create a migration. For MVP, the `mutation_summary` field can carry a `"[UNCERTAINTY]"` prefix as a temporary signal.

### `<AccountableError>` design token

The `safety-cleared-teal` token from the UX design spec should be configured in `tailwind.config.ts`. Check if it maps to a custom color. If not, use `teal-*` from Tailwind's default palette as a placeholder and note the token mapping in `deferred-work.md`.

---

## Project Structure

**New files:**
```
apps/api/src/modules/allergy-guardrail/safe-substitution.service.ts
apps/api/src/modules/allergy-guardrail/safe-substitution.service.test.ts
apps/web/src/features/plan/AccountableError.tsx
apps/web/src/features/plan/AccountableError.test.tsx
```

**Modified files:**
```
packages/contracts/src/plan.ts (or allergy.ts)         + UncertainIngredientSchema, GuardrailResultSchema updated with 'uncertain'
packages/types/src/index.ts                             + UncertainIngredient, GuardrailResult updated
apps/api/src/audit/audit.types.ts                       + plan.allergy_uncertainty_flagged, plan.safe_substitution_applied
apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts  + 'uncertain' verdict; UncertainIngredient type; isIngredientUncertain()
apps/api/src/modules/plans/plans.service.ts             + handle 'uncertain' in commit(); attemptSafeSubstitution(); surfaceUncertaintyToParent()
apps/web/src/features/plan/BriefCanvas.tsx              + render AccountableError when uncertainty_flags present
_bmad-output/implementation-artifacts/sprint-status.yaml  3-24 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md   + substitute picker UI; safety-cleared-teal token; brief_state.uncertainty_flags column
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.24 created — ready-for-dev. |
