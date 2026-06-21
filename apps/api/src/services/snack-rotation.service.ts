import type { SnackSkuRow } from '../modules/recipe/snack-sku.repository.js';
import type { PlannerBagComposition, PlannerExtraRules } from '../agents/orchestrator.js';

// Story 3-S40 — one snack slot per day for injection into CommitPlanTreeInput.
export interface SnackSlotAssignment {
  day: string;          // weekday string, e.g. 'monday'
  snack_sku_id: string;
  child_ids: readonly string[]; // children who have snack=ON this day
}

// Ordered school weekdays for deterministic iteration.
const SCHOOL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

// Normalize category vocab: extra_rules bans use 'veggie'; snack_skus.category
// uses 'vegetable'. Map both directions so bans never silently no-op.
function normalizeCategory(cat: string): string {
  const c = cat.toLowerCase().trim();
  if (c === 'veggie') return 'vegetable';
  if (c === 'vegetable') return 'vegetable';
  return c;
}

// Deterministic index into an array. Uses a simple polynomial hash on the seed
// string so the same (child_ids, week_of, day_index) always maps to the same
// SKU — satisfies the AC8 determinism test. No Math.random() / Date.now().
function deterministicIndex(seed: string, length: number): number {
  if (length === 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % length;
}

// Compute the set of banned categories for the snack slot on a given day.
// The ban applies if ANY snack-ON child bans the category (conservative: we
// pick a SKU acceptable to all children sharing the slot).
function buildBannedCategories(
  snackOnChildIds: readonly string[],
  extraRulesByChildId: ReadonlyMap<string, PlannerExtraRules>,
): Set<string> {
  const banned = new Set<string>();
  for (const childId of snackOnChildIds) {
    const rules = extraRulesByChildId.get(childId);
    if (!rules) continue;
    for (const ban of rules.bans) {
      banned.add(normalizeCategory(ban));
    }
  }
  return banned;
}

// Story 3-S42 — compute the set of pinned categories for the snack slot.
// Mirrors buildBannedCategories: the union of every snack-ON child's pins,
// each normalized. Pins are "prefer" (bias, best-effort) — see assignSnackRotation.
function buildPinnedCategories(
  snackOnChildIds: readonly string[],
  extraRulesByChildId: ReadonlyMap<string, PlannerExtraRules>,
): Set<string> {
  const pinned = new Set<string>();
  for (const childId of snackOnChildIds) {
    const rules = extraRulesByChildId.get(childId);
    if (!rules) continue;
    for (const pin of rules.pins) {
      pinned.add(normalizeCategory(pin));
    }
  }
  return pinned;
}

// Filter active SKUs to those not banned by any child sharing the slot.
function eligibleSkus(
  allSkus: readonly SnackSkuRow[],
  bannedCategories: ReadonlySet<string>,
): SnackSkuRow[] {
  const eligible = allSkus.filter(
    (sku) => !bannedCategories.has(normalizeCategory(sku.category)),
  );
  // Fall back to all SKUs when every category is banned (edge-case safety).
  return eligible.length > 0 ? eligible : [...allSkus];
}

// Story 3-S40 — deterministic per-child×day snack assignment.
//
// For each school day, picks ONE active snack SKU honoring:
//   1. category bans from extra_rules (any snack-ON child's ban applies)
//   2. no same SKU on adjacent days (to avoid monotony)
//   3. deterministic selection (same inputs → same output; no random())
//
// Returns one SnackSlotAssignment per day that has ≥1 snack-ON child.
// Days where all children have snack=OFF produce no entry.
//
// plannedDays: optional subset of weekdays to restrict to (same shape as
// PlanWeekOptions.plannedDays). If absent, defaults to Mon-Fri.
export function assignSnackRotation(opts: {
  bagCompositions: readonly PlannerBagComposition[];
  extraRules: readonly PlannerExtraRules[];
  activeSkus: readonly SnackSkuRow[];
  weekOf: string;
  plannedDays?: readonly string[];
}): SnackSlotAssignment[] {
  const { bagCompositions, extraRules, activeSkus, weekOf, plannedDays } = opts;

  // Build fast lookups.
  const extraRulesByChildId = new Map<string, PlannerExtraRules>(
    extraRules.map((r) => [r.child_id, r]),
  );

  // Children with snack=ON.
  const snackOnChildIds = bagCompositions
    .filter((bc) => bc.snack)
    .map((bc) => bc.child_id);

  if (snackOnChildIds.length === 0 || activeSkus.length === 0) return [];

  // Sort SKUs by id for a stable base ordering.
  const sortedSkus = [...activeSkus].sort((a, b) => a.id.localeCompare(b.id));

  // Determine which days to cover.
  const days: string[] =
    plannedDays && plannedDays.length > 0
      ? SCHOOL_DAYS.filter((d) => plannedDays.includes(d))
      : [...SCHOOL_DAYS];

  const assignments: SnackSlotAssignment[] = [];
  let prevSkuId: string | null = null;

  const bannedCategories = buildBannedCategories(snackOnChildIds, extraRulesByChildId);
  const pinnedCategories = buildPinnedCategories(snackOnChildIds, extraRulesByChildId);

  for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
    const day = days[dayIdx];

    // Eligible SKUs for this day (ban-filtered).
    let candidates = eligibleSkus(sortedSkus, bannedCategories);

    // Story 3-S42 — pin narrowing (after bans, before adjacency). "Prefer"
    // semantics: when ≥1 eligible SKU matches a pinned category, restrict the
    // pick to those; otherwise leave candidates untouched (best-effort, never
    // empties a day). A pinned-but-banned category yields no preferred SKUs and
    // falls back — bans run first by design.
    if (pinnedCategories.size > 0) {
      const preferred = candidates.filter((sku) =>
        pinnedCategories.has(normalizeCategory(sku.category)),
      );
      if (preferred.length > 0) candidates = preferred;
    }

    // No-adjacent-repeat: remove the previous day's pick from the candidate list.
    if (prevSkuId !== null && candidates.length > 1) {
      const filtered = candidates.filter((s) => s.id !== prevSkuId);
      if (filtered.length > 0) candidates = filtered;
      // If filtering leaves nothing (only 1 unique SKU), keep the repeat.
    }

    // Deterministic pick: stable seed = sorted child_ids + weekOf + dayIdx.
    const seed = [...snackOnChildIds].sort().join(':') + '|' + weekOf + '|' + String(dayIdx);
    const idx = deterministicIndex(seed, candidates.length);
    const picked = candidates[idx];

    assignments.push({
      day,
      snack_sku_id: picked.id,
      child_ids: snackOnChildIds,
    });

    prevSkuId = picked.id;
  }

  return assignments;
}
