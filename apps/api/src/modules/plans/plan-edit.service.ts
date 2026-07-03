import type {
  KitchenMap,
  PlanDayRow,
  PlanEditFixedSlot,
  PlanEditInput,
  PlanEditResult,
  PlanIntentResult,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  UpdateVariationInput,
  Weekday,
} from '@hivekitchen/types';
import {
  dispatchPlanIntent,
  type DispatchDeps,
  type DispatchResult,
  type EscalateReason,
  type SlotTarget,
} from '../../agents/dispatch-plan-intent.js';
import { routePlanIntent, type PlanContextLite } from '../../agents/route-plan-intent.js';
import type { LLMProvider } from '../../agents/providers/llm-provider.interface.js';
import type { PlannerBagComposition, PlannerExtraRules } from '../../agents/planner/context/assemble.js';
import type { SnackSkuRow } from '../recipe/snack-sku.repository.js';
import { pickReplacementSnackSku } from '../../services/snack-rotation.service.js';
import { resolvePlanEditTarget, type PlanEditTree } from './plan-edit-target.js';
import type { RevalidateContext, RevalidationResult } from './week-allergen-revalidation.js';

// Epic 13-s9 — the T0 execution layer. dispatchPlanIntent DECIDES (pure, agent
// side); executePlanEdit EXECUTES the decision through the EXISTING services —
// swapMain / swapSlotRecipe / swapSlotSnackSku / updateVariation / declareIfNew
// — which own guardrail re-evaluation, brief_state refresh, and audit. Nothing
// here touches safety or persistence directly. Resolution misses become typed
// 'clarify' outcomes (the client asks, we never guess a row to mutate); T1/T2
// decisions pass through as typed outcomes for the endpoint to render.
//
// 'commit' ("confirm the week") calls PlansService.confirmWeek, which sets
// plans.confirmed_at and writes a plan.week_confirmed audit event (13-s10).

export interface PlanEditPlansService {
  swapMain(opts: {
    planId: string;
    mainAssignmentId: string;
    householdId: string;
    requestId: string;
    input: { new_recipe_id: string };
  }): Promise<PlanMainAssignmentRow>;
  swapSlotRecipe(opts: {
    planId: string;
    planSlotId: string;
    householdId: string;
    requestId: string;
    input: { new_recipe_id: string };
  }): Promise<PlanSlotRow>;
  swapSlotSnackSku(opts: {
    planId: string;
    planSlotId: string;
    householdId: string;
    requestId: string;
    input: { new_snack_sku_id: string };
  }): Promise<PlanSlotRow>;
  updateVariation(opts: {
    planId: string;
    variationId: string;
    householdId: string;
    requestId: string;
    input: UpdateVariationInput;
  }): Promise<PlanSlotVariationRow>;
  // Epic 13-s10 — real "Confirm the week". Idempotent: changed=false on a
  // re-confirm no-op (so the route suppresses the SSE emit).
  confirmWeek(opts: {
    planId: string;
    householdId: string;
    requestId: string;
  }): Promise<{ confirmedAt: string; changed: boolean }>;
}

// The deterministic snack re-pick needs the same inputs the weekly rotation
// uses. The loader closure is assembled at route-wiring time (see
// buildSnackContextLoader in plans.routes.ts) so this service stays free of
// repository imports and trivially stubbable.
export interface PlanEditSnackContext {
  bagCompositions: readonly PlannerBagComposition[];
  extraRules: readonly PlannerExtraRules[];
  activeSkus: readonly SnackSkuRow[];
  declaredAllergensByChildId: ReadonlyMap<string, readonly string[]>;
}

export interface PlanEditExecutorDeps {
  plansService: PlanEditPlansService;
  householdAllergens: {
    declareIfNew(params: {
      household_id: string;
      child_id: string | null;
      allergen: string;
      source: string;
    }): Promise<{ inserted: boolean }>;
  };
  snackContext: {
    load(householdId: string): Promise<PlanEditSnackContext>;
  };
}

export interface PlanEditContext {
  planId: string;
  householdId: string;
  requestId: string;
  weekOf: string;
  tree: PlanEditTree;
}

