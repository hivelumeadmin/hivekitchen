import { BaseRepository } from '../../repository/base.repository.js';
import { LinkExpiredError } from '../../common/errors.js';

export type InviteRole = 'secondary_caregiver' | 'guest_author';

export interface InviteRow {
  id: string;
  household_id: string;
  role: InviteRole;
  invited_by_user_id: string;
  invited_email: string | null;
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
}

export interface InsertInviteInput {
  household_id: string;
  role: InviteRole;
  invited_by_user_id: string;
  invited_email: string | null;
  expires_at: Date;
}

const INVITE_COLUMNS =
  'id, household_id, role, invited_by_user_id, invited_email, expires_at, redeemed_at, revoked_at';

export class InviteRepository extends BaseRepository {
  async insertInvite(input: InsertInviteInput): Promise<InviteRow> {
    const { data, error } = await this.client
      .from('invites')
      .insert({
        household_id: input.household_id,
        role: input.role,
        invited_by_user_id: input.invited_by_user_id,
        invited_email: input.invited_email,
        expires_at: input.expires_at.toISOString(),
      })
      .select(INVITE_COLUMNS)
      .single();
    if (error) throw error;
    return data as InviteRow;
  }

  async findInviteById(id: string): Promise<InviteRow | null> {
    const { data, error } = await this.client
      .from('invites')
      .select(INVITE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as InviteRow | null) ?? null;
  }

  async markRedeemed(id: string): Promise<void> {
    // Race-safe: only the first concurrent redemption wins; subsequent calls get an
    // empty data array and we throw LinkExpiredError. Mirrors consumeRefreshToken.
    const { data, error } = await this.client
      .from('invites')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('id', id)
      .is('redeemed_at', null)
      .is('revoked_at', null)
      .select('id');
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) {
      throw new LinkExpiredError('Invite already redeemed');
    }
  }
}
