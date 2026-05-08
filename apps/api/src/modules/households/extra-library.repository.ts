import type { ExtraLibraryItem } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

const LIBRARY_COLUMNS =
  'id, household_id, name, description, component_type, is_allergen_free, archived_at, created_by, created_at, updated_at';

export interface CreateExtraLibraryParams {
  householdId: string;
  name: string;
  description: string | null;
  componentType: string;
  isAllergenFree: boolean;
  createdBy: string;
}

// Story 3.21 — household-scoped library of parent-authored reusable Extra
// items. Soft-delete on archive so the planner's audit trail and any
// plan_items references continue to resolve.
export class ExtraLibraryRepository extends BaseRepository {
  async create(input: CreateExtraLibraryParams): Promise<ExtraLibraryItem> {
    const { data, error } = await this.client
      .from('extra_library')
      .insert({
        household_id: input.householdId,
        name: input.name,
        description: input.description,
        component_type: input.componentType,
        is_allergen_free: input.isAllergenFree,
        created_by: input.createdBy,
      })
      .select(LIBRARY_COLUMNS)
      .single();
    if (error) throw error;
    return data as ExtraLibraryItem;
  }

  async findByHousehold(householdId: string): Promise<ExtraLibraryItem[]> {
    const { data, error } = await this.client
      .from('extra_library')
      .select(LIBRARY_COLUMNS)
      .eq('household_id', householdId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data as ExtraLibraryItem[] | null) ?? []);
  }

  async archive(itemId: string, householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('extra_library')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('household_id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }
}
