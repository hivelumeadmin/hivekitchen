import { BaseRepository } from '../../repository/base.repository.js';

export interface UserProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  preferred_language: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
  notification_prefs: { weekly_plan_ready?: boolean; grocery_list_ready?: boolean };
  cultural_language: string;
  parental_notice_acknowledged_at: string | null;
  parental_notice_acknowledged_version: string | null;
}

// parental_notice_acknowledged_at / _version are intentionally excluded —
// write path is the ack_parental_notice RPC in compliance.service.ts only.
export type UpdateUserProfileInput = Partial<{
  display_name: string | null;
  email: string;
  preferred_language: string;
  notification_prefs: { weekly_plan_ready?: boolean; grocery_list_ready?: boolean };
  cultural_language: string;
}>;

const PROFILE_COLUMNS =
  'id, email, display_name, preferred_language, role, notification_prefs, cultural_language, parental_notice_acknowledged_at, parental_notice_acknowledged_version';

export class UserRepository extends BaseRepository {
  async findUserById(id: string): Promise<UserProfileRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as UserProfileRow | null) ?? null;
  }

  // 2-S19: childen-count probe for the is_onboarded derivation on /me.
  // Mirrors AuthRepository.getIsOnboarded's children query; kept separate so
  // each module owns its own data access path.
  async hasChildren(household_id: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('children')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', household_id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  // 2-S26: in-progress probe for is_onboarding_in_progress on /me. True when
  // an active onboarding thread exists for the household AND it does not yet
  // carry a summary system_event turn. Modality-agnostic — the resume flow
  // spans text and voice. Mirrors AuthRepository.getOnboardingProgress's
  // in-progress branch; kept separate so the user module owns its own reads.
  async hasActiveOnboardingThread(household_id: string): Promise<boolean> {
    const { data: threadRows, error: threadError } = await this.client
      .from('threads')
      .select('id')
      .eq('household_id', household_id)
      .eq('type', 'onboarding')
      .eq('status', 'active')
      .limit(1);
    if (threadError) throw threadError;
    const threadId = (threadRows as { id: string }[] | null)?.[0]?.id;
    if (!threadId) return false;

    const { count: summaryCount, error: summaryError } = await this.client
      .from('thread_turns')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('role', 'system')
      .filter('body->>type', 'eq', 'system_event')
      .filter('body->>event', 'eq', 'onboarding.summary');
    if (summaryError) throw summaryError;
    return (summaryCount ?? 0) === 0;
  }

  async updateUserProfile(id: string, input: UpdateUserProfileInput): Promise<UserProfileRow> {
    const { data, error } = await this.client
      .from('users')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw error;
    return data as UserProfileRow;
  }
}
