import type {
  GetPlansResponse,
  PlanEditResult,
  PlanMainAssignmentRow,
  PlanSlotRow,
  PlanSlotVariationRow,
} from '@hivekitchen/types';

// Epic 13-s10 (AC3) — write an applied plan-edit delta straight into the cached
// GetPlansResponse so the tile re-renders in the same interaction, with no
// blocking refetch. The server-pushed plan.updated SSE invalidate remains the
// authoritative reconciler; this is the optimistic-but-authoritative fast path
// (the rows here ARE the server's returned rows). Pure — the caller owns the
// setQueryData call and the choice of which week key holds the plan.

interface DeltaRows {
  mains: PlanMainAssignmentRow[];
  slots: PlanSlotRow[];
  variations: PlanSlotVariationRow[];
}

// Gather every authoritative row an applied result carries (the primary delta
// plus any safety_write re-screen fixes). Non-applied results carry nothing.
export function collectDeltaRows(result: PlanEditResult): DeltaRows {
  const mains: PlanMainAssignmentRow[] = [];
  const slots: PlanSlotRow[] = [];
  const variations: PlanSlotVariationRow[] = [];

  if (result.status !== 'applied') return { mains, slots, variations };

  if (result.main_assignment) mains.push(result.main_assignment);
  if (result.slot) slots.push(result.slot);
  if (result.variation) variations.push(result.variation);
  for (const fix of result.fixed_slots ?? []) {
    if (fix.main_assignment) mains.push(fix.main_assignment);
    if (fix.slot) slots.push(fix.slot);
  }

  return { mains, slots, variations };
}

// Replace matching rows by id; never append (a swap/vary targets a row that
// already exists in this week's tree — a row not present belongs to another
// week's cache and is left untouched there).
function replaceById<T extends { id: string }>(
  arr: readonly T[],
  updates: readonly T[],
): T[] {
  if (updates.length === 0) return [...arr];
  const byId = new Map(updates.map((u) => [u.id, u]));
  return arr.map((row) => byId.get(row.id) ?? row);
}

export function hasDeltaRows(rows: DeltaRows): boolean {
  return rows.mains.length > 0 || rows.slots.length > 0 || rows.variations.length > 0;
}

// Merge an applied result's rows into a cached plan response. Returns the same
// reference-shape GetPlansResponse with the affected arrays rewritten.
export function mergePlanEditDelta(
  prev: GetPlansResponse,
  result: PlanEditResult,
): GetPlansResponse {
  const rows = collectDeltaRows(result);
  if (!hasDeltaRows(rows)) return prev;
  return {
    ...prev,
    main_assignments: replaceById(prev.main_assignments, rows.mains),
    slots: replaceById(prev.slots, rows.slots),
    variations: replaceById(prev.variations, rows.variations),
  };
}
