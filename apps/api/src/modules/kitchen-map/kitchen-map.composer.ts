import type {
  CatalogProvenance,
  KitchenMap,
  KitchenMapAllergen,
  KitchenMapCaregiver,
  KitchenMapChild,
  KitchenMapCultural,
  KitchenMapCulturalPrior,
  KitchenMapCulturalPriorState,
  KitchenMapDietary,
  KitchenMapFavoriteLunch,
  KitchenMapFavouriteRecipe,
  KitchenMapFoodPreference,
  KitchenMapMemoryNode,
  KitchenMapMemoryNodeType,
  KitchenMapRecipes,
  KitchenMapRule,
} from '@hivekitchen/types';
import {
  ENFORCEMENT_LEVEL_VALUES,
  bagCompositionFromPattern,
  type EnforcementLevel,
} from '@hivekitchen/contracts';
import type {
  RawAllergenRow,
  RawCaregiverRow,
  RawChildRow,
  RawCulturalPriorRow,
  RawDietaryRow,
  RawFavouriteRecipeRow,
  RawFoodPreferenceRow,
  RawKitchenMapData,
  RawMemoryNodeRow,
  RawRuleRow,
  RawSchoolPolicyRow,
} from './kitchen-map.repository.js';

// Slice 2.6-s1 — favorite_lunches projection is now derived from
// household_recipe_usage rows whose catalog_provenance flags them as
// parent-stated, joined to recipes for canonical_name.
const VALID_CATALOG_PROVENANCES = new Set<CatalogProvenance>([
  'declared',
  'inferred',
  'parent_added',
  'plan_promoted',
]);
const FAVORITE_LUNCH_PROVENANCES = new Set<CatalogProvenance>([
  'declared',
  'parent_added',
]);
const FAVORITE_LUNCHES_LIMIT = 20;

// Slice 2.5-s1 — schema 1.0.0 → 1.1.0. Added: household.display_name,
// child.bag_composition_pattern (derived), cultural prior enforcement,
// five new top-level arrays, meta.required_set_complete.
const SCHEMA_VERSION = '1.1.0' as const;

// Confidence threshold above which a recipe surfaces as a "favourite" even
// without the explicit is_household_favorite flag. Tuned to be conservative
// — the score is heuristic, so we'd rather under-recommend than over-.
const FAVOURITE_CONFIDENCE_THRESHOLD = 75;
const FAVOURITES_LIMIT = 30;

const ACTIVE_PRIOR_STATES = new Set(['active', 'opt_in_confirmed']);
const SUGGESTED_PRIOR_STATES = new Set(['detected', 'suggested']);

// Map enum kept in sync with KitchenMapCulturalPriorStateSchema. Composer
// passes through valid states verbatim; unknown DB states default to
// 'suggested' so the projection never panics on rogue data.
const VALID_PRIOR_STATES = new Set<KitchenMapCulturalPriorState>([
  'detected',
  'suggested',
  'opt_in_confirmed',
  'active',
  'dormant',
  'forgotten',
]);

// Slice 2.5-s2 — narrowed alongside the contract / DB enum. Memory_node
// rows with the removed types are soft-forgotten in 20260904000100; the
// filter is purely defensive against unexpected rogue data.
const VALID_MEMORY_NODE_TYPES = new Set<KitchenMapMemoryNodeType>([
  'rhythm',
  'child_obsession',
  'other',
]);

const VALID_ENFORCEMENT_LEVELS = new Set<EnforcementLevel>(ENFORCEMENT_LEVEL_VALUES);

/**
 * Slice A0.5 — pure function: raw source rows → KitchenMap projection.
 *
 * The composer makes the bucketing / filtering / shape-mapping decisions
 * that depend only on the data. Nothing in here touches the DB, Redis, or
 * the logger; that's why it's trivially unit-testable.
 *
 * Slice 2.5-s1 — extended with five new top-level arrays (allergens,
 * dietary, food_preferences, favorite_lunches, rules) and the
 * meta.required_set_complete flag. New arrays are empty for every existing
 * household until the moment slices (2.5-s5+) populate them.
 */
