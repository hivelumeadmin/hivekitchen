import { BaseRepository } from '../../repository/base.repository.js';

// Story 3-S40 — snack SKU catalog row (global + household-scoped).
export interface SnackSkuRow {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  contains_peanut: boolean;
  contains_tree_nut: boolean;
  contains_dairy: boolean;
  contains_egg: boolean;
  contains_wheat: boolean;
  contains_soy: boolean;
  contains_fish: boolean;
  contains_shellfish: boolean;
  contains_sesame: boolean;
  is_halal: boolean;
  is_kosher: boolean;
  is_vegetarian: boolean;
  is_vegan: boolean;
  is_active: boolean;
  created_by_household_id: string | null;
}

const SNACK_SKU_COLUMNS =
  'id, name, brand, category, ' +
  'contains_peanut, contains_tree_nut, contains_dairy, contains_egg, contains_wheat, ' +
  'contains_soy, contains_fish, contains_shellfish, contains_sesame, ' +
  'is_halal, is_kosher, is_vegetarian, is_vegan, is_active, created_by_household_id';

export class SnackSkuRepository extends BaseRepository {
  // Returns all active SKUs visible to a household: global rows (NULL household)
  // plus the household's own rows (3-s41 adds these; no-op until then).
  async findActiveForHousehold(householdId: string): Promise<SnackSkuRow[]> {
    const { data, error } = await this.client
      .from('snack_skus')
      .select(SNACK_SKU_COLUMNS)
      .eq('is_active', true)
      .or(`created_by_household_id.is.null,created_by_household_id.eq.${householdId}`);
    if (error) throw error;
    return (data ?? []) as unknown as SnackSkuRow[];
  }

  // Batch-read names for display (brief-state.composer.ts tile name resolution).
  async findNamesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.client
      .from('snack_skus')
      .select('id, name')
      .in('id', [...ids]);
    if (error) throw error;
    return new Map(
      ((data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
    );
  }
}
