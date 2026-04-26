import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import type { UserProfile, UpdateProfileRequest } from '@hivekitchen/types';
import { ConflictError, UnauthorizedError, ValidationError } from '../../common/errors.js';
import type { UserRepository, UserProfileRow, UpdateUserProfileInput } from './user.repository.js';

export interface UpdateMyProfileResult {
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
  };
}

function extractAuthProviders(user: SupabaseUser): string[] {
  // Service-role-created accounts (test envs) may have null identities.
  return (user.identities ?? []).map((i) => i.provider);
}

function isEmailExistsError(error: { code?: string }): boolean {
  return error.code === 'email_exists';
}
