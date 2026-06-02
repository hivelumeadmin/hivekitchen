import type {
  CommitPlanTreeInput,
  PlanDayRow,
  PlanMainAssignmentRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PlannerDayInput,
  PlannerMainAssignmentInput,
  PlannerSlotInput,
  PlannerVariationInput,
  Weekday,
} from '@hivekitchen/types';

// =============================================================================
// Day-scope regen merge (9b part 3)
// =============================================================================
// Day-scope regen produces a planner output covering only the target day. The
// stored plan tree contains every day plus the plan-level main_assignments;
// committing only the planner-emitted day would erase the siblings. This
// helper overlays the new day onto the existing tree so siblings + Mains
// survive the round-trip.
//
// main_assignments are plan-level by canonical §3.4 — day-scope regen MUST
// NOT mutate them. The helper discards the planner's emitted main_assignments
// in favour of the existing tree's. If the planner-emitted day references a
// sequence the existing tree doesn't declare, the commit_plan RPC fails loud
// at INSERT time — that surface area is owned by the day-scope prompt
// (`main_assignments stay the same`), not by this merge.
//
// Lossy fields (intentional):
//   - plan_slots.paused_at — exists in schema, not yet written by any active
//     path. Dropping it through the planner-input round-trip is a no-op today.
//   - PlanRow timestamps + id — the converter omits them; the calling worker
//     uses the new commitInput's plan_id / week_of / revision / generated_at.
// =============================================================================

export interface ExistingPlanTree {
  readonly mainAssignments: readonly PlanMainAssignmentRow[];
  readonly days: readonly PlanDayRow[];
  readonly slots: readonly PlanSlotRow[];
  readonly variations: readonly PlanSlotVariationRow[];
}

// Convert an existing plan tree (DB row shape) into the planner-input shape
// commit_plan() RPC accepts. Slot pause state is not part of PlannerSlotInput
// and is intentionally dropped (see header note).
export function existingTreeToPlannerShape(existing: ExistingPlanTree): {
  mainAssignments: PlannerMainAssignmentInput[];
  days: PlannerDayInput[];
} {
  const slotsByDay = groupBy(existing.slots, (s) => s.plan_day_id);
  const variationsBySlot = groupBy(existing.variations, (v) => v.plan_slot_id);
  const mainSequenceById = new Map(
    existing.mainAssignments.map((m) => [m.id, m.sequence] as const),
  );

  const days: PlannerDayInput[] = existing.days.map((dayRow) => {
    const slots = (slotsByDay.get(dayRow.id) ?? []).map((slotRow) =>
      rowToPlannerSlot(slotRow, variationsBySlot.get(slotRow.id) ?? [], mainSequenceById),
    );
    return rowToPlannerDay(dayRow, slots);
  });

  return {
    mainAssignments: existing.mainAssignments.map(rowToPlannerMainAssignment),
    days,
  };
}

// Overlay a day-scoped commit (single-day commitInput) onto a full-tree
// commit so the resulting commitInput carries every day and the plan-level
// main_assignments. Used by plan-regeneration.job.ts before commit and inside
// the rejection retry callback.
export function overlayDayScopeOntoFullTree(opts: {
  fullCommit: CommitPlanTreeInput;
  dayScopedCommit: CommitPlanTreeInput;
  targetDay: Weekday;
}): CommitPlanTreeInput {
  const newDay = opts.dayScopedCommit.days.find((d) => d.day === opts.targetDay);
  if (newDay === undefined) {
    // The planner output didn't include the target day after filtering. The
    // caller already throws in this case (`Day-scope regeneration for 'X'
    // returned no days from the planner`), but guard defensively here too.
    throw new Error(
      `overlayDayScopeOntoFullTree: dayScopedCommit has no day matching targetDay='${opts.targetDay}'`,
    );
  }
  const mergedDays: PlannerDayInput[] = opts.fullCommit.days.map((prev) =>
    prev.day === opts.targetDay ? newDay : prev,
  );
  // If the target day didn't exist in the full tree (e.g., regen of a
  // not-yet-emitted day), append it so it's still committed.
  if (!opts.fullCommit.days.some((d) => d.day === opts.targetDay)) {
    mergedDays.push(newDay);
  }
  return {
    ...opts.dayScopedCommit,
    main_assignments: opts.fullCommit.main_assignments,
    days: mergedDays,
  };
}

