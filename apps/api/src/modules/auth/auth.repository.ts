import { BaseRepository } from '../../repository/base.repository.js';

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  current_household_id: string | null;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

export interface CreateHouseholdAndUserInput {
  user_id: string;
  email: string;
  display_name: string | null;
}

export interface InsertRefreshTokenInput {
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
}

export class AuthRepository extends BaseRepository {
  async findUserByAuthId(userId: string): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('id, email, display_name, current_household_id, role')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return (data as UserRow | null) ?? null;
  }

  async createHouseholdAndUser(input: CreateHouseholdAndUserInput): Promise<UserRow> {
    // Single atomic transaction via Postgres function (migration 20260501120000 defines it).
    // PostgREST commits per request, so two separate .insert() calls would cross transaction
    // boundaries and the deferrable FK could not help.
    const { data, error } = await this.client.rpc('create_household_and_user', {
      p_user_id: input.user_id,
      p_email: input.email,
      p_display_name: input.display_name,
    });
    if (error) throw error;
    const row = (data as UserRow[] | null)?.[0];
    if (!row) throw new Error('create_household_and_user returned no row');
    return row;
  }

  async insertRefreshToken(input: InsertRefreshTokenInput): Promise<{ id: string }> {
    const { data, error } = await this.client
      .from('refresh_tokens')
      .insert({
        user_id: input.user_id,
        family_id: input.family_id,
        token_hash: input.token_hash,
        expires_at: input.expires_at.toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: (data as { id: string }).id };
  }

  async markRefreshTokenRevoked(token_hash: string): Promise<void> {
    const { error } = await this.client
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', token_hash)
      .is('revoked_at', null);
    if (error) throw error;
  }
}
