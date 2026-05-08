import type { ChildrenRepository } from '../modules/children/children.repository.js';
import type { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import type { CulturalCalendarService } from '../services/cultural-calendar.service.js';
import type { MemoryContextService } from '../services/memory-context.service.js';
import type { ExtraRulesRepository } from '../modules/children/extra-rules.repository.js';
import type { ExtraLibraryRepository } from '../modules/households/extra-library.repository.js';
import type {
  PlannerBagComposition,
  PlannerCulturalContext,
  PlannerExtraLibraryItem,
  PlannerExtraRules,
} from '../agents/orchestrator.js';

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
  const culturalTemplates = await culturalPriorRepository.findOptInTemplateKeys(householdId);
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
