import type { SupabaseClient } from '@supabase/supabase-js';

// Story 3-DM-B2 — structured household-level cultural identifier table.
// Replaces the encrypted `households.cultural_identifiers` JSONB column.
// Closed-vocab (validated against cultural_tags) → no encryption, no hash.

export type EnforcementLevel =
  | 'non_negotiable'
  | 'strong'
  | 'default'
  | 'soft'
  | 'just_for_context';

export interface HouseholdCulturalIdentifierRow {
  household_id: string;
  cultural_tag: string;
  enforcement: EnforcementLevel;
  source: string;
}

export class HouseholdCulturalIdentifiersRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByHouseholdId(householdId: string): Promise<HouseholdCulturalIdentifierRow[]> {
    const { data, error } = await this.client
      .from('household_cultural_identifiers')
      .select('household_id, cultural_tag, enforcement, source')
      .eq('household_id', householdId);
    if (error) throw error;
    return (data ?? []) as HouseholdCulturalIdentifierRow[];
  }

  async listTags(householdId: string): Promise<string[]> {
    const rows = await this.findByHouseholdId(householdId);
    return rows.map((r) => r.cultural_tag);
  }

  /**
   * Idempotent declare. The composite PK (household_id, cultural_tag) makes
   * the upsert a no-op when the row already exists.
   */
  async declareIfNew(params: {
    household_id: string;
    cultural_tag: string;
    enforcement?: EnforcementLevel;
    source: string;
  }): Promise<{ inserted: boolean }> {
    const { data, error } = await this.client
      .from('household_cultural_identifiers')
      .upsert(
        {
          household_id: params.household_id,
          cultural_tag: params.cultural_tag,
          enforcement: params.enforcement ?? 'default',
          source: params.source,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'household_id,cultural_tag',
          ignoreDuplicates: true,
        },
      )
      .select('household_id')
      .maybeSingle();
    if (error !== null && error !== undefined) {
      throw new Error(`household_cultural_identifiers.declareIfNew: ${error.message}`);
    }
    return { inserted: data !== null };
  }

  /**
   * Replace semantics for a household's cultural tag set. Used when the
   * onboarding flow re-emits the full list (parent edits a previously-
   * declared identity). Inserts new tags, leaves existing tags untouched.
   * Does NOT delete tags that disappear from the set — that's an explicit
   * parent action (out of scope for this repository).
   */
  async upsertSet(params: {
    household_id: string;
    tags: readonly string[];
    source: string;
  }): Promise<void> {
    if (params.tags.length === 0) return;
    const rows = params.tags.map((tag) => ({
      household_id: params.household_id,
      cultural_tag: tag,
      enforcement: 'default' as const,
      source: params.source,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await this.client
      .from('household_cultural_identifiers')
      .upsert(rows, {
        onConflict: 'household_id,cultural_tag',
        ignoreDuplicates: true,
      });
    if (error) {
      throw new Error(`household_cultural_identifiers.upsertSet: ${error.message}`);
    }
  }
}
