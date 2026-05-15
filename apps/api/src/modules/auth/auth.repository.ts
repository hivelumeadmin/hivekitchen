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

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  replaced_by: string | null;
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

  async markRefreshTokenRevoked(token_hash: string): Promise<{ user_id: string | null }> {
    const { data, error } = await this.client
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', token_hash)
      .is('revoked_at', null)
      .select('user_id')
      .maybeSingle();
    if (error) throw error;
    return { user_id: (data as { user_id: string } | null)?.user_id ?? null };
  }

  async findRefreshTokenByHash(hash: string): Promise<RefreshTokenRow | null> {
    const { data, error } = await this.client
      .from('refresh_tokens')
      .select('id, user_id, family_id, replaced_by')
      .eq('token_hash', hash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    return (data as RefreshTokenRow | null) ?? null;
  }

  async consumeRefreshToken(tokenId: string, replacedBy: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('refresh_tokens')
      .update({ replaced_by: replacedBy })
      .eq('id', tokenId)
      .is('replaced_by', null)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async revokeAllByFamilyId(familyId: string): Promise<void> {
    const { error } = await this.client
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('family_id', familyId)
      .is('revoked_at', null);
    if (error) throw error;
  }

  // Slice 2-S19 — derives "onboarded" from existing data rather than a flag column.
  // True ⇔ parental notice acknowledged AND at least one child in the household.
  // Returns false on either signal absent so resumed-after-abandon flows route back
  // through /onboarding instead of dumping users at /app empty state.
  async getIsOnboarded(user_id: string, household_id: string): Promise<boolean> {
    const progress = await this.getOnboardingProgress(user_id, household_id);
    return progress === 'completed';
  }

  // Slice 2-S26 — three-state derivation: not_started (no in-progress thread),
  // in_progress (has an active onboarding thread with no summary turn yet),
  // completed (parental notice ack AND at least one child).
  // Order matters: completed is checked first because a user can technically
  // have a stale active thread that was never finalised after the summary
  // path (unlikely but possible mid-incident). The "completed" signal wins.
  async getOnboardingProgress(
    user_id: string,
    household_id: string,
  ): Promise<'not_started' | 'in_progress' | 'completed'> {
    const { data: userData, error: userError } = await this.client
      .from('users')
      .select('parental_notice_acknowledged_at')
      .eq('id', user_id)
      .maybeSingle();
    if (userError) throw userError;
    if (!userData) {
      // Anomalous: findUserByAuthId resolved this row moments ago. A null
      // response here means a concurrent delete or schema drift. Treat as
      // not_started so routing falls through to /onboarding (the safer of
      // two bad outcomes vs. dumping at /app with a broken session).
      return 'not_started';
    }
    const ackAt = (userData as { parental_notice_acknowledged_at: string | null })
      .parental_notice_acknowledged_at;

    if (ackAt) {
      const { count, error: childrenError } = await this.client
        .from('children')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', household_id);
      if (childrenError) throw childrenError;
      if ((count ?? 0) > 0) return 'completed';
    }

    // Not completed. Is there an active in-progress onboarding thread?
    // Active = status='active' AND type='onboarding'. Modality is irrelevant
    // for the in-progress signal (resumability spans text/voice).
    const { data: threadRows, error: threadError } = await this.client
      .from('threads')
      .select('id')
      .eq('household_id', household_id)
      .eq('type', 'onboarding')
      .eq('status', 'active')
      .limit(1);
    if (threadError) throw threadError;
    const threadId = (threadRows as { id: string }[] | null)?.[0]?.id;
    if (!threadId) return 'not_started';

    // An active thread that already carries a summary system_event is
    // effectively done — shouldn't surface as in_progress to the resume UI.
    // We don't read the full body, just count summary-event rows.
    const { count: summaryCount, error: summaryError } = await this.client
      .from('thread_turns')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('role', 'system')
      .filter('body->>type', 'eq', 'system_event')
      .filter('body->>event', 'eq', 'onboarding.summary');
    if (summaryError) throw summaryError;
    if ((summaryCount ?? 0) > 0) return 'completed';

    return 'in_progress';
  }
}
