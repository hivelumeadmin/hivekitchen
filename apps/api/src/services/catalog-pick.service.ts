import type { CandidateSlateRow } from '../modules/recipe/recipes.repository.js';

// Epic 13-s8 / routing-spec §7 — the deterministic catalog selector ("CatalogRepo.pick").
//
// This is the cost keystone of conversational plan editing: a swap/constraint
// edit resolves here (T0, zero LLM) against the household's ALREADY-CACHED
// recipe slate. Only a catalog MISS (null return) escalates to the expensive
// agentic path. Pure function, no I/O — the caller loads the slate
// (RecipesRepository.findCandidateSlateForHousehold) and computes the safety
// union; this mirrors assignSnackRotation's pure, deterministic, no-DB design
// so it is testable with no mock.
//
// SCOPE (v1): recipe slots only (main / extra). SNACK slots are served by the
// existing deterministic selector `assignSnackRotation` (snack-rotation.service)
// — do not reinvent it here; the caller routes snack picks there.

export type RecipeSlotKind = 'main' | 'extra';

export interface CatalogCandidate {
  id: string;
  // 'recipe' today; snack picks come from assignSnackRotation as 'snack_sku'.
  // Carried so the delta writer knows which column to set (recipe_id vs
  // snack_sku_id) — routing-spec §9 decision #3.
  kind: 'recipe';
  title: string;
}

export interface PickCatalogOptions {
  slot: RecipeSlotKind;
  // The household's cached recipe slate (household_recipe_usage ⋈ recipes).
  slate: readonly CandidateSlateRow[];
  // SAFETY (fail-closed). The union of declared allergens the picked recipe
  // MUST avoid. Because a Main/Extra is shared across the family
  // (family-first doctrine), the caller passes the union across ALL children +
  // the household-wide set — never just the requesting child. Canonical FALCPA
  // keys are shared between recipes.allergen_flags and declared allergens, so a
  // direct set-membership test (no synonym expansion) is exact. The commit-time
  // guardrail remains the authoritative second line of defence.
  declaredAllergens: readonly string[];
  // Dedup: recipe ids already placed in the current week (no repeats).
  excludeRecipeIds?: readonly string[];
  // Optional normalized constraint. v1 honors "exclude:<ingredient_key>"
  // (drops recipes containing that ingredient). Other constraints (e.g.
  // "time:down") are not selectable from the slate — it carries no time fields
  // — so they are a documented no-op here until the slate is extended.
  constraint?: string | null;
}

function satisfiesConstraint(row: CandidateSlateRow, constraint: string | null | undefined): boolean {
  if (!constraint) return true;
  const sep = constraint.indexOf(':');
  if (sep === -1) return true;
  const kind = constraint.slice(0, sep);
  const value = constraint.slice(sep + 1);
  if (kind === 'exclude' && value.length > 0) {
    return !row.ingredient_keys.includes(value);
  }
  // v1: unrecognized / non-slate-selectable constraints do not filter.
  return true;
}

// Deterministic ranking, highest-priority first. Soft preferences only — every
// hard constraint (safety, slot, dedup, exclude) is already applied. Stable
// tiebreak on id so the same inputs always yield the same pick (no random()).
function compareCandidates(a: CandidateSlateRow, b: CandidateSlateRow): number {
  // 1. Household favorites first.
  if (a.is_household_favorite !== b.is_household_favorite) {
    return a.is_household_favorite ? -1 : 1;
  }
  // 2. Higher confidence first.
  if (a.confidence_score !== b.confidence_score) {
    return b.confidence_score - a.confidence_score;
  }
  // 3. Variety: least-used first (use_count ascending). v1 proxy for recency;
  //    true last_used_at recency is deferred (routing-spec §9 decision #2).
  if (a.use_count !== b.use_count) {
    return a.use_count - b.use_count;
  }
  // 4. Stable tiebreak.
  return a.id.localeCompare(b.id);
}

/**
 * Pick one safe, fresh recipe for a main/extra slot from the cached slate.
 * Returns null on a catalog MISS (no safe candidate after filtering) — the
 * caller treats null as "escalate to the agentic add-dish path" (behind a
 * confirm gate), never as a silent no-op.
 */
export function pickCatalogCandidate(opts: PickCatalogOptions): CatalogCandidate | null {
  const { slot, slate, declaredAllergens, excludeRecipeIds, constraint } = opts;

  const declaredSet = new Set(declaredAllergens);
  const excludeSet = new Set(excludeRecipeIds ?? []);

  const eligible = slate.filter(
    (r) =>
      // 1. slot applicability
      r.applicable_slots.includes(slot) &&
      // 2. fail-closed allergen pre-filter (tag-set membership)
      !r.allergen_flags.some((tag) => declaredSet.has(tag)) &&
      // 3. constraint
      satisfiesConstraint(r, constraint) &&
      // 4. dedup vs the current week
      !excludeSet.has(r.id),
  );

  if (eligible.length === 0) return null; // catalog miss → caller escalates

  // 5. deterministic rank; copy before sort (slate is readonly).
  const best = [...eligible].sort(compareCandidates)[0]!;
  return { id: best.id, kind: 'recipe', title: best.canonical_name };
}
