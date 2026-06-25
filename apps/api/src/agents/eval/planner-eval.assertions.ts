import { PlanComposeTreeOutputSchema } from '@hivekitchen/contracts';
import type { KitchenMap, PlanComposeTreeOutput, PlanItemForGuardrail } from '@hivekitchen/types';
import { evaluate, type AllergyRule } from '../../modules/allergy-guardrail/allergy-rules.engine.js';
import type { EvalFixture, RunResult } from './planner-eval.harness.js';

// ===========================================================================
// Story 3.5-s1 — the five golden-set assertions.
// ===========================================================================
// Each throws a descriptive Error on violation (fixture id + offending
// child/day/slot) so a regression in any Epic 3.5 slice points straight at the
// cause. assertAllergenSafe reuses the REAL allergy engine (evaluate) so the
// matcher + FALCPA synonym expansion stay identical to the commit-time
// guardrail (story 3-39); the other four are pure structural checks.
// ===========================================================================

const WEEKDAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

type Slot = PlanComposeTreeOutput['days'][number]['slots'][number];

function fail(label: string, msg: string): never {
  throw new Error(`[${label}] ${msg}`);
}

// recipe name for a slot: main → via main_assignment_sequence; extra → recipe_id.
function slotRecipeName(
  slot: Slot,
  seqToRecipe: Map<number, string>,
): string | undefined {
  if (slot.slot_kind === 'main') {
    return slot.main_assignment_sequence === undefined
      ? undefined
      : seqToRecipe.get(slot.main_assignment_sequence);
  }
  return slot.recipe_id;
}

// effective set = base ingredients − removals + add_ons (mirrors story 3-39's
// commit-time effective-set walk). Removal match is exact case-insensitive equality
// (trimmed) — matching plans.service.ts buildCommitGuardrailInputs semantics.
function effectiveIngredients(
  base: readonly string[],
  removals: readonly string[] | undefined,
  addOns: readonly string[] | undefined,
): string[] {
  const rem = new Set((removals ?? []).map((r) => r.toLowerCase().trim()));
  const kept = base.filter((b) => !rem.has(b.toLowerCase().trim()));
  return [...kept, ...(addOns ?? [])];
}

// AC A — allergen-safe. For every child with declared allergens, build the
// effective ingredient set for each of that child's (day, slot) variations and
// run the real engine. A 'blocked' verdict is a safety regression.
export function assertAllergenSafe(
  output: PlanComposeTreeOutput,
  recipeIngredients: Record<string, readonly string[]>,
  declaredAllergensByChild: Record<string, readonly string[]>,
  label: string,
): void {
  const seqToRecipe = new Map<number, string>(
    output.main_assignments.map((a) => [a.sequence, a.recipe_id]),
  );

  const itemsByChild = new Map<string, PlanItemForGuardrail[]>();
  for (const day of output.days) {
    for (const slot of day.slots) {
      if (slot.slot_kind === 'snack') continue; // server-assigned, out of scope
      const recipeName = slotRecipeName(slot, seqToRecipe);
      if (recipeName === undefined) {
        fail(
          label,
          `${day.day}/${slot.slot_kind} slot has no resolvable recipe name — main slot missing main_assignment_sequence match, or extra slot missing recipe_id`,
        );
      }
      const base = recipeIngredients[recipeName];
      if (!base) {
        fail(
          label,
          `no ingredients fixture for recipe "${recipeName}" on ${day.day}/${slot.slot_kind} — add "${recipeName}" to fixture.recipeIngredients`,
        );
      }
      for (const v of slot.variations) {
        const ingredients = effectiveIngredients(base, v.removals, v.add_ons);
        const list = itemsByChild.get(v.child_id) ?? [];
        list.push({ child_id: v.child_id, day: day.day, slot: slot.slot_kind, ingredients });
        itemsByChild.set(v.child_id, list);
      }
    }
  }

  for (const [childId, allergens] of Object.entries(declaredAllergensByChild)) {
    if (allergens.length === 0) continue; // nothing to enforce for this child
    const items = itemsByChild.get(childId);
    if (!items || items.length === 0) continue; // child not placed this plan
    // Mark the child's allergens as falcpa rules so the engine's fail-closed
    // baseline check passes; matching is identical regardless of rule_type.
    const rules: AllergyRule[] = allergens.map((a, i) => ({
      id: `eval-${childId}-${String(i)}`,
      household_id: null,
      child_id: childId,
      allergen: a,
      rule_type: 'falcpa',
    }));
    const result = evaluate(items, rules);
    // Production treats both 'blocked' and 'uncertain' as blocking (fail-closed semantics).
    if (result.verdict === 'blocked' || result.verdict === 'uncertain') {
      const c = result.conflicts[0];
      const detail = c
        ? `${c.allergen} via "${c.ingredient}"`
        : result.verdict === 'uncertain'
          ? `uncertain (${result.reason ?? 'unknown'})`
          : result.verdict;
      fail(label, `allergen-unsafe for child ${childId}: ${detail} (declared: ${allergens.join(', ')})`);
    }
  }
}