export type PlanEditOutcome =
  | { status: 'applied'; action: 'swap_main'; mainAssignment: PlanMainAssignmentRow }
  | { status: 'applied'; action: 'swap_slot'; slot: PlanSlotRow }
  | { status: 'applied'; action: 'swap_snack'; slot: PlanSlotRow }
  | { status: 'applied'; action: 'vary'; variation: PlanSlotVariationRow }
  | {
      status: 'applied';
      action: 'safety_write';
      allergen: string;
      inserted: boolean;
      // Epic 13-s10 (AC7) — slots the week re-screen re-picked to clear the new
      // allergen. Absent/empty when nothing needed fixing.
      fixedSlots?: PlanEditFixedSlot[];
    }
  | { status: 'acknowledged'; action: 'noop' }
  | { status: 'acknowledged'; action: 'commit'; confirmedAt: string; changed: boolean }
  | { status: 'read'; target: SlotTarget }
  | { status: 'clarify'; reason: string }
  | { status: 'escalate'; reason: EscalateReason; dishQuery?: string };

const SPICE_ORDER = ['mild', 'regular', 'spicy'] as const;
const PORTION_ORDER = ['small', 'regular', 'large'] as const;

function stepIn<T extends string>(
  order: readonly T[],
  current: T,
  direction: 1 | -1,
): T {
  const idx = order.indexOf(current);
  if (idx === -1) return order[direction === -1 ? 0 : order.length - 1];
  const next = Math.min(order.length - 1, Math.max(0, idx + direction));
  return order[next];
}

// Map a normalized classifier variation ("spice:down", "portion:up",
// "texture:soft") to an UpdateVariationInput patch, stepping relative to the
// child's CURRENT variation row. Unknown strings return null (→ clarify).
export function variationPatchOf(
  variation: string,
  current: Pick<PlanSlotVariationRow, 'spice_level' | 'portion_size'>,
): UpdateVariationInput | null {
  switch (variation) {
    case 'spice:down':
      return { spice_level: stepIn(SPICE_ORDER, current.spice_level, -1) };
    case 'spice:up':
      return { spice_level: stepIn(SPICE_ORDER, current.spice_level, 1) };
    case 'portion:down':
      return { portion_size: stepIn(PORTION_ORDER, current.portion_size, -1) };
    case 'portion:up':
      return { portion_size: stepIn(PORTION_ORDER, current.portion_size, 1) };
    case 'texture:soft':
      return { texture: 'soft' };
    default:
      return null;
  }
}

