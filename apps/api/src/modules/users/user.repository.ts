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
