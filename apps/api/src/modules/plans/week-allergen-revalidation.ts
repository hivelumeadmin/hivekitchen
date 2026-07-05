import type {
  PlanDayRow,
  PlanEditFixedSlot,
  PlanMainAssignmentRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  Weekday,
} from '@hivekitchen/types';
import type { CatalogCandidate, RecipeSlotKind } from '../../services/catalog-pick.service.js';
import { pickReplacementSnackSku } from '../../services/snack-rotation.service.js';
import type { PlanEditPlansService, PlanEditSnackContext } from './plan-edit.service.js';

// Epic 13-s10 (AC7) — after a safety_write inserts a NEW declared allergen,
// the current week's placed slots are re-screened against it and any conflict
// is deterministically re-picked. No LLM anywhere in this path.
//
// The re-screen is a pure tag-set membership test — the same cheap predicate
// pickCatalogCandidate / filterAllergenConflicts already use (recipe
// allergen_flags, snack SKU allergen_tags), never a re-implementation of the
// evaluate() authority. The re-pick goes through the EXISTING deterministic
// pickers (CatalogRepo.pickRecipe / pickReplacementSnackSku); the write goes
// through the EXISTING swap services, which run the evaluate() guardrail at the
// write boundary as the authoritative gate. A slot we cannot re-pick from cache
// escalates (catalog_miss) instead of silently remaining unsafe.

// A placed slot that now carries the newly declared allergen.
export type WeekAllergenConflict =
  | { kind: 'main'; mainAssignmentId: string; planSlotId: string }
  | { kind: 'extra'; planSlotId: string }
  | { kind: 'snack'; planSlotId: string; day: Weekday; currentSnackSkuId: string | null };

interface RevalidationTree {
  days: readonly PlanDayRow[];
  slots: readonly PlanSlotRow[];
  variations: readonly PlanSlotVariationRow[];
  mainAssignments: readonly PlanMainAssignmentRow[];
}

export interface ScreenWeekInput extends RevalidationTree {
  /** The just-declared allergen (canonical key, matches allergen_flags/tags). */
  newAllergen: string;
  /** The child the allergen was declared for; null = household-wide. */
  scopeChildId: string | null;
  /** recipe_id → allergen_flags for every placed main/extra (+ legacy snack) recipe. */
  recipeFlagsById: ReadonlyMap<string, readonly string[]>;
  /** snack_sku_id → allergen_tags for every placed snack SKU. */
  snackTagsById: ReadonlyMap<string, readonly string[]>;
}