export async function executePlanEdit(
  dispatch: DispatchResult,
  ctx: PlanEditContext,
  deps: PlanEditExecutorDeps,
): Promise<PlanEditOutcome> {
  switch (dispatch.action) {
    case 'noop':
      return { status: 'acknowledged', action: 'noop' };

    case 'commit': {
      const { confirmedAt, changed } = await deps.plansService.confirmWeek({
        planId: ctx.planId,
        householdId: ctx.householdId,
        requestId: ctx.requestId,
      });
      return { status: 'acknowledged', action: 'commit', confirmedAt, changed };
    }

    case 'read':
      return { status: 'read', target: dispatch.target };

    case 'reply':
      return { status: 'clarify', reason: 'unclear' };

    case 'escalate':
      return {
        status: 'escalate',
        reason: dispatch.reason,
        ...(dispatch.dishQuery !== undefined ? { dishQuery: dispatch.dishQuery } : {}),
      };

    case 'swap': {
      const resolved = resolvePlanEditTarget('swap', dispatch.target, ctx.tree);
      if (resolved.kind === 'miss') return { status: 'clarify', reason: resolved.reason };
      if (resolved.kind === 'main') {
        const mainAssignment = await deps.plansService.swapMain({
          planId: ctx.planId,
          mainAssignmentId: resolved.mainAssignmentId,
          householdId: ctx.householdId,
          requestId: ctx.requestId,
          input: { new_recipe_id: dispatch.candidate.id },
        });
        return { status: 'applied', action: 'swap_main', mainAssignment };
      }
      if (resolved.kind === 'slot') {
        const slot = await deps.plansService.swapSlotRecipe({
          planId: ctx.planId,
          planSlotId: resolved.planSlotId,
          householdId: ctx.householdId,
          requestId: ctx.requestId,
          input: { new_recipe_id: dispatch.candidate.id },
        });
        return { status: 'applied', action: 'swap_slot', slot };
      }
      // 'variation' is unreachable in swap mode.
      return { status: 'clarify', reason: 'slot_not_found' };
    }

    case 'swap_snack': {
      const resolved = resolvePlanEditTarget(
        'swap',
        { ...dispatch.target, slotKind: 'snack' },
        ctx.tree,
      );
      if (resolved.kind === 'miss') return { status: 'clarify', reason: resolved.reason };
      if (resolved.kind !== 'slot') return { status: 'clarify', reason: 'slot_not_found' };

      const snack = await deps.snackContext.load(ctx.householdId);
      const skuId = pickReplacementSnackSku({
        bagCompositions: snack.bagCompositions,
        extraRules: snack.extraRules,
        activeSkus: snack.activeSkus,
        declaredAllergensByChildId: snack.declaredAllergensByChildId,
        weekOf: ctx.weekOf,
        day: resolved.day,
        currentSkuId: resolved.currentSnackSkuId,
      });
      // Fail-closed pool exhaustion is a catalog miss — confirm-gated, never
      // a silent repeat of the same SKU.
      if (skuId === null) return { status: 'escalate', reason: 'catalog_miss' };

      const slot = await deps.plansService.swapSlotSnackSku({
        planId: ctx.planId,
        planSlotId: resolved.planSlotId,
        householdId: ctx.householdId,
        requestId: ctx.requestId,
        input: { new_snack_sku_id: skuId },
      });
      return { status: 'applied', action: 'swap_snack', slot };
    }

    case 'vary': {
      const resolved = resolvePlanEditTarget('vary', dispatch.target, ctx.tree);
      if (resolved.kind === 'miss') return { status: 'clarify', reason: resolved.reason };
      if (resolved.kind !== 'variation') return { status: 'clarify', reason: 'variation_not_found' };

      const current = ctx.tree.variations.find((v) => v.id === resolved.variationId);
      if (!current) return { status: 'clarify', reason: 'variation_not_found' };
      const patch = variationPatchOf(dispatch.variation, current);
      if (patch === null) return { status: 'clarify', reason: 'unknown_variation' };

      const variation = await deps.plansService.updateVariation({
        planId: ctx.planId,
        variationId: resolved.variationId,
        householdId: ctx.householdId,
        requestId: ctx.requestId,
        input: patch,
      });
      return { status: 'applied', action: 'vary', variation };
    }

    case 'safety_write': {
      const result = await deps.householdAllergens.declareIfNew({
        household_id: ctx.householdId,
        child_id: dispatch.target.childId ?? null,
        allergen: dispatch.allergen,
        source: 'plan_edit',
      });
      return {
        status: 'applied',
        action: 'safety_write',
        allergen: dispatch.allergen,
        inserted: result.inserted,
      };
    }
  }
}

// Epic 13-s10 (AC6/AC8) — decide whether an edit outcome should push a
// plan.updated SSE invalidate so other tabs reconcile. Only state-changing
// mutations emit:
//   - applied swaps/vary → always (a row changed)
//   - applied safety_write → only when the declare actually inserted a new
//     allergen row (inserted:true); a no-op re-declaration suppresses (AC8)
//   - acknowledged commit → only on the first confirm (changed:true); a
//     re-confirm no-op suppresses (AC6)
//   - read / clarify / escalate / affirm-noop → never
export function shouldEmitPlanUpdated(outcome: PlanEditOutcome): boolean {
  if (outcome.status === 'applied') {
    if (outcome.action === 'safety_write') return outcome.inserted;
    return true;
  }
  if (outcome.status === 'acknowledged' && outcome.action === 'commit') {
    return outcome.changed;
  }
  return false;
}

