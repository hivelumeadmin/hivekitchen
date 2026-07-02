import type {
  KitchenMap,
  KitchenMapChild,
  KitchenMapFavouriteRecipe,
} from '@hivekitchen/types';
import type { PlannerRecipeCandidate } from '../orchestrator.js';

// ===========================================================================
// Story 3.5-s1 — deterministic fixture builders.
// ===========================================================================
// Minimal, fully-typed KitchenMap + plan-tree builders so each fixture stays
// readable. No Date.now()/Math.random() — all timestamps are fixed literals.
// ===========================================================================

export const HH = '11111111-1111-4111-8111-111111111111';
export const WEEK_OF = '2026-05-11'; // a Monday
export const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PROMPT_VERSION = 'v2.9.0';
const FIXED_TS = '2026-05-01T00:00:00+00:00';

export const CHILD = {
  a: '22222222-2222-4222-8222-222222222222',
  b: '33333333-3333-4333-8333-333333333333',
} as const;

export function makeFavourite(name: string): KitchenMapFavouriteRecipe {
  return {
    recipe_id: '44444444-4444-4444-8444-444444444444',
    canonical_name: name,
    primary_ingredient_key: null,
    cuisine_tags: [],
    confidence_score: 50,
    is_household_favorite: false,
    catalog_provenance: 'plan_promoted',
    use_count: 0,
    last_used_at: FIXED_TS,
  };
}

// Story 3.5-s3 — build a PlannerRecipeCandidate for fixture slates. The eval's
// recipe-service double identity-maps names, so passing id === name keeps the
// handle→id→recipeIngredients[name] chain trivial: handle resolves to the name,
// composeTree echoes it, and the assertions look ingredients up by name.
export function makeCandidate(
  id: string,
  name: string,
  opts: { cuisine?: string[]; allergens?: string[]; keys?: string[]; confidence?: number } = {},
): PlannerRecipeCandidate {
  return {
    id,
    name,
    cuisine_tags: opts.cuisine ?? [],
    allergen_flags: opts.allergens ?? [],
    key_ingredients: opts.keys ?? [],
    confidence: opts.confidence ?? 80,
  };
}

export function makeChild(
  id: string,
  name: string,
  opts: { allergens?: string[]; extra?: boolean; dietary?: string[] } = {},
): KitchenMapChild {
  return {
    id,
    name,
    age_band: 'child',
    declared_allergens: opts.allergens ?? [],
    cultural_identifiers: [],
    dietary_preferences: opts.dietary ?? [],
    bag_composition: { main: true, snack: false, extra: opts.extra ?? false },
    bag_composition_pattern: null,
    school_policies: [],
    extra_rules: { pinned: [], banned: [] },
  };
}

export function makeKitchenMap(
  children: KitchenMapChild[],
  opts: {
    declaredAllergens?: string[];
    dietary?: string[];
    cultural?: KitchenMap['cultural']['active'];
    banned?: string[];
  } = {},
): KitchenMap {
  return {
    household: {
      id: HH,
      tier: 'standard',
      tier_variant: 'control',
      timezone: 'America/New_York',
      display_name: 'The Eval Household',
      cultural_identifiers: [],
      dietary_preferences: opts.dietary ?? [],
      declared_allergens: opts.declaredAllergens ?? [],
    },
    caregivers: [],
    children,
    cultural: { active: opts.cultural ?? [], suggested: [] },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: (opts.banned ?? []).map(makeFavourite) },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: FIXED_TS,
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: true,
      required_set_complete: true,
    },
  };
}

export function culturalPrior(
  key: string,
  label: string,
): KitchenMap['cultural']['active'][number] {
  return {
    key,
    label,
    state: 'active',
    tier: 'L1',
    confidence: 90,
    presence: 90,
    enforcement: 'non_negotiable',
  };
}

// ---- plan.compose INPUT tree builders ------------------------------------

export type Variation = {
  child_id: string;
  portion_size?: 'small' | 'regular' | 'large';
  spice_level?: 'mild' | 'regular' | 'spicy';
  removals?: string[];
  add_ons?: string[];
  notes?: string;
};

type ComposeSlot =
  | { slot_kind: 'main'; main_assignment_sequence: number; variations: Variation[] }
  | { slot_kind: 'extra'; recipe_id: string; extra_kind: string; variations: Variation[] };

export function mainSlot(sequence: number, variations: Variation[]): ComposeSlot {
  return { slot_kind: 'main', main_assignment_sequence: sequence, variations };
}

export function extraSlot(
  recipeName: string,
  extraKind: string,
  variations: Variation[],
): ComposeSlot {
  return { slot_kind: 'extra', recipe_id: recipeName, extra_kind: extraKind, variations };
}

export function day(weekday: string, slots: ComposeSlot[]): {
  day: string;
  slots: ComposeSlot[];
} {
  return { day: weekday, slots };
}

export function composeInput(args: {
  mains: Array<{ sequence: number; recipe_id: string }>;
  days: Array<{ day: string; slots: ComposeSlot[] }>;
}): Record<string, unknown> {
  return {
    household_id: HH,
    week_of: WEEK_OF,
    main_assignments: args.mains,
    days: args.days,
    prompt_version: PROMPT_VERSION,
  };
}