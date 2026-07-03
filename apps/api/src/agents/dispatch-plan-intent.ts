import { PLAN_INTENT, type PlanIntent, type PlanIntentResult } from './route-plan-intent.js';
import type { CatalogCandidate, RecipeSlotKind } from '../services/catalog-pick.service.js';

// Epic 13-s9 / routing-spec §6 — the deterministic dispatcher. Given a
// classified PlanIntentResult it decides the cost TIER and the concrete action,
// resolving swaps against the cached catalog (T0, zero LLM). It is the
// cost-control brain: the expensive agentic path is only ever reached via an
// `escalate` result (a confirm gate the caller honors), never auto-spent.
//
// dispatch DECIDES; it does not write. The caller executes T0 decisions through
// the existing services (plans.service.swapSlotRecipe / variation update,
// HouseholdAllergensRepository.declareIfNew, assignSnackRotation for snacks) and
// the commit-time allergy guardrail enforces at the write boundary. Returning a
// typed decision keeps dispatch pure + testable and lets routing-spec decision
// #3 (plan_slots recipe_id vs snack_sku_id) live in the swap service, not here.

export type DispatchTier = 'T0' | 'T1' | 'T2';
export type EscalateReason = 'catalog_miss' | 'add_dish' | 'recompose' | 'compose_next';

export interface SlotTarget {
  day?: string; // mon..fri
  slotKind?: 'main' | 'snack' | 'extra';
  childId?: string;
}

export type DispatchResult =
  // T0 — deterministic
  | { tier: 'T0'; action: 'swap'; intent: PlanIntent; candidate: CatalogCandidate; target: SlotTarget }
  | { tier: 'T0'; action: 'swap_snack'; intent: PlanIntent; target: SlotTarget }
  | { tier: 'T0'; action: 'vary'; intent: PlanIntent; variation: string; target: SlotTarget }
  | { tier: 'T0'; action: 'safety_write'; intent: PlanIntent; allergen: string; target: SlotTarget }
  | { tier: 'T0'; action: 'commit' }
  | { tier: 'T0'; action: 'noop' } // affirm
  | { tier: 'T0'; action: 'read'; intent: PlanIntent; target: SlotTarget } // inspect / explain
  // T1 — cheap reply / clarify
  | { tier: 'T1'; action: 'reply'; intent: PlanIntent }
  // T2 — expensive agentic path, behind a confirm gate
  | { tier: 'T2'; action: 'escalate'; intent: PlanIntent; reason: EscalateReason; dishQuery?: string };

export interface DispatchDeps {
  catalog: {
    pickRecipe(args: {
      householdId: string;
      slot: RecipeSlotKind;
      excludeRecipeIds?: readonly string[];
      constraint?: string | null;
    }): Promise<CatalogCandidate | null>;
  };
}

export interface DispatchContext {
  householdId: string;
  // Recipe ids already placed in the current week (dedup for swaps).
  weekExcludeRecipeIds?: readonly string[];
}

function targetOf(intent: PlanIntentResult): SlotTarget {
  const t: SlotTarget = {};
  if (intent.day) t.day = intent.day;
  if (intent.slotKind) t.slotKind = intent.slotKind;
  if (intent.childId) t.childId = intent.childId;
  return t;
}

// Map the classified slotKind to a recipe slot. A swap with no slotKind targets
// the Main (the day's anchor). Snack returns null — snacks are not served by the
// catalog recipe selector (assignSnackRotation handles them).
function recipeSlotOf(slotKind: PlanIntentResult['slotKind']): RecipeSlotKind | null {
  if (slotKind === 'snack') return null;
  if (slotKind === 'extra') return 'extra';
  return 'main';
}

/**
 * Decide tier + action for one classified intent. Deterministic except the
 * catalog read for swaps. Never auto-spends the expensive path — misses and
 * net-new/recompose intents return `escalate` for the caller's confirm gate.
 */
export async function dispatchPlanIntent(
  intent: PlanIntentResult,
  ctx: DispatchContext,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  switch (intent.intent) {
    case PLAN_INTENT.INSPECT:
    case PLAN_INTENT.EXPLAIN:
      return { tier: 'T0', action: 'read', intent: intent.intent, target: targetOf(intent) };

    case PLAN_INTENT.AFFIRM:
      return { tier: 'T0', action: 'noop' };

    case PLAN_INTENT.COMMIT:
      return { tier: 'T0', action: 'commit' };

    case PLAN_INTENT.VARY_SLOT:
      // A variation with no normalized variation value can't be applied — clarify.
      if (!intent.variation) return { tier: 'T1', action: 'reply', intent: intent.intent };
      return {
        tier: 'T0',
        action: 'vary',
        intent: intent.intent,
        variation: intent.variation,
        target: targetOf(intent),
      };

    case PLAN_INTENT.SAFETY_WRITE:
      // A safety write with no allergen value can't be applied — clarify,
      // never guess (safety data is never inferred).
      if (!intent.allergen) return { tier: 'T1', action: 'reply', intent: intent.intent };
      return {
        tier: 'T0',
        action: 'safety_write',
        intent: intent.intent,
        allergen: intent.allergen,
        target: targetOf(intent),
      };

    case PLAN_INTENT.SWAP_SLOT:
    case PLAN_INTENT.EXCLUDE_FILTER: {
      const slot = recipeSlotOf(intent.slotKind);
      if (slot === null) {
        // Snack swap: deterministic via assignSnackRotation (caller-wired). Not a
        // catalog miss — must not trigger the T2 add-dish path.
        return { tier: 'T0', action: 'swap_snack', intent: intent.intent, target: targetOf(intent) };
      }
      const candidate = await deps.catalog.pickRecipe({
        householdId: ctx.householdId,
        slot,
        excludeRecipeIds: ctx.weekExcludeRecipeIds,
        constraint: intent.constraint,
      });
      if (!candidate) {
        return { tier: 'T2', action: 'escalate', intent: intent.intent, reason: 'catalog_miss' };
      }
      return { tier: 'T0', action: 'swap', intent: intent.intent, candidate, target: targetOf(intent) };
    }

    case PLAN_INTENT.ADD_DISH:
      return {
        tier: 'T2',
        action: 'escalate',
        intent: intent.intent,
        reason: 'add_dish',
        ...(intent.dishQuery ? { dishQuery: intent.dishQuery } : {}),
      };

    case PLAN_INTENT.RECOMPOSE:
      return { tier: 'T2', action: 'escalate', intent: intent.intent, reason: 'recompose' };

    case PLAN_INTENT.COMPOSE_NEXT:
      return { tier: 'T2', action: 'escalate', intent: intent.intent, reason: 'compose_next' };

    case PLAN_INTENT.FALLBACK:
      return { tier: 'T1', action: 'reply', intent: intent.intent };

    default: {
      // Exhaustiveness — a new PLAN_INTENT without a case is a compile error.
      const _exhaustive: never = intent.intent;
      return { tier: 'T1', action: 'reply', intent: _exhaustive };
    }
  }
}
