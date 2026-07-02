import type { FastifyBaseLogger } from 'fastify';
import type {
  CommitPlanTreeInput,
  FlaggedCompoundItem,
  GuardrailResult,
  PlanComposeTreeOutput,
  PlannerDayInput,
  PlannerMainAssignmentInput,
  PlannerSlotInput,
  PlannerVariationInput,
  SlotKind,
} from '@hivekitchen/types';
import type { BlockedItem, DomainOrchestrator } from '../agents/orchestrator.js';

// =============================================================================
// Slice E — surgical swap-retry helper (tree shape, 9b part 3)
// =============================================================================
// Wraps DomainOrchestrator.swapBlockedItems with the merge + coverage check
// the regenerate callbacks need. Used by both plan-generation.job.ts (initial
// commit retry) and plan-regeneration.job.ts (user-initiated regen retry).
//
// Contract:
//   - Input: previously-committed CommitPlanTreeInput + the rejections that
//     just blocked it.
//   - Returns a merged CommitPlanTreeInput when the swap agent fully covers
//     every blocked (child_id, day, slot_kind) tuple.
//   - Returns null when the swap can't be done (no actionable verdicts, agent
//     errored, agent missed slots, phantom rejections) → caller falls back to
//     a full planWeek.
//
// Coverage: every (child_id, day, slot_kind) in the actionable rejection set
// must have a corresponding swap variation in the output. If even one is
// missing we abandon the swap path — partial merges would silently downgrade
// the safety story.
//
// Merge semantics:
//   - main_assignments: overlay by `sequence`. Swap's main_assignments replace
//     prev's entries with the same sequence; new sequences are appended.
//   - days: for each prev day, find matching swap day by `day`. If swap day
//     present, merge into prev (field-level on day-level pause fields; slots
//     merged by slot_kind). Other prev days pass through unchanged.
//   - slots: matched by slot_kind within a day. Field-level merge for
//     recipe_id / recipe_candidate_id / extra_kind / main_assignment_sequence
//     (swap value takes precedence when defined; else prev preserved).
//     Variations merged by child_id.
//   - variations: matched by child_id. Field-level merge so the agent's
//     allergen-fork-only emission (just removals + add_ons) does not erase
//     portion/texture/spice the original planner chose.
//   - Swap variations whose (child_id, day, slot_kind) is NOT in blockedKeys
//     are dropped — defense against prompt drift rewriting passing children.
// =============================================================================

type SlotKey = `${string}|${string}|${SlotKind}`;

const SLOT_KINDS: ReadonlySet<SlotKind> = new Set<SlotKind>([
  'main',
  'snack',
  'extra',
]);

const makeKey = (childId: string, day: string, slotKind: SlotKind): SlotKey =>
  `${childId}|${day}|${slotKind}`;

const isSlotKind = (s: string): s is SlotKind => SLOT_KINDS.has(s as SlotKind);

