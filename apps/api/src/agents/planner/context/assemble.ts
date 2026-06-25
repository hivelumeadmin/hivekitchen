import type {
  CulturalObservance,
  CulturalTemplateKey,
} from '../../../services/cultural-calendar.service.js';
import type { ChildSignalOutput, KitchenMap } from '@hivekitchen/types';

// Story 3.18 — cultural context the planner agent receives alongside household
// + week metadata. Empty arrays = silence-mode household → no cultural lines
// injected → planner uses neutral defaults.
export interface PlannerCulturalContext {
  observances: readonly CulturalObservance[];
  l0Preferences: readonly string[];
  l1MethodPriors: readonly string[];
  culturalObligations: readonly string[];
  culturalTemplates: readonly CulturalTemplateKey[];
}

// Story 3.20 — per-child bag-slot configuration (snack/extra on/off). Main is
// always on, so it's not part of the shape. The planner uses this to decide
// which slots to fill for each child; an inactive slot must produce no
// plan_slots entry, not an entry with empty ingredients.
export interface PlannerBagComposition {
  child_id: string;
  child_name: string;
  snack: boolean;
  extra: boolean;
}

// Story 3.21 — per-child Extra slot pin/ban rules + the household's
// custom Extra library. Empty arrays = no preference; the planner falls
// back to its general "interesting Extra" composition logic.
export interface PlannerExtraRules {
  child_id: string;
  child_name: string;
  pins: readonly string[];
  bans: readonly string[];
}

export interface PlannerExtraLibraryItem {
  id: string;
  name: string;
  component_type: string;
  is_allergen_free: boolean;
}

// Story 3.22 — children whose Extra slot is OFF but who have a high-activity
// plan_day_context (sport_practice / field_trip) on the upcoming week. The
// planner is instructed to propose one Extra item for those specific days;
// full parent-confirmation UX is deferred to a follow-up story.
export interface PlannerExtraProposal {
  child_id: string;
  child_name: string;
  override_date: string;
  context_type: 'sport_practice' | 'field_trip';
}

// Story 3.27 / 4-S11 — children eligible for a variant proposal. Eligibility is
// now derived from REAL rating engagement: >= 3 distinct child_preferences
// signal dates in the past 30 days (see loadVariantEligibleChildrenForHousehold
// + ChildPreferencesRepository.getVariantEligibleChildIds). The earlier
// manually-flipped children.variant_eligible MVP stub is retired. The planner
// may include AT MOST ONE variant_proposal in the plan output for these
// children — see PlanVariantProposalOutputSchema.
export interface PlannerVariantEligibleChild {
  child_id: string;
  child_name: string;
}

// Story 3-S36 — pre-loaded pantry snapshot. The job assembles the on-hand
// ingredient names so the planner favours them without spending a pantry.read
// turn. Empty on_hand → no <pantry> block (treat as "no data", never a
// constraint). Pantry service isn't live until Epic 6, so this is empty today
// and the wiring is forward-compatible.
export interface PlannerPantrySnapshot {
  on_hand: readonly string[];
}

// Story 3-S36 — one entry in the pre-assembled candidate recipe slate. Carries
// enough inline (allergen flags + key ingredients) for the planner to judge fit
// WITHOUT a recipe.fetch turn. `name` is the canonical_name the planner passes
// as recipe_id (server resolves name → catalog id, existing convention).
export interface PlannerRecipeCandidate {
  id: string;
  name: string;
  cuisine_tags: readonly string[];
  allergen_flags: readonly string[];
  key_ingredients: readonly string[];
  confidence: number;
}

// Story 3-S36 — the candidate slate grouped by slot suitability. A recipe whose
// applicable_slots include a kind appears in that group. Empty groups render as
// `kind: []`; an entirely empty slate renders no <recipe_candidates> block.
export interface PlannerRecipeCandidateSlate {
  main: readonly PlannerRecipeCandidate[];
  snack: readonly PlannerRecipeCandidate[];
  extra: readonly PlannerRecipeCandidate[];
}

// Story 3.5-s4 — the render-relevant subset of PlanWeekOptions, bundled into a
// single typed context so the render functions take one argument instead of a
// growing positional list. assemblePlannerContext() picks these fields from a
// PlanWeekOptions-shaped argument (structurally typed — no PlanWeekOptions
// import, which would create a circular dependency with orchestrator.ts).
export interface PlannerContext {
  kitchenMap: KitchenMap | undefined;
  culturalContext: PlannerCulturalContext | undefined;
  bagCompositions: readonly PlannerBagComposition[] | undefined;
  extraRules: readonly PlannerExtraRules[] | undefined;
  extraLibraryItems: readonly PlannerExtraLibraryItem[] | undefined;
  extraProposals: readonly PlannerExtraProposal[] | undefined;
  sovereigntyMode: 'unified' | 'alternating' | undefined;
  variantEligibleChildren: readonly PlannerVariantEligibleChild[] | undefined;
  childSignals: ChildSignalOutput | undefined;
  pantrySnapshot: PlannerPantrySnapshot | undefined;
  recipeCandidates: PlannerRecipeCandidateSlate | undefined;
}

export function assemblePlannerContext(opts: {
  kitchenMap?: KitchenMap;
  culturalContext?: PlannerCulturalContext;
  bagCompositions?: readonly PlannerBagComposition[];
  extraRules?: readonly PlannerExtraRules[];
  extraLibraryItems?: readonly PlannerExtraLibraryItem[];
  extraProposals?: readonly PlannerExtraProposal[];
  sovereigntyMode?: 'unified' | 'alternating';
  variantEligibleChildren?: readonly PlannerVariantEligibleChild[];
  childSignals?: ChildSignalOutput;
  pantrySnapshot?: PlannerPantrySnapshot;
  recipeCandidates?: PlannerRecipeCandidateSlate;
}): PlannerContext {
  return {
    kitchenMap: opts.kitchenMap,
    culturalContext: opts.culturalContext,
    bagCompositions: opts.bagCompositions,
    extraRules: opts.extraRules,
    extraLibraryItems: opts.extraLibraryItems,
    extraProposals: opts.extraProposals,
    sovereigntyMode: opts.sovereigntyMode,
    variantEligibleChildren: opts.variantEligibleChildren,
    childSignals: opts.childSignals,
    pantrySnapshot: opts.pantrySnapshot,
    recipeCandidates: opts.recipeCandidates,
  };
}
