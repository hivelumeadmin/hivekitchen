import type {
  KitchenMap,
  KitchenMapAllergyRule,
  KitchenMapAllergyRules,
  KitchenMapCaregiver,
  KitchenMapChild,
  KitchenMapCultural,
  KitchenMapCulturalPrior,
  KitchenMapCulturalPriorState,
  KitchenMapFavouriteRecipe,
  KitchenMapMemoryNode,
  KitchenMapMemoryNodeType,
  KitchenMapRecipes,
} from '@hivekitchen/types';
import type {
  RawAllergyRuleRow,
  RawCaregiverRow,
  RawChildRow,
  RawCulturalPriorRow,
  RawFavouriteRecipeRow,
  RawKitchenMapData,
  RawMemoryNodeRow,
  RawSchoolPolicyRow,
} from './kitchen-map.repository.js';

const SCHEMA_VERSION = '1.0.0' as const;

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

const VALID_MEMORY_NODE_TYPES = new Set<KitchenMapMemoryNodeType>([
  'preference',
  'rhythm',
  'cultural_rhythm',
  'allergy',
  'child_obsession',
  'school_policy',
  'other',
]);

/**
 * Slice A0.5 — pure function: raw source rows → KitchenMap projection.
 *
 * The composer makes the bucketing / filtering / shape-mapping decisions
 * that depend only on the data. Nothing in here touches the DB, Redis, or
 * the logger; that's why it's trivially unit-testable.
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
    },
    caregivers: projectCaregivers(raw.caregivers),
    children,
    cultural: projectCultural(raw.cultural_priors),
    memory: projectMemory(raw.memory_nodes),
    allergy_rules: projectAllergyRules(raw.allergy_rules),
    household_extras: {
      library: raw.extra_library.map((e) => ({
        id: e.id,
        name: e.name,
        component_type: e.component_type,
      })),
    },
    recipes: projectRecipes(raw.recipe_usage),
    meta: {
      composed_at: new Date().toISOString(),
      map_version: raw.household.kitchen_map_version,
      schema_version: SCHEMA_VERSION,
      is_complete: deriveIsComplete(children, raw.cultural_priors),
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
  return {
    id: row.id,
    name: row.name,
    age_band: row.age_band,
    declared_allergens: row.declared_allergens,
    cultural_identifiers: row.cultural_identifiers,
    dietary_preferences: row.dietary_preferences,
    bag_composition: {
      // children.bag_composition has a CHECK constraint guaranteeing main=true;
      // contract's BagCompositionSchema narrows to z.literal(true).
      main: true,
      snack: row.bag_composition.snack,
      extra: row.bag_composition.extra,
    },
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

    const projected: KitchenMapCulturalPrior = {
      key: r.key,
      label: r.label,
      state,
      tier: r.tier,
      confidence: r.confidence,
      presence: r.presence,
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

function projectAllergyRules(rows: RawAllergyRuleRow[]): KitchenMapAllergyRules {
  const falcpa: KitchenMapAllergyRule[] = [];
  const household_declared: KitchenMapAllergyRule[] = [];

  for (const r of rows) {
    const projected: KitchenMapAllergyRule = {
      allergen: r.allergen,
      rule_type: r.rule_type,
      scope_child_id: r.child_id,
    };

    if (r.household_id === null && r.rule_type === 'falcpa') {
      falcpa.push(projected);
    } else if (r.household_id !== null) {
      household_declared.push(projected);
    }
    // Mixed/invalid combinations (household_id NULL but rule_type
    // parent_declared, or vice-versa) are dropped — should be impossible
    // given how rows are inserted, but we don't trust unknown data.
  }

  return { falcpa, household_declared };
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