// Map an executor outcome onto the PlanEditResult wire shape (snake_case row
// keys per the contracts convention; everything else passes through).
export function toWireResult(outcome: PlanEditOutcome): PlanEditResult {
  switch (outcome.status) {
    case 'applied':
      switch (outcome.action) {
        case 'swap_main':
          return { status: 'applied', action: 'swap_main', main_assignment: outcome.mainAssignment };
        case 'swap_slot':
          return { status: 'applied', action: 'swap_slot', slot: outcome.slot };
        case 'swap_snack':
          return { status: 'applied', action: 'swap_snack', slot: outcome.slot };
        case 'vary':
          return { status: 'applied', action: 'vary', variation: outcome.variation };
        case 'safety_write':
          return {
            status: 'applied',
            action: 'safety_write',
            allergen: outcome.allergen,
            inserted: outcome.inserted,
            ...(outcome.fixedSlots && outcome.fixedSlots.length > 0
              ? { fixed_slots: outcome.fixedSlots }
              : {}),
          };
      }
      break;
    case 'acknowledged':
      return {
        status: 'acknowledged',
        action: outcome.action,
        ...(outcome.action === 'commit' ? { confirmed_at: outcome.confirmedAt } : {}),
      };
    case 'read': {
      const t = outcome.target;
      return {
        status: 'read',
        target: {
          ...(t.day !== undefined ? { day: t.day as 'mon' | 'tue' | 'wed' | 'thu' | 'fri' } : {}),
          ...(t.slotKind !== undefined ? { slotKind: t.slotKind } : {}),
          ...(t.childId !== undefined ? { childId: t.childId } : {}),
        },
      };
    }
    case 'clarify':
      return { status: 'clarify', reason: outcome.reason };
    case 'escalate':
      return {
        status: 'escalate',
        reason: outcome.reason,
        ...(outcome.dishQuery !== undefined ? { dishQuery: outcome.dishQuery } : {}),
      };
  }
}

// Assemble the deterministic snack re-pick inputs from the KitchenMap
// projection (per-child bag_composition / extra_rules / declared_allergens all
// live there) + the household's SKU shelf. Constructed at hook-wiring time so
// executePlanEdit stays repository-free.
export function buildSnackContextLoader(deps: {
  kitchenMapService: { get(householdId: string): Promise<KitchenMap> };
  snackSkuRepository: { findActiveForHousehold(householdId: string): Promise<SnackSkuRow[]> };
}): PlanEditExecutorDeps['snackContext'] {
  return {
    async load(householdId: string): Promise<PlanEditSnackContext> {
      const [kitchenMap, activeSkus] = await Promise.all([
        deps.kitchenMapService.get(householdId),
        deps.snackSkuRepository.findActiveForHousehold(householdId),
      ]);
      const householdAllergens = kitchenMap.household.declared_allergens;
      return {
        bagCompositions: kitchenMap.children.map((c) => ({
          child_id: c.id,
          child_name: c.name,
          snack: c.bag_composition.snack,
          extra: c.bag_composition.extra,
        })),
        extraRules: kitchenMap.children.map((c) => ({
          child_id: c.id,
          child_name: c.name,
          pins: c.extra_rules.pinned,
          bans: c.extra_rules.banned,
        })),
        activeSkus,
        declaredAllergensByChildId: new Map(
          kitchenMap.children.map((c) => [c.id, [...householdAllergens, ...c.declared_allergens]]),
        ),
      };
    },
  };
}

const SHORT_BY_DAY: Partial<Record<Weekday, 'mon' | 'tue' | 'wed' | 'thu' | 'fri'>> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
};

export interface PlanEditTurnDeps extends PlanEditExecutorDeps {
  /** The 'mini'-tier classifier seam. Only used on the utterance path. */
  provider: LLMProvider;
  catalog: DispatchDeps['catalog'];
  planTree: {
    getCurrentPlanTree(planId: string, householdId: string): Promise<{
      plan: PlanRow;
      mainAssignments: PlanMainAssignmentRow[];
      days: PlanDayRow[];
      slots: PlanSlotRow[];
      variations: PlanSlotVariationRow[];
    }>;
  };
  /** Classifier context only (children names for "Maya" → childId). Soft: a
   *  load failure degrades to a context-free classification. */
  kitchenMapForContext: { get(householdId: string): Promise<KitchenMap> };
  /** Epic 13-s10 (AC7) — re-screens the week after a NEW allergen insert and
   *  deterministically re-picks conflicting slots. Optional so the executor is
   *  constructible without it; wired in plans.hook. */
  revalidator?: { revalidate(ctx: RevalidateContext): Promise<RevalidationResult> };
}

export interface PlanEditTurnResult {
  intent: PlanIntentResult;
  dispatch: DispatchResult;
  outcome: PlanEditOutcome;
  /** null on the chip-tap bypass (no classifier call was made). */
  utterance: string | null;
  weekOf: string;
}

// One conversational edit turn: (utterance | pre-built intent) → route →
// dispatch → execute. The chip-tap path skips routePlanIntent entirely — a
// structured affordance costs zero LLM calls (routing-spec §5).
export class PlanEditTurnService {
  constructor(private readonly deps: PlanEditTurnDeps) {}

