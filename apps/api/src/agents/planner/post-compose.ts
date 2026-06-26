import type { AgeBand, PlanComposeTreeOutput } from '@hivekitchen/types';
import type { PlannerContext } from './context/assemble.js';

// Story 3.5-s6 — deterministic post-compose passes. The planner prompt no
// longer carries the mechanical default/rule prose (v2.10.0); these two
// functions enforce it in code regardless of model compliance.
//
// applyPlanDefaults fills per-variation defaults the model left undefined;
// enforceNoConsecutiveMain is a hard validator that throws on a
// no-consecutive-Main violation rather than silently repairing it (mirrors the
// fail-loud philosophy of plan.compose step-10). Neither reads/writes the DB.

// Local copy of the weekday order used for adjacency. The eval helper
// (planner-eval.assertions.ts) defines the same set — kept local here on
// purpose so production code never cross-imports a test helper.
const WEEKDAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

// texture default derived from the child's age_band. Exhaustive over AgeBand —
// TypeScript errors if a band is added without a branch here.
const TEXTURE_BY_AGE_BAND: Record<AgeBand, 'soft' | 'normal'> = {
  toddler: 'soft',
  child: 'normal',
  preteen: 'normal',
  teen: 'normal',
};

// Returns a new PlanComposeTreeOutput (never mutates input) with portion_size,
// spice_level, and texture filled for every variation that left them
// undefined. Only those three fields are touched — removals/add_ons/cutting_style/
// container/notes/paused_at (the allergen-fork carriers) pass through untouched.
export function applyPlanDefaults(
  output: PlanComposeTreeOutput,
  ctx: PlannerContext,
): PlanComposeTreeOutput {
  const childAgeBandMap = new Map<string, AgeBand>(
    ctx.kitchenMap?.children.map((c) => [c.id, c.age_band]) ?? [],
  );

  return {
    ...output,
    days: output.days.map((day) => ({
      ...day,
      slots: day.slots.map((slot) => ({
        ...slot,
        variations: slot.variations.map((v) => {
          const ageBand = childAgeBandMap.get(v.child_id);
          const textureDefault =
            ageBand !== undefined ? TEXTURE_BY_AGE_BAND[ageBand] : 'normal';
          return {
            ...v,
            portion_size: v.portion_size ?? 'regular',
            spice_level: v.spice_level ?? 'mild',
            texture: v.texture ?? textureDefault,
          };
        }),
      })),
    })),
  };
}

// Throws if two adjacent calendar days share the same Main. Days are sorted by
// WEEKDAY_ORDER first; only genuinely-adjacent pairs (index delta === 1) are
// compared, so a Mon→Wed gap is never flagged. A day with no main slot (paused
// or extra-only) is skipped because its main_assignment_sequence is undefined.
export function enforceNoConsecutiveMain(output: PlanComposeTreeOutput): void {
  const sorted = [...output.days].sort(
    (a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day),
  );

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];

    const prevIdx = WEEKDAY_ORDER.indexOf(prev.day);
    const curIdx = WEEKDAY_ORDER.indexOf(cur.day);
    if (curIdx - prevIdx !== 1) continue;

    const prevMain = prev.slots.find((s) => s.slot_kind === 'main')
      ?.main_assignment_sequence;
    const curMain = cur.slots.find((s) => s.slot_kind === 'main')
      ?.main_assignment_sequence;
    if (prevMain === undefined || curMain === undefined) continue;

    if (prevMain === curMain) {
      throw new Error(
        `[enforceNoConsecutiveMain] consecutive Main on ${prev.day}→${cur.day} (sequence ${String(prevMain)})`,
      );
    }
  }
}
