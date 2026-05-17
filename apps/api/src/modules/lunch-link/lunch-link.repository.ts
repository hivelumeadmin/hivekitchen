import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';

// Slice 4-S2 — minimal repository for the dev-only Lunch Link surface.
// Avoids depending on ChildrenRepository (which requires a kek + RepositoryLogger
// for envelope-decryption of allergens/cultural_identifiers). The surface only
// needs the plaintext `name` column, so decryption machinery is unnecessary.
export class LunchLinkRepository extends BaseRepository {
  constructor(client: SupabaseClient) {
    super(client);
  }

  async findChildName(childId: string, householdId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('children')
      .select('id, name')
      .eq('id', childId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string; name: string } | null)?.name ?? null;
  }
}
