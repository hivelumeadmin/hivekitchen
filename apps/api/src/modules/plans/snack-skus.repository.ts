import type { SnackSku } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

const SKU_COLUMNS =
  'id, name, brand, category, contains_peanut, contains_tree_nut, contains_dairy, contains_egg, contains_wheat, contains_soy, contains_fish, contains_shellfish, contains_sesame, is_halal, is_kosher, is_vegetarian, is_vegan, is_active';

export class SnackSkusRepository extends BaseRepository {
  // Catalog lookup for the planner agent. Returns only active SKUs by
  // default — retired catalog entries stay in the table for audit but are
  // never offered as new candidates. category filter is optional and case-
  // sensitive (the table column stores normalized lowercase).
  async findActive(opts?: { category?: string }): Promise<SnackSku[]> {
    let query = this.client
      .from('snack_skus')
      .select(SKU_COLUMNS)
      .eq('is_active', true);
    if (opts?.category !== undefined) {
      query = query.eq('category', opts.category);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as SnackSku[];
  }

  // Single-row lookup. Returns null for unknown ids so the caller can
  // distinguish "SKU exists but not in this row" from "SKU vanished from
  // the catalog" — the latter is conservative for the guardrail.
  async findById(id: string): Promise<SnackSku | null> {
    const { data, error } = await this.client
      .from('snack_skus')
      .select(SKU_COLUMNS)
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data as SnackSku | null) ?? null;
  }
}
