import { ChildSignalOutputSchema } from '@hivekitchen/contracts';
import type {
  ChildSignalOutput,
  ChildSignalPerChild,
  ChildSignalRecipeItem,
} from '@hivekitchen/types';
import type {
  ChildPreferenceAggregate,
  ChildPreferencesRepository,
} from './child-preferences.repository.js';
import type { ChildrenRepository } from '../children/children.repository.js';

export interface ChildNameRef {
  child_id: string;
  child_name: string;
}

// Story 4-S11 — pure assembly of the child_signal output from aggregated
// signals + the children roster. Shared by the child_signal agent tool and the
// GET /signal-summary endpoint so the two surfaces can never diverge.
//
// FR125: per_child is built ONLY from children that appear in the aggregates —
// a child with no signals in the window is absent (never a zero-score entry).
// FR124: slot_kind is carried through from the aggregate group key, so a recipe
// rated in two slots produces two independent items.
// FR126: family_liked requires >= 2 distinct children liking the same
// (recipe_id, slot_kind) pair.
export function assembleChildSignal(
  aggregates: readonly ChildPreferenceAggregate[],
  children: readonly ChildNameRef[],
): ChildSignalOutput {
  const nameById = new Map(children.map((c) => [c.child_id, c.child_name]));

  const byChild = new Map<string, ChildPreferenceAggregate[]>();
  for (const agg of aggregates) {
    const list = byChild.get(agg.child_id) ?? [];
    list.push(agg);
    byChild.set(agg.child_id, list);
  }

  const toItem = (agg: ChildPreferenceAggregate, count: number): ChildSignalRecipeItem => ({
    recipe_id: agg.recipe_id,
    recipe_name: agg.recipe_name,
    slot_kind: agg.slot_kind,
    count,
    last_at: agg.last_signal_at,
  });

  const per_child: ChildSignalPerChild[] = [];
  for (const [childId, aggs] of byChild) {
    const liked = aggs
      .filter((a) => a.loved_count > 0 || a.ok_count > 0)
      .sort((x, y) => y.loved_count + y.ok_count - (x.loved_count + x.ok_count))
      .map((a) => toItem(a, a.loved_count + a.ok_count));
    // An explicit 'not-really' tap with no positive signal is a deliberate
    // avoidance hint; a recipe that ALSO has any loved/ok is not "disliked".
    const disliked = aggs
      .filter((a) => a.not_really_count > 0 && a.loved_count === 0 && a.ok_count === 0)
      .map((a) => toItem(a, a.not_really_count));
    per_child.push({
      child_id: childId,
      child_name: nameById.get(childId) ?? '',
      liked,
      disliked,
    });
  }

  const familyMap = new Map<
    string,
    { recipe_id: string; recipe_name: string; slot_kind: 'main' | 'snack' | 'extra'; children: Set<string> }
  >();
  for (const pc of per_child) {
    for (const item of pc.liked) {
      const key = `${item.recipe_id} ${item.slot_kind}`;
      let entry = familyMap.get(key);
      if (entry === undefined) {
        entry = {
          recipe_id: item.recipe_id,
          recipe_name: item.recipe_name,
          slot_kind: item.slot_kind,
          children: new Set(),
        };
        familyMap.set(key, entry);
      }
      entry.children.add(pc.child_id);
    }
  }
  const family_liked = [...familyMap.values()]
    .filter((e) => e.children.size >= 2)
    .map((e) => ({
      recipe_id: e.recipe_id,
      recipe_name: e.recipe_name,
      slot_kind: e.slot_kind,
      child_count: e.children.size,
    }));

  return ChildSignalOutputSchema.parse({ per_child, family_liked });
}

// Loads the inputs (aggregates + children roster) in parallel and assembles the
// output. lookbackDays bounds the signal window; sinceDate is the inclusive
// lower bound passed to the aggregation query.
export async function loadChildSignal(opts: {
  childPrefsRepo: ChildPreferencesRepository;
  childrenRepo: ChildrenRepository;
  householdId: string;
  lookbackDays: number;
}): Promise<ChildSignalOutput> {
  const sinceDate = new Date(Date.now() - opts.lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [aggregates, children] = await Promise.all([
    opts.childPrefsRepo.getAggregatedSignals(opts.householdId, sinceDate),
    opts.childrenRepo.findByHouseholdId(opts.householdId),
  ]);
  const childRefs: ChildNameRef[] = children.map((c) => ({
    child_id: c.id,
    child_name: c.name,
  }));
  return assembleChildSignal(aggregates, childRefs);
}