// Pure. Which placed, non-paused slots now carry the new allergen for a child
// the declaration applies to. Mains are deduped by assignment (one re-pick
// clears every day sharing that Main).
export function screenWeekForAllergen(input: ScreenWeekInput): WeekAllergenConflict[] {
  const { newAllergen } = input;
  const pausedDayIds = new Set(
    input.days.filter((d) => d.paused_at !== null).map((d) => d.id),
  );
  const dayById = new Map(input.days.map((d) => [d.id, d]));
  const mainRecipeById = new Map(
    input.mainAssignments.map((m) => [m.id, m.recipe_id]),
  );

  // Which (non-paused) children each slot actually serves.
  const childrenBySlot = new Map<string, Set<string>>();
  for (const v of input.variations) {
    if (v.paused_at !== null) continue;
    let served = childrenBySlot.get(v.plan_slot_id);
    if (!served) {
      served = new Set();
      childrenBySlot.set(v.plan_slot_id, served);
    }
    served.add(v.child_id);
  }

  const appliesToSlot = (slotId: string): boolean => {
    const served = childrenBySlot.get(slotId);
    if (!served || served.size === 0) return false;
    if (input.scopeChildId === null) return true; // household-wide
    return served.has(input.scopeChildId);
  };

  const conflicts: WeekAllergenConflict[] = [];
  const seenMainAssignments = new Set<string>();

  for (const slot of input.slots) {
    if (pausedDayIds.has(slot.plan_day_id)) continue;
    if (slot.paused_at !== null) continue;
    if (!appliesToSlot(slot.id)) continue;

    if (slot.slot_kind === 'main') {
      if (slot.main_assignment_id === null) continue;
      const recipeId = mainRecipeById.get(slot.main_assignment_id);
      if (recipeId === undefined || recipeId === null) continue;
      const flags = input.recipeFlagsById.get(recipeId);
      if (!flags || !flags.includes(newAllergen)) continue;
      if (seenMainAssignments.has(slot.main_assignment_id)) continue;
      seenMainAssignments.add(slot.main_assignment_id);
      conflicts.push({
        kind: 'main',
        mainAssignmentId: slot.main_assignment_id,
        planSlotId: slot.id,
      });
    } else if (slot.slot_kind === 'extra') {
      if (slot.recipe_id === null) continue;
      const flags = input.recipeFlagsById.get(slot.recipe_id);
      if (!flags || !flags.includes(newAllergen)) continue;
      conflicts.push({ kind: 'extra', planSlotId: slot.id });
    } else {
      // snack: SKU-backed (tag-set) or legacy recipe-backed (recipe flags).
      if (slot.snack_sku_id !== null) {
        const tags = input.snackTagsById.get(slot.snack_sku_id);
        if (!tags || !tags.includes(newAllergen)) continue;
      } else if (slot.recipe_id !== null) {
        const flags = input.recipeFlagsById.get(slot.recipe_id);
        if (!flags || !flags.includes(newAllergen)) continue;
      } else {
        continue;
      }
      const day = dayById.get(slot.plan_day_id);
      if (!day) continue;
      conflicts.push({
        kind: 'snack',
        planSlotId: slot.id,
        day: day.day,
        currentSnackSkuId: slot.snack_sku_id,
      });
    }
  }

  return conflicts;
}

export interface WeekAllergenRevalidatorDeps {
  catalog: {
    pickRecipe(args: {
      householdId: string;
      slot: RecipeSlotKind;
      excludeRecipeIds?: readonly string[];
      constraint?: string | null;
    }): Promise<CatalogCandidate | null>;
  };
  snackContext: { load(householdId: string): Promise<PlanEditSnackContext> };
  plansService: Pick<
    PlanEditPlansService,
    'swapMain' | 'swapSlotRecipe' | 'swapSlotSnackSku'
  >;
  recipeAllergenFlags: {
    findAllergenFlagsByIds(ids: readonly string[]): Promise<Map<string, string[]>>;
  };
  snackAllergenTags: {
    findAllergenTagsByIds(ids: string[]): Promise<Map<string, string[]>>;
  };
}

export interface RevalidateContext {
  planId: string;
  householdId: string;
  requestId: string;
  weekOf: string;
  newAllergen: string;
  scopeChildId: string | null;
  tree: RevalidationTree;
}

export type RevalidationResult =
  | { status: 'ok'; fixedSlots: PlanEditFixedSlot[] }
  | { status: 'escalate' };

// A planned fix: the conflict + the deterministic replacement chosen for it.
type PlannedFix =
  | { kind: 'main'; mainAssignmentId: string; recipeId: string }
  | { kind: 'extra'; planSlotId: string; recipeId: string }
  | { kind: 'snack'; planSlotId: string; snackSkuId: string };

export class WeekAllergenRevalidator {
  constructor(private readonly deps: WeekAllergenRevalidatorDeps) {}

