import type { PlanItemForGuardrail } from '@hivekitchen/types';

// Slice 2.6-s3 — shared helper extracted from 2.6-s2's
// curated-baseline.service.ts so Stage 0 (CuratedBaselineMaterializationService)
// and Stage 1 (CatalogSeedService) feed the AllergyRulesEngine the same way.
//
// PlanItemForGuardrail is the engine's input shape. For catalog seeding we
// feed canonical_name as the SOLE ingredient string — the engine's substring +
// synonym match against FALCPA categories runs against the recipe name.
//
// child_id is required to be a UUID by the schema. At Stage 0 / Stage 1 time
// the relevant rules carry child_id=null (FALCPA + household-wide allergens)
// and apply to any child UUID. Passing householdId satisfies the UUID
// constraint without inventing data; the engine never dereferences this as a
// real child id.

export interface CatalogItemForGuardrail {
  readonly canonical_name: string;
  readonly applicable_slots: ReadonlyArray<'main' | 'snack' | 'extra'>;
}

export function catalogItemToPlanItem(
  item: CatalogItemForGuardrail,
  householdId: string,
): PlanItemForGuardrail {
  const slot = item.applicable_slots[0] ?? 'main';
  return {
    child_id: householdId,
    day: 'catalog',
    slot,
    ingredients: [item.canonical_name.slice(0, 200)],
  };
}
