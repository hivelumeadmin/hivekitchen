import type { ChildrenRepository } from '../modules/children/children.repository.js';
import type { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import type { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import type { MemoryContextService } from '../services/memory-context.service.js';
import type { ExtraRulesRepository } from '../modules/children/extra-rules.repository.js';
import type { ExtraLibraryRepository } from '../modules/households/extra-library.repository.js';
import type { DayOverridesRepository } from '../modules/plans/day-overrides.repository.js';
import type {
  PlannerBagComposition,
  PlannerCulturalContext,
  PlannerExtraLibraryItem,
  PlannerExtraProposal,
  PlannerExtraRules,
} from '../agents/orchestrator.js';
import type { CulturalTemplateKey } from '../services/cultural-calendar.service.js';

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

// Story 3.22 — selects high-activity overrides (sport_practice / field_trip)
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
  dayOverridesRepository: DayOverridesRepository,
): Promise<PlannerExtraProposal[]> {
  const childrenWithExtraOff = new Map<string, string>();
  for (const bc of bagCompositions) {
    if (bc.extra === false) childrenWithExtraOff.set(bc.child_id, bc.child_name);
  }
  if (childrenWithExtraOff.size === 0) return [];

  const overrides = await dayOverridesRepository.findActiveByHousehold(householdId);
  if (overrides.length === 0) return [];

  const weekStart = weekOf;
  const weekEnd = addDaysIso(weekOf, 4); // Mon..Fri (inclusive end)

  const proposals: PlannerExtraProposal[] = [];
  const seen = new Set<string>();
  for (const o of overrides) {
    if (o.override_type !== 'sport_practice' && o.override_type !== 'field_trip') continue;
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
      override_type: o.override_type,
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
