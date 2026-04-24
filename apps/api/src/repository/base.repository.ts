import type { SupabaseClient } from '@supabase/supabase-js';

export class BaseRepository {
  constructor(protected readonly client: SupabaseClient) {}
}