  async run(input: {
    planId: string;
    householdId: string;
    requestId: string;
    body: PlanEditInput;
  }): Promise<PlanEditTurnResult> {
    const tree = await this.deps.planTree.getCurrentPlanTree(input.planId, input.householdId);

    let intent: PlanIntentResult;
    let utterance: string | null;
    if ('intent' in input.body) {
      intent = input.body.intent;
      utterance = null;
    } else {
      utterance = input.body.utterance;
      const kitchenMap = await this.deps.kitchenMapForContext
        .get(input.householdId)
        .catch(() => undefined);
      const ctx: PlanContextLite = {
        days: tree.days.map((d) => ({ day: SHORT_BY_DAY[d.day] ?? d.day })),
        children: kitchenMap?.children.map((c) => ({ id: c.id, name: c.name })),
      };
      intent = await routePlanIntent(utterance, ctx, this.deps.provider);
    }

    // Recipe ids already placed this week — the swap dedup set.
    const weekExcludeRecipeIds = [
      ...tree.mainAssignments
        .map((m) => m.recipe_id)
        .filter((id): id is string => id !== null && id !== undefined),
      ...tree.slots
        .map((s) => s.recipe_id)
        .filter((id): id is string => id !== null),
    ];

    const dispatch = await dispatchPlanIntent(
      intent,
      { householdId: input.householdId, weekExcludeRecipeIds },
      { catalog: this.deps.catalog },
    );

    // A child-attributed safety write must target a real household child.
    // declareIfNew does NOT scope child_id against the household, and on the
    // chip-tap path childId is client-supplied (the classifier resolves names
    // against the KitchenMap roster, so the utterance path is already safe).
    // Reject a foreign id rather than write a mis-scoped household_allergens
    // row. KitchenMap load is soft here (as on the utterance path): a failed
    // load falls through rather than blocking a legitimate safety write.
    if (dispatch.action === 'safety_write' && dispatch.target.childId) {
      const roster = await this.deps.kitchenMapForContext
        .get(input.householdId)
        .catch(() => undefined);
      if (roster && !roster.children.some((c) => c.id === dispatch.target.childId)) {
        return {
          intent,
          dispatch,
          outcome: { status: 'clarify', reason: 'unknown_child' },
          utterance,
          weekOf: tree.plan.week_of,
        };
      }
    }

    const outcome = await executePlanEdit(
      dispatch,
      {
        planId: input.planId,
        householdId: input.householdId,
        requestId: input.requestId,
        weekOf: tree.plan.week_of,
        tree,
      },
      this.deps,
    );

    // Epic 13-s10 (AC7) — a NEW allergen insert re-screens the week. A conflict
    // we cannot re-pick from cache escalates (catalog_miss) instead of leaving
    // an unsafe slot; otherwise the outcome reports what was fixed. The re-screen
    // needs the full tree (mainAssignments live outside PlanEditTree), so it runs
    // here in the turn service rather than inside executePlanEdit.
    if (
      outcome.status === 'applied' &&
      outcome.action === 'safety_write' &&
      outcome.inserted &&
      this.deps.revalidator
    ) {
      const scopeChildId =
        dispatch.action === 'safety_write' ? dispatch.target.childId ?? null : null;
      const reval = await this.deps.revalidator.revalidate({
        planId: input.planId,
        householdId: input.householdId,
        requestId: input.requestId,
        weekOf: tree.plan.week_of,
        newAllergen: outcome.allergen,
        scopeChildId,
        tree: {
          days: tree.days,
          slots: tree.slots,
          variations: tree.variations,
          mainAssignments: tree.mainAssignments,
        },
      });
      if (reval.status === 'escalate') {
        return {
          intent,
          dispatch,
          outcome: { status: 'escalate', reason: 'catalog_miss' },
          utterance,
          weekOf: tree.plan.week_of,
        };
      }
      if (reval.fixedSlots.length > 0) {
        return {
          intent,
          dispatch,
          outcome: { ...outcome, fixedSlots: reval.fixedSlots },
          utterance,
          weekOf: tree.plan.week_of,
        };
      }
    }

    return { intent, dispatch, outcome, utterance, weekOf: tree.plan.week_of };
  }
}
