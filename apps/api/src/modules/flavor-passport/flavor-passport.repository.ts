import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import type { FlavorPassportStamp } from '@hivekitchen/contracts';
import { BaseRepository } from '../../repository/base.repository.js';

// Slice 4-S12 — passport stamps for one child. ONE stamp per recipe (not per
// (recipe, slot_kind)), so this is a different query/grouping than
// ChildPreferencesRepository.getAggregatedSignals — deliberately a separate
// module. `not-really` signals are excluded at the query boundary.

interface RawStep {
  text: string;
  sequence: number;
  mode: 'prep' | 'finish';
}

interface RawRecipe {
  canonical_name: string;
  cuisine_tags: string[] | null;
  recipe_steps: RawStep[] | null;
}

interface RawPrefRow {
  recipe_id: string;
  slot_kind: 'main' | 'snack' | 'extra';
  signal_type: 'loved' | 'ok';
  signal_date: string;
  // supabase-js embeds a to-one FK as an object but widens the typing to
  // object|array; normalizeEmbedded copes. Re-implemented inline rather than
  // imported from child-preferences.repository to avoid a cross-module coupling.
  recipes: RawRecipe | RawRecipe[] | null;
}

function normalizeEmbedded<T>(value: T | T[] | null): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// method_caption: lowest-sequence finish-mode step text; else lowest-sequence
// step of any mode; else null when the recipe has no steps.
function pickMethodCaption(steps: RawStep[] | null): string | null {
  if (steps === null || steps.length === 0) return null;
  const finishSteps = steps.filter((s) => s.mode === 'finish');
  const pool = finishSteps.length > 0 ? finishSteps : steps;
  // Lowest sequence wins; tiebreak on text so equal-sequence rows are stable
  // regardless of DB row order (the embed has no ORDER BY).
  const chosen = pool.reduce((min, s) =>
    s.sequence < min.sequence || (s.sequence === min.sequence && s.text < min.text) ? s : min,
  );
  return chosen.text;
}

// Dedup priority: 'loved' beats 'ok'; within the same signal_type the most
// recent signal_date wins. signal_date is 'YYYY-MM-DD' so string compare = date
// compare.
function isMoreFavorable(candidate: RawPrefRow, current: RawPrefRow): boolean {
  if (candidate.signal_type !== current.signal_type) {
    return candidate.signal_type === 'loved';
  }
  if (candidate.signal_date !== current.signal_date) {
    return candidate.signal_date > current.signal_date;
  }
  // Full tie (same type + date): pick by slot_kind so the retained row is
  // deterministic rather than dependent on DB row order.
  return candidate.slot_kind < current.slot_kind;
}

export class FlavorPassportRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly logger?: FastifyBaseLogger,
  ) {
    super(client);
  }

  async getStampsForChild(childId: string, householdId: string): Promise<FlavorPassportStamp[]> {
    const { data, error } = await this.client
      .from('child_preferences')
      .select(
        `recipe_id, slot_kind, signal_type, signal_date,
         recipes(canonical_name, cuisine_tags, recipe_steps(text, sequence, mode))`,
      )
      .eq('child_id', childId)
      .eq('household_id', householdId)
      .in('signal_type', ['loved', 'ok']);
    if (error) throw error;

    // Group by recipe_id, keeping only the most favorable row per recipe.
    const byRecipe = new Map<string, { row: RawPrefRow; recipe: RawRecipe }>();
    for (const raw of (data ?? []) as RawPrefRow[]) {
      const recipe = normalizeEmbedded(raw.recipes);
      if (recipe === null) {
        // Recipe deleted out from under the signal (race). Skip — a stamp
        // without a dish name is meaningless.
        this.logger?.warn(
          { recipe_id: raw.recipe_id },
          'flavor-passport: skipping signal with missing recipe',
        );
        continue;
      }
      const existing = byRecipe.get(raw.recipe_id);
      if (existing === undefined || isMoreFavorable(raw, existing.row)) {
        byRecipe.set(raw.recipe_id, { row: raw, recipe });
      }
    }

    return [...byRecipe.values()].map(({ row, recipe }) => ({
      recipe_id: row.recipe_id,
      recipe_name: recipe.canonical_name,
      slot_kind: row.slot_kind,
      signal_type: row.signal_type,
      signal_date: row.signal_date,
      cuisine_tags: recipe.cuisine_tags ?? [],
      method_caption: pickMethodCaption(recipe.recipe_steps),
      child_voice_quote: null,
    }));
  }
}