  async revalidate(ctx: RevalidateContext): Promise<RevalidationResult> {
    const { tree } = ctx;

    // Collect the recipe ids (mains + extras + legacy recipe-snacks) and the
    // snack SKU ids that are actually placed, then batch-read their tags.
    const recipeIds = new Set<string>();
    for (const m of tree.mainAssignments) {
      if (m.recipe_id) recipeIds.add(m.recipe_id);
    }
    const snackSkuIds = new Set<string>();
    for (const slot of tree.slots) {
      if (slot.slot_kind === 'extra' && slot.recipe_id !== null) {
        recipeIds.add(slot.recipe_id);
      } else if (slot.slot_kind === 'snack') {
        if (slot.snack_sku_id !== null) snackSkuIds.add(slot.snack_sku_id);
        else if (slot.recipe_id !== null) recipeIds.add(slot.recipe_id);
      }
    }

    const [recipeFlagsById, snackTagsById] = await Promise.all([
      this.deps.recipeAllergenFlags.findAllergenFlagsByIds([...recipeIds]),
      this.deps.snackAllergenTags.findAllergenTagsByIds([...snackSkuIds]),
    ]);

    const conflicts = screenWeekForAllergen({
      newAllergen: ctx.newAllergen,
      scopeChildId: ctx.scopeChildId,
      days: tree.days,
      slots: tree.slots,
      variations: tree.variations,
      mainAssignments: tree.mainAssignments,
      recipeFlagsById,
      snackTagsById,
    });

    if (conflicts.length === 0) return { status: 'ok', fixedSlots: [] };

    // ---- Plan (no writes). Every conflict must be re-pickable from cache, or
    // we escalate the whole re-screen without touching the plan.
    const placedRecipeIds = new Set<string>([...recipeIds]);
    const chosenRecipeIds = new Set<string>();
    const fixes: PlannedFix[] = [];
    let snackCtx: PlanEditSnackContext | null = null;

    for (const conflict of conflicts) {
      if (conflict.kind === 'main' || conflict.kind === 'extra') {
        const slot: RecipeSlotKind = conflict.kind === 'main' ? 'main' : 'extra';
        const candidate = await this.deps.catalog.pickRecipe({
          householdId: ctx.householdId,
          slot,
          excludeRecipeIds: [...placedRecipeIds, ...chosenRecipeIds],
        });
        if (!candidate) return { status: 'escalate' };
        chosenRecipeIds.add(candidate.id);
        if (conflict.kind === 'main') {
          fixes.push({
            kind: 'main',
            mainAssignmentId: conflict.mainAssignmentId,
            recipeId: candidate.id,
          });
        } else {
          fixes.push({ kind: 'extra', planSlotId: conflict.planSlotId, recipeId: candidate.id });
        }
      } else {
        if (snackCtx === null) snackCtx = await this.deps.snackContext.load(ctx.householdId);
        const skuId = pickReplacementSnackSku({
          bagCompositions: snackCtx.bagCompositions,
          extraRules: snackCtx.extraRules,
          activeSkus: snackCtx.activeSkus,
          declaredAllergensByChildId: snackCtx.declaredAllergensByChildId,
          weekOf: ctx.weekOf,
          day: conflict.day,
          currentSkuId: conflict.currentSnackSkuId,
        });
        if (skuId === null) return { status: 'escalate' };
        fixes.push({ kind: 'snack', planSlotId: conflict.planSlotId, snackSkuId: skuId });
      }
    }

    // ---- Apply. The swap services run the evaluate() guardrail as authority.
    const fixedSlots: PlanEditFixedSlot[] = [];
    for (const fix of fixes) {
      if (fix.kind === 'main') {
        const mainAssignment = await this.deps.plansService.swapMain({
          planId: ctx.planId,
          mainAssignmentId: fix.mainAssignmentId,
          householdId: ctx.householdId,
          requestId: ctx.requestId,
          input: { new_recipe_id: fix.recipeId },
        });
        fixedSlots.push({ main_assignment: mainAssignment });
      } else if (fix.kind === 'extra') {
        const slot = await this.deps.plansService.swapSlotRecipe({
          planId: ctx.planId,
          planSlotId: fix.planSlotId,
          householdId: ctx.householdId,
          requestId: ctx.requestId,
          input: { new_recipe_id: fix.recipeId },
        });
        fixedSlots.push({ slot });
      } else {
        const slot = await this.deps.plansService.swapSlotSnackSku({
          planId: ctx.planId,
          planSlotId: fix.planSlotId,
          householdId: ctx.householdId,
          requestId: ctx.requestId,
          input: { new_snack_sku_id: fix.snackSkuId },
        });
        fixedSlots.push({ slot });
      }
    }

    return { status: 'ok', fixedSlots };
  }
}
