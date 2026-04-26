import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import type {
  UserProfile,
  UpdateProfileRequest,
  UpdateNotificationPrefsRequest,
  UpdateCulturalPreferenceRequest,
} from '@hivekitchen/types';
import { ConflictError, UnauthorizedError, ValidationError } from '../../common/errors.js';
import type { UserRepository, UserProfileRow, UpdateUserProfileInput } from './user.repository.js';
import { CulturalLanguageSchema } from '@hivekitchen/contracts';

export interface UpdateMyProfileResult {
  profile: UserProfile;
  fieldsChanged: string[];
}

export interface UpdateMyPreferencesResult {
  profile: UserProfile;
  fieldsChanged: string[];
}

export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly supabase: SupabaseClient,
  ) {}

  async getMyProfile(userId: string): Promise<UserProfile> {
    const row = await this.repository.findUserById(userId);
    if (!row) throw new UnauthorizedError('User not found');
    const auth_providers = await this.fetchAuthProviders(userId);
    return toUserProfile(row, auth_providers);
  }

  async updateMyProfile(
    userId: string,
    input: UpdateProfileRequest,
  ): Promise<UpdateMyProfileResult> {
    const fieldsProvided = (Object.keys(input) as Array<keyof UpdateProfileRequest>).filter(
      (k) => input[k] !== undefined,
    );
    if (fieldsProvided.length === 0) {
      throw new ValidationError('At least one field must be provided');
    }

    // Fetch current row: needed for (a) accurate fieldsChanged audit, (b) email rollback on DB failure
    const currentRow = await this.repository.findUserById(userId);
    if (!currentRow) throw new UnauthorizedError('User not found');

    const emailChanging = input.email !== undefined && input.email !== currentRow.email;
    if (emailChanging) {
      await this.updateAuthEmail(userId, input.email!);
    }

    const dbInput: UpdateUserProfileInput = {};
    if (input.display_name !== undefined) dbInput.display_name = input.display_name;
    if (input.email !== undefined) dbInput.email = input.email;
    if (input.preferred_language !== undefined) dbInput.preferred_language = input.preferred_language;

    let row: UserProfileRow;
    try {
      row = await this.repository.updateUserProfile(userId, dbInput);
    } catch (dbError) {
      // Compensate: restore old email in Supabase Auth if DB write failed after auth update succeeded
      if (emailChanging) {
        try {
          await this.supabase.auth.admin.updateUserById(userId, { email: currentRow.email });
        } catch {
          // Best-effort rollback — original DB error is what the caller receives
        }
      }
      throw dbError;
    }

    // Compute fields that actually changed in value (for audit accuracy)
    const fieldsChanged: string[] = [];
    if (input.display_name !== undefined && input.display_name !== currentRow.display_name) {
      fieldsChanged.push('display_name');
    }
    if (emailChanging) {
      fieldsChanged.push('email');
    }
    if (input.preferred_language !== undefined && input.preferred_language !== currentRow.preferred_language) {
      fieldsChanged.push('preferred_language');
    }

    const auth_providers = await this.fetchAuthProviders(userId);
    return { profile: toUserProfile(row, auth_providers), fieldsChanged };
  }

  async updateMyNotifications(
    userId: string,
    input: UpdateNotificationPrefsRequest,
  ): Promise<UserProfile> {
    const currentRow = await this.repository.findUserById(userId);
    if (!currentRow) throw new UnauthorizedError('User not found');

    // Merge over existing prefs so a single-field PATCH does not clobber the other field.
    // Defaults (true) apply only when the column has never been written for this user.
    const merged: { weekly_plan_ready: boolean; grocery_list_ready: boolean } = {
      weekly_plan_ready: currentRow.notification_prefs?.weekly_plan_ready ?? true,
      grocery_list_ready: currentRow.notification_prefs?.grocery_list_ready ?? true,
    };
    if (input.weekly_plan_ready !== undefined) merged.weekly_plan_ready = input.weekly_plan_ready;
    if (input.grocery_list_ready !== undefined) merged.grocery_list_ready = input.grocery_list_ready;

    const row = await this.repository.updateUserProfile(userId, { notification_prefs: merged });
    const auth_providers = await this.fetchAuthProviders(userId);
    return toUserProfile(row, auth_providers);
  }

  async updateMyPreferences(
    userId: string,
    input: UpdateCulturalPreferenceRequest,
  ): Promise<UpdateMyPreferencesResult> {
    const currentRow = await this.repository.findUserById(userId);
    if (!currentRow) throw new UnauthorizedError('User not found');

    // UX-DR47: family-language ratchet — once set to a non-default value, never revert to 'default'.
    // Sideways moves (e.g. south_asian → caribbean) are allowed.
    if (input.cultural_language === 'default' && currentRow.cultural_language !== 'default') {
      throw new ConflictError('Family language cannot be reversed once set');
    }

    const fieldsChanged: string[] = [];
    if (input.cultural_language !== currentRow.cultural_language) {
      fieldsChanged.push('cultural_language');
    }

    const row = await this.repository.updateUserProfile(userId, {
      cultural_language: input.cultural_language,
    });
    const auth_providers = await this.fetchAuthProviders(userId);
    return { profile: toUserProfile(row, auth_providers), fieldsChanged };
  }

  async initiatePasswordReset(email: string, webBaseUrl: string): Promise<void> {
    try {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${webBaseUrl}/auth/reset-password`,
      });
      void error; // intentionally swallowed — never reveal whether the email exists
    } catch {
      // Swallow intentionally — never reveal whether the email exists.
    }
  }

  private async updateAuthEmail(userId: string, newEmail: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.updateUserById(userId, { email: newEmail });
    if (!error) return;
    if (
      isEmailExistsError(error) ||
      (typeof error.message === 'string' && error.message.includes('already been registered'))
    ) {
      throw new ConflictError('Email already in use');
    }
    throw new Error('Unexpected authentication service error');
  }

  private async fetchAuthProviders(userId: string): Promise<string[]> {
    const { data, error } = await this.supabase.auth.admin.getUserById(userId);
    if (error || !data.user) throw new UnauthorizedError('User not found');
    return extractAuthProviders(data.user);
  }
}

function toUserProfile(row: UserProfileRow, auth_providers: string[]): UserProfile {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    preferred_language: row.preferred_language,
    role: row.role,
    auth_providers,
    notification_prefs: {
      weekly_plan_ready: row.notification_prefs?.weekly_plan_ready ?? true,
      grocery_list_ready: row.notification_prefs?.grocery_list_ready ?? true,
    },
    cultural_language: CulturalLanguageSchema.parse(row.cultural_language),
  };
}

function extractAuthProviders(user: SupabaseUser): string[] {
  // Service-role-created accounts (test envs) may have null identities.
  return (user.identities ?? []).map((i) => i.provider);
}

function isEmailExistsError(error: { code?: string }): boolean {
  return error.code === 'email_exists';
}