// Pack an existing plan tree (loaded via getCurrentPlanTree) into the
// CommitPlanTreeInput shape so overlayDayScopeOntoFullTree can consume it.
// plan_id / household_id / week_of / revision / prompt_version / generated_at
// come from the worker's job context (revision is the existing revision so
// downstream code can stamp +1 once after the merge — keeping the increment
// in one place).
export function existingTreeToCommitInput(opts: {
  existing: ExistingPlanTree;
  planId: string;
  householdId: string;
  weekOf: string;
  revision: number;
  promptVersion: string;
  generatedAt: string;
  planBuildId?: string;
}): CommitPlanTreeInput {
  const { mainAssignments, days } = existingTreeToPlannerShape(opts.existing);
  return {
    plan_id: opts.planId,
    household_id: opts.householdId,
    week_of: opts.weekOf,
    revision: opts.revision,
    generated_at: opts.generatedAt,
    prompt_version: opts.promptVersion,
    ...(opts.planBuildId !== undefined ? { plan_build_id: opts.planBuildId } : {}),
    main_assignments: mainAssignments,
    days,
  };
}

// ---- row → planner-input converters ----

function rowToPlannerMainAssignment(
  row: PlanMainAssignmentRow,
): PlannerMainAssignmentInput {
  return { sequence: row.sequence, recipe_id: row.recipe_id };
}

function rowToPlannerDay(
  row: PlanDayRow,
  slots: PlannerSlotInput[],
): PlannerDayInput {
  return {
    day: row.day,
    ...(row.paused_at !== null ? { paused_at: row.paused_at } : {}),
    ...(row.paused_reason !== null ? { paused_reason: row.paused_reason } : {}),
    ...(row.paused_note !== null ? { paused_note: row.paused_note } : {}),
    slots,
  };
}

function rowToPlannerSlot(
  row: PlanSlotRow,
  variationRows: readonly PlanSlotVariationRow[],
  mainSequenceById: ReadonlyMap<string, number>,
): PlannerSlotInput {
  const variations = variationRows.map(rowToPlannerVariation);
  if (row.slot_kind === 'main') {
    if (row.main_assignment_id === null) {
      throw new Error(
        `rowToPlannerSlot: main slot ${row.id} has null main_assignment_id (violates plan_slots XOR CHECK)`,
      );
    }
    const sequence = mainSequenceById.get(row.main_assignment_id);
    if (sequence === undefined) {
      throw new Error(
        `rowToPlannerSlot: main slot ${row.id} references unknown main_assignment_id=${row.main_assignment_id}`,
      );
    }
    return {
      slot_kind: 'main',
      main_assignment_sequence: sequence,
      variations,
    };
  }
  if (row.slot_kind === 'snack') {
    if (row.recipe_id === null) {
      throw new Error(
        `rowToPlannerSlot: snack slot ${row.id} has null recipe_id (violates plan_slots XOR CHECK)`,
      );
    }
    return {
      slot_kind: 'snack',
      recipe_id: row.recipe_id,
      variations,
    };
  }
  // extra
  if (row.recipe_id === null || row.extra_kind === null) {
    throw new Error(
      `rowToPlannerSlot: extra slot ${row.id} missing recipe_id or extra_kind (violates plan_slots XOR CHECK)`,
    );
  }
  return {
    slot_kind: 'extra',
    recipe_id: row.recipe_id,
    extra_kind: row.extra_kind,
    variations,
  };
}

function rowToPlannerVariation(
  row: PlanSlotVariationRow,
): PlannerVariationInput {
  return {
    child_id: row.child_id,
    portion_size: row.portion_size,
    texture: row.texture,
    spice_level: row.spice_level,
    ...(row.cutting_style !== null ? { cutting_style: row.cutting_style } : {}),
    ...(row.container !== null ? { container: row.container } : {}),
    add_ons: row.add_ons,
    removals: row.removals,
    ...(row.notes !== null ? { notes: row.notes } : {}),
    ...(row.paused_at !== null ? { paused_at: row.paused_at } : {}),
  };
}

function groupBy<T, K>(items: readonly T[], keyOf: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}
