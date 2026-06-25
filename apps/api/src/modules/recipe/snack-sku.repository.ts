import { BaseRepository } from '../../repository/base.repository.js';

// Story 3-S40 — snack SKU catalog row (global + household-scoped).
export interface SnackSkuRow {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  // FALCPA-9 allergen tags (CHECK-pinned vocabulary) + dietary/cultural tags.
  // Replaced the 13 boolean columns in 20261031000000. allergen_tags stays
  // deterministically checkable for 3-s43 Phase-2 fail-closed safety.
  allergen_tags: string[];
  dietary_tags: string[];
  is_active: boolean;
  // Reversible pause flag — true = in the rotation, false = temporarily out of
  // stock (still on the shelf). Distinct from is_active/archived_at (removal).
  in_stock: boolean;
  created_by_household_id: string | null;
  // Story 3-S41 — soft-delete (NULL = active) + creation timestamp for the shelf.
  archived_at: string | null;
  created_at: string;
  // Story 3-S44 — optional product metadata (NULL = not specified).
  upc_code: string | null;
  package_type: string | null;
}

const SNACK_SKU_COLUMNS =
  'id, name, brand, category, allergen_tags, dietary_tags, ' +
  'is_active, in_stock, created_by_household_id, ' +
  'archived_at, created_at, upc_code, package_type';

// Story 3-S41 — household-scoped snack add. FALCPA contains_* flags default to
// false at the DB level (conservative-unknown, Phase-1 doctrine); Phase-2
// (3-s43) adds the ticks and flips them into deterministic checking.
export interface CreateSnackSkuParams {
  householdId: string;
  name: string;
  brand: string | null;
  category: string;
  // Story 3-S43 — FALCPA-9 allergen tags. Omitted/undefined → the column
  // falls back to its DB default ('{}'); supplied → deterministic Phase-2 checking.
  allergen_tags?: string[];
  // Story 3-S44 — optional product metadata. Omitted/undefined → Supabase
  // leaves the column at its NULL default.
  upc_code?: string | null;
  package_type?: string | null;
}

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

  // Story 3-S43 — batch-read allergen_tags for the commit-time guardrail
  // (plans.service.ts buildCommitGuardrailInputs). A single IN query keeps the
  // per-slot inner loop a pure Map lookup (no N+1). Empty ids → no query.
  async findAllergenTagsByIds(ids: string[]): Promise<Map<string, string[]>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.client
      .from('snack_skus')
      .select('id, allergen_tags')
      .in('id', ids);
    if (error) throw error;
    return new Map(
      ((data ?? []) as Array<{ id: string; allergen_tags: string[] }>).map((r) => [
        r.id,
        r.allergen_tags,
      ]),
    );
  }

  // Story 3-S41 — add a household-scoped snack. is_active and the FALCPA
  // contains_* flags fall back to their DB defaults (true / false). The new
  // row enters the rotation automatically via findActiveForHousehold.
  async create(input: CreateSnackSkuParams): Promise<SnackSkuRow> {
    const { data, error } = await this.client
      .from('snack_skus')
      .insert({
        name: input.name,
        brand: input.brand,
        category: input.category,
        created_by_household_id: input.householdId,
        // Story 3-S43 — only written when supplied; otherwise the column falls
        // back to its DB default '{}'.
        ...(input.allergen_tags ? { allergen_tags: input.allergen_tags } : {}),
        // Story 3-S44 — only written when supplied; otherwise the column falls
        // back to its NULL default.
        ...(input.upc_code != null ? { upc_code: input.upc_code } : {}),
        ...(input.package_type != null ? { package_type: input.package_type } : {}),
      })
      .select(SNACK_SKU_COLUMNS)
      .single();
    if (error) throw error;
    return data as unknown as SnackSkuRow;
  }

  // Story 3-S41 — soft-delete a household-owned snack. Scoped to
  // created_by_household_id so a global seed (NULL) or another household's row
  // matches nothing → returns false (→ 404 in the route). Sets both is_active
  // (so the rotation filter excludes it) and archived_at (so a family removal
  // is distinguishable from a future Phase-2 system disable).
  async archive(skuId: string, householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('snack_skus')
      .update({ is_active: false, archived_at: new Date().toISOString() })
      .eq('id', skuId)
      .eq('created_by_household_id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  // Toggle the reversible in-stock / pause flag. Scoped to created_by_household_id
  // (like archive): a global seed or another household's row matches nothing →
  // returns null (→ 404 in the route). Returns the updated row on success.
  async setInStock(
    skuId: string,
    householdId: string,
    inStock: boolean,
  ): Promise<SnackSkuRow | null> {
    const { data, error } = await this.client
      .from('snack_skus')
      .update({ in_stock: inStock })
      .eq('id', skuId)
      .eq('created_by_household_id', householdId)
      .select(SNACK_SKU_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as SnackSkuRow | null) ?? null;
  }
}
