import type { FastifyBaseLogger } from 'fastify';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanComposeOutput,
  PlanItemWrite,
} from '@hivekitchen/types';
import type { BlockedItem, DomainOrchestrator } from '../agents/orchestrator.js';

// =============================================================================
// Slice E — surgical swap-retry helper
// =============================================================================
// Wraps DomainOrchestrator.swapBlockedItems with the merge + coverage check
// the regenerate callbacks need. Used by both plan-generation.job.ts (initial
// commit retry) and plan-regeneration.job.ts (user-initiated regen retry).
//
// Contract:
//   - Input: the previously-committed CommitPlanInput + the rejections that
//     just blocked it.
//   - Returns a merged CommitPlanInput when the swap agent fully covers the
//     blocked slots (success path → caller passes this to plansService.commit
//     for re-validation).
//   - Returns null when the swap can't be done (no blocked verdicts, agent
//     errored, agent missed slots) → caller falls back to full planWeek.
//
// Coverage rules: every (child_id, day, slot) that appeared in `blocked`
// conflicts must have a corresponding replacement item in the swap output.
// If even one is missing, we abandon the swap path entirely — partial
// merges would silently downgrade the safety story. Better to pay for a
// full planWeek than commit a plan with a blocked slot still in it.
// =============================================================================

type SlotKey = `${string}|${string}|${string}`;

const makeKey = (childId: string, day: string, slot: string): SlotKey =>
  `${childId}|${day}|${slot}`;

export async function trySurgicalSwap(opts: {
  orchestrator: Pick<DomainOrchestrator, 'swapBlockedItems'>;
  previousCommit: CommitPlanInput;
  rejections: readonly GuardrailResult[];
  weekOf: string;
  requestId: string;
  logger: FastifyBaseLogger;
}): Promise<CommitPlanInput | null> {
  const blockedConflicts = opts.rejections.flatMap((r) =>
    r.verdict === 'blocked' ? r.conflicts : [],
  );

  if (blockedConflicts.length === 0) {
    // Only 'uncertain' verdicts — swap can't help (no specific allergen +
    // ingredient pair to substitute). Fall through to caller's full-regen
    // path so the planner gets to re-attempt with the uncertainty context.
    return null;
  }

  // Dedup blocked keys — a single item can block on multiple allergens.
  const blockedKeys = new Set<SlotKey>(
    blockedConflicts.map((c) => makeKey(c.child_id, c.day, c.slot)),
  );

  const blockedItems = buildBlockedItems(opts.previousCommit, blockedConflicts);
  if (blockedItems.length === 0) {
    // Rejections referenced (child_id, day, slot) tuples that don't exist
    // in previousCommit.items — bug in the caller or stale data. Refuse
    // the swap rather than send the agent garbage context.
    opts.logger.warn(
      { rejections: blockedConflicts.length, commitItems: opts.previousCommit.items.length },
      'trySurgicalSwap: no blocked items matched commitInput — falling back',
    );
    return null;
  }

  let swap: PlanComposeOutput;
  try {
    swap = await opts.orchestrator.swapBlockedItems({
      householdId: opts.previousCommit.household_id,
      weekOf: opts.weekOf,
      requestId: opts.requestId,
      blockedItems,
    });
  } catch (err) {
    opts.logger.warn(
      { err, blockedItemCount: blockedItems.length },
      'trySurgicalSwap: swap agent threw — falling back to full planWeek',
    );
    return null;
  }

  // Flatten swap output into a (key → new item) map, accepting only items
  // whose tuple matches a blocked slot. Items the agent emitted for
  // already-passing slots are dropped on purpose — defense against prompt
  // drift.
  const replacements = new Map<SlotKey, PlanItemWrite>();
  for (const swapDay of swap.days) {
    for (const item of swapDay.items) {
      const key = makeKey(item.child_id, swapDay.day, item.slot);
      if (!blockedKeys.has(key)) continue;
      replacements.set(key, {
        child_id: item.child_id,
        day: swapDay.day,
        slot: item.slot,
        ingredients: [...item.ingredients],
        ...(item.recipe_id !== undefined ? { recipe_id: item.recipe_id } : {}),
        ...(item.item_id !== undefined ? { item_id: item.item_id } : {}),
        ...(item.item_sku_id !== undefined ? { item_sku_id: item.item_sku_id } : {}),
      });
    }
  }

  // Coverage check: every blocked slot must have a replacement. Partial
  // coverage falls through to full planWeek — there's no safe way to commit
  // a plan that still has an unaddressed blocked slot.
  const uncovered: SlotKey[] = [];
  for (const key of blockedKeys) {
    if (!replacements.has(key)) uncovered.push(key);
  }
  if (uncovered.length > 0) {
    opts.logger.warn(
      {
        uncovered,
        blockedCount: blockedKeys.size,
        proposedCount: replacements.size,
      },
      'trySurgicalSwap: incomplete coverage — falling back to full planWeek',
    );
    return null;
  }

  // Merge: replace blocked items by tuple key, leave the rest untouched.
  const mergedItems: PlanItemWrite[] = opts.previousCommit.items.map((item) => {
    const key = makeKey(item.child_id, item.day, item.slot);
    return replacements.get(key) ?? item;
  });

  opts.logger.info(
    {
      blockedItemCount: blockedItems.length,
      replacedItemCount: replacements.size,
      planId: opts.previousCommit.plan_id,
    },
    'trySurgicalSwap: replacements merged into commit input',
  );

  return { ...opts.previousCommit, items: mergedItems };
}

// Pulls the original ingredients for each blocked tuple out of the previous
// commit so the agent sees what to minimally edit. One BlockedItem per unique
// (child_id, day, slot); allergen + ingredient pairs that triggered the
// block are aggregated under blocked_by.
function buildBlockedItems(
  previousCommit: CommitPlanInput,
  conflicts: ReadonlyArray<{
    child_id: string;
    day: string;
    slot: string;
    allergen: string;
    ingredient: string;
  }>,
): BlockedItem[] {
  const byKey = new Map<
    SlotKey,
    {
      child_id: string;
      day: string;
      slot: string;
      blocked_by: Array<{ allergen: string; ingredient: string }>;
    }
  >();
  for (const c of conflicts) {
    const key = makeKey(c.child_id, c.day, c.slot);
    const existing = byKey.get(key);
    if (existing) {
      existing.blocked_by.push({ allergen: c.allergen, ingredient: c.ingredient });
    } else {
      byKey.set(key, {
        child_id: c.child_id,
        day: c.day,
        slot: c.slot,
        blocked_by: [{ allergen: c.allergen, ingredient: c.ingredient }],
      });
    }
  }

  const blocked: BlockedItem[] = [];
  for (const entry of byKey.values()) {
    const sourceItem = previousCommit.items.find(
      (i) => i.child_id === entry.child_id && i.day === entry.day && i.slot === entry.slot,
    );
    if (sourceItem === undefined) continue; // skip phantom references
    blocked.push({
      child_id: entry.child_id,
      day: entry.day,
      slot: entry.slot,
      original_ingredients: sourceItem.ingredients,
      blocked_by: entry.blocked_by,
    });
  }
  return blocked;
}
