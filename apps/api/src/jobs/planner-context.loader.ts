import type { ChildSignalOutput } from '@hivekitchen/types';
import type { ChildrenRepository } from '../modules/children/children.repository.js';
import type { ChildPreferencesRepository } from '../modules/child-preferences/child-preferences.repository.js';
import type { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import type { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import type { MemoryContextService } from '../services/memory-context.service.js';
import type { ExtraRulesRepository } from '../modules/children/extra-rules.repository.js';
import type { ExtraLibraryRepository } from '../modules/households/extra-library.repository.js';
import type { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js';
import type {
  CandidateSlateRow,
  RecipesRepository,
} from '../modules/recipe/recipes.repository.js';
import type { PantryService } from '../modules/pantry/pantry.service.js';
import type {
  PlannerBagComposition,
  PlannerCulturalContext,
  PlannerExtraLibraryItem,
  PlannerExtraProposal,
  PlannerExtraRules,
  PlannerPantrySnapshot,
  PlannerRecipeCandidate,
  PlannerRecipeCandidateSlate,
  PlannerVariantEligibleChild,
} from '../agents/orchestrator.js';
import type { CulturalTemplateKey } from '../services/cultural-calendar.service.js';

// Story 3.27 / 4-S11 — variant-eligible children, now derived from REAL rating
// engagement rather than the manually-flipped children.variant_eligible MVP
// stub: a child qualifies with >= 3 distinct signal_dates in child_preferences
// within the past 30 days (i.e. the family has used the rating feature
// meaningfully). The threshold is conservative; lower to 2 if too few families
// qualify — it is a single constant here.
const VARIANT_ELIGIBLE_MIN_SIGNAL_DATES = 3;
const VARIANT_ELIGIBLE_WINDOW_DAYS = 30;

export async function loadVariantEligibleChildrenForHousehold(
  householdId: string,
  childPreferencesRepository: ChildPreferencesRepository,
): Promise<PlannerVariantEligibleChild[]> {
  const sinceDate = new Date(Date.now() - VARIANT_ELIGIBLE_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await childPreferencesRepository.getVariantEligibleChildIds(
    householdId,
    sinceDate,
    VARIANT_ELIGIBLE_MIN_SIGNAL_DATES,
  );
  return rows.map((r) => ({ child_id: r.child_id, child_name: r.child_name }));
}

export async function loadBagCompositionsForHousehold(
  householdId: string,
  childrenRepository: ChildrenRepository,
): Promise<PlannerBagComposition[]> {
  const rows = await childrenRepository.findBagCompositionsByHousehold(householdId);
  return rows.map((r) => ({
    child_id: r.child_id,
    child_name: r.name,
    snack: r.bag_composition.snack,
    extra: r.bag_composition.extra,
  }));
}

// Story 3.21 — fans out per-child extra_rules reads in parallel. Bag
// compositions already include {child_id, child_name}, so we reuse that pair
// instead of re-reading the children table.
export async function loadExtraRulesForChildren(
  bagCompositions: readonly PlannerBagComposition[],
  extraRulesRepository: ExtraRulesRepository,
): Promise<PlannerExtraRules[]> {
  if (bagCompositions.length === 0) return [];
  const rules = await Promise.all(
    bagCompositions.map(async (bc) => {
      const r = await extraRulesRepository.findExtraRules(bc.child_id);
      return {
        child_id: bc.child_id,
        child_name: bc.child_name,
        pins: r.pins,
        bans: r.bans,
      };
    }),
  );
  return rules;
}

// Story 3.22 — selects high-activity context rows (sport_practice / field_trip)
// targeting children whose Extra slot is OFF and whose override_date falls in
// the upcoming plan week. The planner uses this to propose a one-day Extra for
// those children even though their Extra is normally suppressed.
//
// weekOf is the Monday (UTC ISO date). The window is Mon..Fri inclusive — five
// calendar days (Mon=+0 through Fri=+4). Saturday is intentionally excluded;
// the product calendar is school-week scoped.
export async function loadHighActivityExtraProposalsForHousehold(
  householdId: string,
  weekOf: string,
  bagCompositions: readonly PlannerBagComposition[],
  planDayContextRepository: PlanDayContextRepository,
): Promise<PlannerExtraProposal[]> {
  const childrenWithExtraOff = new Map<string, string>();
  for (const bc of bagCompositions) {
    if (bc.extra === false) childrenWithExtraOff.set(bc.child_id, bc.child_name);
  }
  if (childrenWithExtraOff.size === 0) return [];

  const contexts = await planDayContextRepository.findActiveByHousehold(householdId);
  if (contexts.length === 0) return [];

  const weekStart = weekOf;
  const weekEnd = addDaysIso(weekOf, 4); // Mon..Fri (inclusive end)

  const proposals: PlannerExtraProposal[] = [];
  const seen = new Set<string>();
  for (const o of contexts) {
    if (o.context_type !== 'sport_practice' && o.context_type !== 'field_trip') continue;
    if (o.override_date < weekStart || o.override_date > weekEnd) continue;
    const childName = childrenWithExtraOff.get(o.child_id);
    if (childName === undefined) continue;
    const key = `${o.child_id}:${o.override_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({
      child_id: o.child_id,
      child_name: childName,
      override_date: o.override_date,
      context_type: o.context_type,
    });
  }
  return proposals;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadExtraLibraryForHousehold(
  householdId: string,
  extraLibraryRepository: ExtraLibraryRepository,
): Promise<PlannerExtraLibraryItem[]> {
  const items = await extraLibraryRepository.findByHousehold(householdId);
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    component_type: i.component_type,
    is_allergen_free: i.is_allergen_free,
  }));
}

// Story 3-S36 — pre-load the pantry snapshot for the <pantry> planner block.
// PantryService.read() throws NotImplementedError until Epic 6, so this returns
// an empty snapshot today (the planner treats absent pantry as "no data"). The
// wiring is forward-compatible: once pantry lands, the block populates with no
// job change. Any read failure is swallowed — pantry is a soft hint, never a
// reason to fail plan generation.
export async function loadPantrySnapshotForHousehold(
  householdId: string,
  pantryService: PantryService,
): Promise<PlannerPantrySnapshot> {
  try {
    const result = await pantryService.read({ household_id: householdId });
    return { on_hand: result.items.map((i) => i.name).filter((n) => n.length > 0) };
  } catch {
    return { on_hand: [] };
  }
}

// Story 3-S36 — caps for the candidate slate. Per-slot cap bounds the
// <recipe_candidates> block size; key-ingredient cap keeps each candidate line
// short (allergen-relevant head nouns are what matter for judging fit).
const CANDIDATE_SLATE_PER_SLOT_CAP = 12;
const CANDIDATE_KEY_INGREDIENTS_CAP = 6;
const SLOT_KINDS = ['main', 'snack', 'extra'] as const;
type SlotKind = (typeof SLOT_KINDS)[number];

// Story 3-S36 — pre-load + assemble the candidate recipe slate for the
// <recipe_candidates> planner block. Reads every visible (non-banned) catalog
// row, ranks by favourite → liked-signal → confidence → use_count → name, then
// groups each row into every slot kind in its applicable_slots (defaulting to
// 'main' when unset). childSignals (optional) folds the per-child "liked" bias
// into ranking so liked recipes surface near the top of their group.
export async function loadRecipeCandidatesForHousehold(
  householdId: string,
  recipesRepository: RecipesRepository,
  childSignals?: ChildSignalOutput,
): Promise<PlannerRecipeCandidateSlate> {
  const rows = await recipesRepository.findCandidateSlateForHousehold(householdId);
  return assembleRecipeCandidateSlate(rows, buildLikedNameSet(childSignals));
}

// Pure assembly — exported for unit testing the rank + group + cap logic
// independent of the repository.
export function assembleRecipeCandidateSlate(
  rows: readonly CandidateSlateRow[],
  likedNames: ReadonlySet<string>,
): PlannerRecipeCandidateSlate {
  const ranked = [...rows].sort((a, b) => compareCandidates(a, b, likedNames));
  const groups: Record<SlotKind, PlannerRecipeCandidate[]> = { main: [], snack: [], extra: [] };
  for (const row of ranked) {
    const candidate = toCandidate(row);
    const slots = row.applicable_slots.length > 0 ? row.applicable_slots : ['main'];
    for (const slot of SLOT_KINDS) {
      if (!slots.includes(slot)) continue;
      if (groups[slot].length >= CANDIDATE_SLATE_PER_SLOT_CAP) continue;
      groups[slot].push(candidate);
    }
  }
  return groups;
}

function toCandidate(row: CandidateSlateRow): PlannerRecipeCandidate {
  return {
    name: row.canonical_name,
    cuisine_tags: row.cuisine_tags,
    allergen_flags: row.allergen_flags,
    key_ingredients: row.ingredient_keys.slice(0, CANDIDATE_KEY_INGREDIENTS_CAP),
    confidence: row.confidence_score,
  };
}

function compareCandidates(
  a: CandidateSlateRow,
  b: CandidateSlateRow,
  likedNames: ReadonlySet<string>,
): number {
  const aFav = a.is_household_favorite ? 1 : 0;
  const bFav = b.is_household_favorite ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;

  const aLiked = likedNames.has(a.canonical_name.toLowerCase()) ? 1 : 0;
  const bLiked = likedNames.has(b.canonical_name.toLowerCase()) ? 1 : 0;
  if (aLiked !== bLiked) return bLiked - aLiked;

  if (a.confidence_score !== b.confidence_score) return b.confidence_score - a.confidence_score;
  if (a.use_count !== b.use_count) return b.use_count - a.use_count;
  return a.canonical_name.localeCompare(b.canonical_name);
}

function buildLikedNameSet(signals?: ChildSignalOutput): Set<string> {
  const set = new Set<string>();
  if (signals === undefined) return set;
  for (const child of signals.per_child) {
    for (const item of child.liked) set.add(item.recipe_name.toLowerCase());
  }
  for (const fam of signals.family_liked) set.add(fam.recipe_name.toLowerCase());
  return set;
}

export async function loadCulturalContextForHousehold(
  householdId: string,
  weekOf: string,
  culturalPriorRepository: CulturalPriorRepository,
  culturalCalendarService: CulturalCalendarService,
  memoryContextService: MemoryContextService,
): Promise<PlannerCulturalContext> {
  // Slice 2.5-s7 — findOptInTemplateKeys returns string[] now (cultural_priors.key
  // CHECK was dropped to make room for cuisine rows). Only ratified cultural
  // template keys reach state='opt_in_confirmed', so the cast is safe.
  const culturalTemplates = (await culturalPriorRepository.findOptInTemplateKeys(
    householdId,
  )) as CulturalTemplateKey[];
  const [observances, memoryContext] = await Promise.all([
    culturalCalendarService.getUpcomingObservances({ weekOf, culturalTemplates }),
    memoryContextService.getContextForPlanning(householdId),
  ]);
  return {
    observances,
    l0Preferences: memoryContext.l0Preferences,
    l1MethodPriors: memoryContext.l1MethodPriors,
    culturalObligations: memoryContext.culturalObligations,
    culturalTemplates,
  };
}