export async function trySurgicalSwap(opts: {
  orchestrator: Pick<DomainOrchestrator, 'swapBlockedItems'>;
  previousCommit: CommitPlanTreeInput;
  rejections: readonly GuardrailResult[];
  weekOf: string;
  requestId: string;
  logger: FastifyBaseLogger;
}): Promise<CommitPlanTreeInput | null> {
  const blockedConflicts = opts.rejections.flatMap((r) =>
    r.verdict === 'blocked' ? r.conflicts : [],
  );

  // Story 3.24 — compound-uncertain rejections expose (child_id, day, slot,
  // ingredient) tuples whose allergen provenance the engine can't verify.
  // These are recoverable via substitution alongside hard blocks.
  const compoundFlagged: FlaggedCompoundItem[] = opts.rejections.flatMap((r) =>
    r.verdict === 'uncertain' && r.reason === 'compound_ingredient_unverified'
      ? r.flagged_items ?? []
      : [],
  );

  if (blockedConflicts.length === 0 && compoundFlagged.length === 0) {
    return null;
  }

  // Aggregate conflicts (blocked + compound-flagged) into a single shape the
  // BlockedItem builder can walk. allergen='unknown_compound' is a sentinel
  // for compound flags so the agent receives the (child, slot, ingredient)
  // context — the prompt's uncertainContext line carries the controlling
  // instruction.
  const allConflicts: Array<{
    child_id: string;
    day: string;
    slot: string;
    allergen: string;
    ingredient: string;
  }> = [
    ...blockedConflicts,
    ...compoundFlagged.map((f) => ({
      child_id: f.child_id,
      day: f.day,
      slot: f.slot,
      allergen: 'unknown_compound',
      ingredient: f.ingredient,
    })),
  ];

  const blockedKeys = new Set<SlotKey>();
  for (const c of allConflicts) {
    if (isSlotKind(c.slot)) {
      blockedKeys.add(makeKey(c.child_id, c.day, c.slot));
    }
  }

  if (blockedKeys.size === 0) {
    opts.logger.warn(
      { conflictCount: allConflicts.length },
      'trySurgicalSwap: no actionable blocked tuples (non-canonical slot kinds?) — falling back',
    );
    return null;
  }

  const blockedItems = buildBlockedItemsFromTree(opts.previousCommit, allConflicts);
  if (blockedItems.length === 0) {
    opts.logger.warn(
      {
        conflictCount: allConflicts.length,
        previousDayCount: opts.previousCommit.days.length,
      },
      'trySurgicalSwap: no blocked variations matched commitInput — falling back',
    );
    return null;
  }

  let uncertainContext: string | undefined;
  if (compoundFlagged.length > 0) {
    const seen = new Set<string>();
    const slots = compoundFlagged
      .map((f) => `${f.child_id}|${f.day}|${f.slot}`)
      .filter((s) => {
        const fresh = !seen.has(s);
        seen.add(s);
        return fresh;
      })
      .join(', ');
    uncertainContext =
      `ALLERGEN-UNCERTAIN: Replace the following items — use only single-ingredient ` +
      `items of unambiguous provenance (no sauces, spice blends, pastes, or compound ` +
      `products): ${slots}`;
  }

  let swap: PlanComposeTreeOutput;
  try {
    swap = await opts.orchestrator.swapBlockedItems({
      householdId: opts.previousCommit.household_id,
      weekOf: opts.weekOf,
      requestId: opts.requestId,
      blockedItems,
      ...(uncertainContext !== undefined ? { uncertainContext } : {}),
    });
  } catch (err) {
    opts.logger.warn(
      { err, blockedItemCount: blockedItems.length },
      'trySurgicalSwap: swap agent threw — falling back to full planWeek',
    );
    return null;
  }

  // Build the variation-replacement map. Only swap variations whose
  // (child_id, day, slot_kind) is in blockedKeys are accepted.
  const variationReplacements = new Map<SlotKey, PlannerVariationInput>();
  for (const swapDay of swap.days) {
    for (const swapSlot of swapDay.slots) {
      for (const v of swapSlot.variations) {
        const key = makeKey(v.child_id, swapDay.day, swapSlot.slot_kind);
        if (!blockedKeys.has(key)) continue;
        variationReplacements.set(key, v);
      }
    }
  }

  // Coverage check — every blocked tuple must have a replacement variation.
  const uncovered: SlotKey[] = [];
  for (const key of blockedKeys) {
    if (!variationReplacements.has(key)) uncovered.push(key);
  }
  if (uncovered.length > 0) {
    opts.logger.warn(
      {
        uncovered,
        blockedCount: blockedKeys.size,
        proposedCount: variationReplacements.size,
      },
      'trySurgicalSwap: incomplete coverage — falling back to full planWeek',
    );
    return null;
  }

  // ---- Merge ----
  const mergedMains = mergeMainAssignmentsBySequence(
    opts.previousCommit.main_assignments,
    swap.main_assignments,
  );

  // Index swap days/slots by their natural keys for O(1) lookup during merge.
  const swapDaysByKey = new Map<string, (typeof swap.days)[number]>();
  for (const d of swap.days) swapDaysByKey.set(d.day, d);

  const mergedDays: PlannerDayInput[] = opts.previousCommit.days.map((prevDay) => {
    const swapDay = swapDaysByKey.get(prevDay.day);
    if (swapDay === undefined) return prevDay;
    return mergeDay(prevDay, swapDay, variationReplacements);
  });

  opts.logger.info(
    {
      blockedItemCount: blockedItems.length,
      replacedVariationCount: variationReplacements.size,
      planId: opts.previousCommit.plan_id,
    },
    'trySurgicalSwap: tree merged into commit input',
  );

  return {
    ...opts.previousCommit,
    main_assignments: mergedMains,
    days: mergedDays,
  };
}

// Pulls each blocked tuple's variation out of the previousCommit tree so the
// agent sees what to minimally edit. original_ingredients is the union of the
// variation's add_ons and the specific ingredients that triggered the block —
// the latter covers Story 3.S39 base-ingredient blocks where add_ons is empty.
// Removals are included only for context — the agent uses the same
// (add_ons, removals) pair to describe its replacement.
function buildBlockedItemsFromTree(
  previousCommit: CommitPlanTreeInput,
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
      slot: SlotKind;
      blocked_by: Array<{ allergen: string; ingredient: string }>;
    }
  >();
  for (const c of conflicts) {
    if (!isSlotKind(c.slot)) continue;
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
    const day = previousCommit.days.find((d) => d.day === entry.day);
    if (day === undefined) continue;
    const slot = day.slots.find((s) => s.slot_kind === entry.slot);
    if (slot === undefined) continue;
    const variation = slot.variations.find((v) => v.child_id === entry.child_id);
    if (variation === undefined) continue;
    blocked.push({
      child_id: entry.child_id,
      day: entry.day,
      slot: entry.slot,
      original_ingredients: [
        ...new Set([...(variation.add_ons ?? []), ...entry.blocked_by.map((b) => b.ingredient)]),
      ],
      blocked_by: entry.blocked_by,
    });
  }
  return blocked;
}