export function composeKitchenMap(raw: RawKitchenMapData): KitchenMap {
  const schoolPoliciesByChild = groupSchoolPoliciesByChild(raw.school_policies);
  const children = raw.children.map((c) => projectChild(c, schoolPoliciesByChild));

  return {
    household: {
      id: raw.household.id,
      tier: raw.household.tier,
      tier_variant: raw.household.tier_variant,
      timezone: raw.household.timezone,
      // Slice 2.5-s1 — parent-chosen household label. Existing pre-Epic-2.5
      // households got a deterministic placeholder via migration backfill;
      // mid-onboarding households (no row yet) project as null.
      display_name: raw.household.display_name,
      // Slice 2-s27 — household-level food identity.
      cultural_identifiers: raw.household.cultural_identifiers,
      dietary_preferences: raw.household.dietary_preferences,
      declared_allergens: raw.household.declared_allergens,
    },
    caregivers: projectCaregivers(raw.caregivers),
    children,
    cultural: projectCultural(raw.cultural_priors),
    memory: projectMemory(raw.memory_nodes),
    household_extras: {
      library: raw.extra_library.map((e) => ({
        id: e.id,
        name: e.name,
        component_type: e.component_type,
      })),
    },
    recipes: projectRecipes(raw.recipe_usage),
    // Slice 2.5-s1 — five new top-level arrays. Existing repositories
    // return [] for households that haven't been through Epic 2.5 moments;
    // newly-onboarded households start populating these as slices 2.5-s5
    // through 2.5-s9 ship.
    //
    // Slice 2.6-s1 — favorite_lunches is now derived from the same
    // recipe_usage rows projectRecipes consumes (single source of truth);
    // the standalone favorite_lunches table is dropped.
    allergens: projectAllergens(raw.allergens),
    dietary: projectDietary(raw.dietary),
    food_preferences: projectFoodPreferences(raw.food_preferences),
    favorite_lunches: projectFavoriteLunchesFromUsage(raw.recipe_usage),
    rules: projectRules(raw.rules),
    meta: {
      composed_at: new Date().toISOString(),
      map_version: raw.household.kitchen_map_version,
      schema_version: SCHEMA_VERSION,
      is_complete: deriveIsComplete(children, raw.cultural_priors),
      // Slice 2.5-s1 — stub `false` for every existing household. The real
      // computation (based on the required-set definition from 2.5-s4 and
      // the finalize gate in 2.5-s10) lands in those slices. Until then the
      // contract field is present but always false; downstream UIs treat
      // false as "still onboarding" (matches today's is_complete heuristic).
      required_set_complete: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

function projectCaregivers(caregivers: RawCaregiverRow[]): KitchenMapCaregiver[] {
  return caregivers
    .filter((c) => c.role === 'primary_parent' || c.role === 'secondary_caregiver')
    .map((c) => ({
      user_id: c.user_id,
      role: c.role as 'primary_parent' | 'secondary_caregiver',
      display_name: c.display_name ?? '(unnamed caregiver)',
      cultural_language: c.cultural_language,
    }));
}

function groupSchoolPoliciesByChild(rows: RawSchoolPolicyRow[]): Map<string, string[]> {
  // Project each policy row to a single agent-friendly string. policy_type is
  // the canonical identifier (e.g. 'nut_free'); slot_scope qualifies which
  // slot it applies to. Description is optional human prose — included when
  // present for context but kept terse.
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const slot = r.slot_scope === 'bag_wide' ? '' : `:${r.slot_scope}`;
    const desc = r.policy_description ? ` — ${r.policy_description}` : '';
    const projected = `${r.policy_type}${slot}${desc}`;
    const list = out.get(r.child_id) ?? [];
    list.push(projected);
    out.set(r.child_id, list);
  }
  return out;
}

function projectChild(
  row: RawChildRow,
  schoolPoliciesByChild: Map<string, string[]>,
): KitchenMapChild {
  // Story 3-DM-B1 — bag_composition booleans are derived from the canonical
  // pattern enum. Both fields are surfaced on the projection: legacy boolean
  // struct for planner allergy-filter selection, and the enum for the parent-
  // mental-model UI.
  return {
    id: row.id,
    name: row.name,
    age_band: row.age_band,
    declared_allergens: row.declared_allergens,
    cultural_identifiers: row.cultural_identifiers,
    dietary_preferences: row.dietary_preferences,
    bag_composition: bagCompositionFromPattern(row.bag_composition_pattern),
    bag_composition_pattern: row.bag_composition_pattern,
    school_policies: schoolPoliciesByChild.get(row.id) ?? [],
    extra_rules: {
      pinned: row.extra_rules.pins,
      banned: row.extra_rules.bans,
    },
  };
}

function projectCultural(rows: RawCulturalPriorRow[]): KitchenMapCultural {
  const active: KitchenMapCulturalPrior[] = [];
  const suggested: KitchenMapCulturalPrior[] = [];

  for (const r of rows) {
    const state: KitchenMapCulturalPriorState = VALID_PRIOR_STATES.has(
      r.state as KitchenMapCulturalPriorState,
    )
      ? (r.state as KitchenMapCulturalPriorState)
      : 'suggested';

    // Slice 2.5-s1 — enforcement defaults to 'just_for_context' for any row
    // that doesn't have a recognised value (defensive against rogue DB data
    // and pre-migration rows during deployment).
    const enforcement: EnforcementLevel = VALID_ENFORCEMENT_LEVELS.has(
      r.enforcement as EnforcementLevel,
    )
      ? (r.enforcement as EnforcementLevel)
      : 'just_for_context';

    const projected: KitchenMapCulturalPrior = {
      key: r.key,
      label: r.label,
      state,
      tier: r.tier,
      confidence: r.confidence,
      presence: r.presence,
      enforcement,
    };

    if (ACTIVE_PRIOR_STATES.has(r.state)) {
      active.push(projected);
    } else if (SUGGESTED_PRIOR_STATES.has(r.state)) {
      suggested.push(projected);
    }
    // 'dormant' / 'forgotten' deliberately excluded — the agent treats
    // these as if the household never declared them.
  }

  return { active, suggested };
}

function projectMemory(rows: RawMemoryNodeRow[]): { nodes: KitchenMapMemoryNode[] } {
  const nodes: KitchenMapMemoryNode[] = [];
  for (const r of rows) {
    if (!VALID_MEMORY_NODE_TYPES.has(r.node_type as KitchenMapMemoryNodeType)) continue;
    nodes.push({
      node_type: r.node_type as KitchenMapMemoryNodeType,
      facet: r.facet,
      prose_text: r.prose_text,
      subject_child_id: r.subject_child_id,
    });
  }
  return { nodes };
}

function coerceCatalogProvenance(value: string): CatalogProvenance {
  // Defensive read: rogue DB values (e.g. an in-flight migration row) project
  // as 'plan_promoted' rather than crash the whole map. Mirrors the rogue-
  // enforcement coercion elsewhere in this composer.
  return VALID_CATALOG_PROVENANCES.has(value as CatalogProvenance)
    ? (value as CatalogProvenance)
    : 'plan_promoted';
}

function projectRecipes(rows: RawFavouriteRecipeRow[]): KitchenMapRecipes {
  const favourites: KitchenMapFavouriteRecipe[] = [];
  const banned: KitchenMapFavouriteRecipe[] = [];

  for (const r of rows) {
    const entry: KitchenMapFavouriteRecipe = {
      recipe_id: r.recipe_id,
      canonical_name: r.canonical_name,
      primary_ingredient_key: r.primary_ingredient_key,
      cuisine_tags: r.cuisine_tags,
      confidence_score: r.confidence_score,
      is_household_favorite: r.is_household_favorite,
      // Slice 2.6-s1 — surfaces household_recipe_usage.catalog_provenance.
      catalog_provenance: coerceCatalogProvenance(r.catalog_provenance),
      use_count: r.use_count,
      last_used_at: r.last_used_at,
    };

    if (r.is_household_banned) {
      banned.push(entry);
      continue;
    }
    if (r.is_household_favorite || r.confidence_score >= FAVOURITE_CONFIDENCE_THRESHOLD) {
      favourites.push(entry);
    }
  }

  // Highest confidence first; cap at FAVOURITES_LIMIT so the projection
  // stays a reasonable prompt size.
  favourites.sort((a, b) => b.confidence_score - a.confidence_score);
  return {
    favourites: favourites.slice(0, FAVOURITES_LIMIT),
    banned,
  };
}

// Slice 2.6-s1 — derive the favorite_lunches projection from the same
// recipe_usage rows. A row qualifies when EITHER its catalog_provenance is
// parent-stated ('declared' / 'parent_added') OR is_household_favorite=true.
// Excluded: banned rows; rows whose canonical_name is missing (FK to recipes
// already filtered by the repository — defensive).
// Order: is_household_favorite DESC, then last_used_at DESC NULLS LAST.
// Position is the 0-based index after ordering.
function projectFavoriteLunchesFromUsage(
  rows: RawFavouriteRecipeRow[],
): KitchenMapFavoriteLunch[] {
  const filtered = rows
    .filter((r) => !r.is_household_banned)
    .filter((r) => {
      const prov = coerceCatalogProvenance(r.catalog_provenance);
      return r.is_household_favorite || FAVORITE_LUNCH_PROVENANCES.has(prov);
    });

  filtered.sort((a, b) => {
    if (a.is_household_favorite !== b.is_household_favorite) {
      return a.is_household_favorite ? -1 : 1;
    }
    const aTs = a.last_used_at ?? '';
    const bTs = b.last_used_at ?? '';
    return bTs.localeCompare(aTs);
  });

  return filtered.slice(0, FAVORITE_LUNCHES_LIMIT).map((r, idx) => ({
    item: r.canonical_name,
    provenance: coerceCatalogProvenance(r.catalog_provenance),
    position: idx,
  }));
}

// Slice 2.5-s1 — projection helpers for the five new top-level arrays.
// Each pass-through is a simple shape map; defensive coercion happens at
// the source CHECK constraints in the migration.

function projectAllergens(rows: RawAllergenRow[]): KitchenMapAllergen[] {
  return rows.map((r) => ({
    child_id: r.child_id,
    allergen: r.allergen,
    source: r.source,
  }));
}

function projectDietary(rows: RawDietaryRow[]): KitchenMapDietary[] {
  return rows.map((r) => ({
    child_id: r.child_id,
    tag: r.tag,
    enforcement: VALID_ENFORCEMENT_LEVELS.has(r.enforcement as EnforcementLevel)
      ? (r.enforcement as EnforcementLevel)
      : 'just_for_context',
    source: r.source,
  }));
}

function projectFoodPreferences(rows: RawFoodPreferenceRow[]): KitchenMapFoodPreference[] {
  return rows.map((r) => ({
    child_id: r.child_id,
    item: r.item,
    valence: r.valence,
    enforcement: VALID_ENFORCEMENT_LEVELS.has(r.enforcement as EnforcementLevel)
      ? (r.enforcement as EnforcementLevel)
      : 'soft',
    source: r.source,
  }));
}

function projectRules(rows: RawRuleRow[]): KitchenMapRule[] {
  return rows.map((r) => ({
    rule_type: r.rule_type,
    custom_label: r.custom_label,
    enforcement: VALID_ENFORCEMENT_LEVELS.has(r.enforcement as EnforcementLevel)
      ? (r.enforcement as EnforcementLevel)
      : 'strong',
    source: r.source,
  }));
}

function deriveIsComplete(
  children: KitchenMapChild[],
  culturalPriors: RawCulturalPriorRow[],
): boolean {
  // v1 heuristic: a "complete" map has at least one child row recorded.
  // Cultural priors and other signals layer on top but aren't gating —
  // a household with one kid and no ratified template is still considered
  // onboarded for planning purposes (silence-mode is the safe default).
  // The agent uses this flag to decide whether to nudge for more info.
  void culturalPriors; // kept in signature for future heuristic refinement
  return children.length > 0;
}