// AC B — slot coverage. Every active slot kind for a child appears at least
// once with that child's variation; no INACTIVE slot kind carries that child;
// every composed day has a main slot.
export function assertSlotCoverage(
  output: PlanComposeTreeOutput,
  activeSlotsByChild: Record<string, ReadonlyArray<'main' | 'extra'>>,
  label: string,
): void {
  for (const day of output.days) {
    if (!day.slots.some((s) => s.slot_kind === 'main')) {
      fail(label, `day ${day.day} has no main slot`);
    }
  }

  const childSlotKinds = new Map<string, Set<string>>();
  for (const day of output.days) {
    for (const slot of day.slots) {
      for (const v of slot.variations) {
        const set = childSlotKinds.get(v.child_id) ?? new Set<string>();
        set.add(slot.slot_kind);
        childSlotKinds.set(v.child_id, set);
      }
    }
  }

  for (const [childId, active] of Object.entries(activeSlotsByChild)) {
    const present = childSlotKinds.get(childId) ?? new Set<string>();
    for (const kind of active) {
      if (!present.has(kind)) {
        fail(label, `child ${childId} missing active slot "${kind}"`);
      }
    }
    if (!active.includes('extra') && present.has('extra')) {
      fail(label, `child ${childId} has an extra slot but extra is INACTIVE`);
    }
  }
}

// AC C — no two adjacent composed days share the same Main.
export function assertNoConsecutiveMain(output: PlanComposeTreeOutput, label: string): void {
  const ordered = [...output.days].sort(
    (a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day),
  );
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const prevIdx = WEEKDAY_ORDER.indexOf(prev.day);
    const curIdx = WEEKDAY_ORDER.indexOf(cur.day);
    if (curIdx - prevIdx !== 1) continue; // non-adjacent calendar days — rule N/A
    const prevMain = prev.slots.find((s) => s.slot_kind === 'main')?.main_assignment_sequence;
    const curMain = cur.slots.find((s) => s.slot_kind === 'main')?.main_assignment_sequence;
    if (prevMain !== undefined && prevMain === curMain) {
      fail(label, `consecutive Main on ${prev.day}→${cur.day} (sequence ${String(curMain)})`);
    }
  }
}

// AC D — output parses the canonical tree schema.
export function assertSchemaValid(output: unknown, label: string): void {
  const parsed = PlanComposeTreeOutputSchema.safeParse(output);
  if (!parsed.success) {
    fail(label, `schema-invalid output: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
}

// Banned recipes must never appear (favourites.banned in the KitchenMap).
export function assertNoBannedRecipes(
  output: PlanComposeTreeOutput,
  banned: readonly string[] | undefined,
  label: string,
): void {
  if (!banned || banned.length === 0) return;
  const placed = new Set<string>(output.main_assignments.map((a) => a.recipe_id));
  for (const day of output.days) {
    for (const slot of day.slots) {
      if (slot.recipe_id) placed.add(slot.recipe_id);
    }
  }
  for (const b of banned) {
    if (placed.has(b)) fail(label, `banned recipe placed: "${b}"`);
  }
}

// AC E — cost/turn budget. Tool-call count + tokens within the recorded ceiling
// (the baseline that Epic 3.5 slices s2/s3/s5 will DROP, never raise).
export function assertBudget(result: RunResult, budget: EvalFixture['budget'], label: string): void {
  if (result.turns > budget.maxTurns) {
    fail(label, `turns ${String(result.turns)} > budget ${String(budget.maxTurns)}`);
  }
  // AC7: total tool-call count (= turns when each turn has one tool call; catches
  // multi-tool-call-per-turn regressions that turns alone would undercount).
  if (result.toolCalls.length > budget.maxTurns) {
    fail(label, `total tool calls ${String(result.toolCalls.length)} > budget ${String(budget.maxTurns)} (maxTurns)`);
  }
  if (result.planComposeCalls > budget.maxPlanComposeCalls) {
    fail(label, `plan.compose calls ${String(result.planComposeCalls)} > budget ${String(budget.maxPlanComposeCalls)}`);
  }
  if (result.promptTokens > budget.maxPromptTokens) {
    fail(label, `prompt tokens ${String(result.promptTokens)} > budget ${String(budget.maxPromptTokens)}`);
  }
  if (result.completionTokens > budget.maxCompletionTokens) {
    fail(label, `completion tokens ${String(result.completionTokens)} > budget ${String(budget.maxCompletionTokens)}`);
  }
}

// Derive effective allergen sets per child from the KitchenMap (AC3): household-wide
// declared_allergens ∪ each child's own declared_allergens. Matches the
// declaredAllergensByChildId build in plan-generation.job.ts:457-466. When kitchenMap
// is absent, falls back to the fixture-supplied explicit map.
function buildDeclaredAllergensByChild(
  kitchenMap: KitchenMap,
): Record<string, readonly string[]> {
  const householdAllergens = kitchenMap.household.declared_allergens ?? [];
  const result: Record<string, string[]> = {};
  for (const child of kitchenMap.children) {
    result[child.id] = [...new Set([...householdAllergens, ...(child.declared_allergens ?? [])])];
  }
  return result;
}

// Run all five assertions for a fixture against its run result.
export function assertFixture(fixture: EvalFixture, result: RunResult): void {
  assertSchemaValid(result.output, fixture.id);
  assertSlotCoverage(result.output, fixture.expected.activeSlotsByChild, fixture.id);
  assertNoConsecutiveMain(result.output, fixture.id);
  assertNoBannedRecipes(result.output, fixture.expected.bannedRecipes, fixture.id);
  // Derive allergens from kitchenMap so household-level allergens are automatically
  // included — fixture authors no longer need to pre-merge them manually.
  const allergensByChild = fixture.options.kitchenMap
    ? buildDeclaredAllergensByChild(fixture.options.kitchenMap)
    : fixture.expected.declaredAllergensByChild;
  assertAllergenSafe(result.output, fixture.recipeIngredients, allergensByChild, fixture.id);
  assertBudget(result, fixture.budget, fixture.id);
}