// Overlay swap.main_assignments onto prev.main_assignments by `sequence`. A
// swap entry replaces the prev entry with the same sequence; new sequences
// are appended. Result is sorted by sequence for deterministic comparison.
function mergeMainAssignmentsBySequence(
  prev: readonly PlannerMainAssignmentInput[],
  swap: readonly PlannerMainAssignmentInput[],
): PlannerMainAssignmentInput[] {
  const bySeq = new Map<number, PlannerMainAssignmentInput>();
  for (const m of prev) bySeq.set(m.sequence, m);
  for (const m of swap) bySeq.set(m.sequence, m);
  return Array.from(bySeq.values()).sort((a, b) => a.sequence - b.sequence);
}

function mergeDay(
  prev: PlannerDayInput,
  swap: PlannerDayInput,
  variationReplacements: ReadonlyMap<SlotKey, PlannerVariationInput>,
): PlannerDayInput {
  // Field-level merge for day-level pause fields. Swap normally won't touch
  // pause state, but if it does (e.g., agent paused a day in response to a
  // block — not currently part of the swap contract), we honour it.
  const swapSlotsByKind = new Map<SlotKind, PlannerSlotInput>();
  for (const s of swap.slots) swapSlotsByKind.set(s.slot_kind, s);

  const mergedSlots: PlannerSlotInput[] = prev.slots.map((prevSlot) => {
    const swapSlot = swapSlotsByKind.get(prevSlot.slot_kind);
    if (swapSlot === undefined) return prevSlot;
    return mergeSlot(prev.day, prevSlot, swapSlot, variationReplacements);
  });

  return {
    day: prev.day,
    paused_at: swap.paused_at ?? prev.paused_at,
    paused_reason: swap.paused_reason ?? prev.paused_reason,
    paused_note: swap.paused_note ?? prev.paused_note,
    slots: mergedSlots,
  };
}

function mergeSlot(
  dayKey: string,
  prev: PlannerSlotInput,
  swap: PlannerSlotInput,
  variationReplacements: ReadonlyMap<SlotKey, PlannerVariationInput>,
): PlannerSlotInput {
  // Variations: for each prev variation, look up the blocked-and-replaced
  // entry by (child_id, day, slot_kind). When present, field-merge it onto
  // the prev variation so unchanged fields are preserved.
  const mergedVariations: PlannerVariationInput[] = prev.variations.map((prevVar) => {
    const key = makeKey(prevVar.child_id, dayKey, prev.slot_kind);
    const replacement = variationReplacements.get(key);
    if (replacement === undefined) return prevVar;
    return mergeVariation(prevVar, replacement);
  });

  // Slot-level fields: take swap value when defined, else preserve prev.
  // slot_kind is immutable (we matched on it).
  return {
    slot_kind: prev.slot_kind,
    main_assignment_sequence:
      swap.main_assignment_sequence ?? prev.main_assignment_sequence,
    recipe_id: swap.recipe_id ?? prev.recipe_id,
    recipe_candidate_id: swap.recipe_candidate_id ?? prev.recipe_candidate_id,
    extra_kind: swap.extra_kind ?? prev.extra_kind,
    variations: mergedVariations,
  };
}

function mergeVariation(
  prev: PlannerVariationInput,
  swap: PlannerVariationInput,
): PlannerVariationInput {
  // child_id always tracks prev (we matched on it). All other fields field-
  // merge: swap-defined wins, else prev preserved. add_ons + removals
  // typically carry the allergen-fork from the swap; portion/texture/spice
  // are usually undefined on the swap and inherited from prev.
  return {
    child_id: prev.child_id,
    portion_size: swap.portion_size ?? prev.portion_size,
    texture: swap.texture ?? prev.texture,
    spice_level: swap.spice_level ?? prev.spice_level,
    cutting_style: swap.cutting_style ?? prev.cutting_style,
    container: swap.container ?? prev.container,
    add_ons: swap.add_ons ?? prev.add_ons,
    removals: swap.removals ?? prev.removals,
    notes: swap.notes ?? prev.notes,
    paused_at: swap.paused_at ?? prev.paused_at,
  };
}
