import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JWT } from '@fastify/jwt';
import { UnauthorizedError } from '../../common/errors.js';
import type { AuthRepository, UserRow } from './auth.repository.js';

const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface LoginResult {
  access_token: string;
  expires_in: number;
  user: UserRow;
  is_first_login: boolean;
  refresh_token_plaintext: string;
  refresh_token_max_age_seconds: number;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly supabase: SupabaseClient,
    private readonly jwt: JWT,
  ) {}

  async loginWithPassword(input: { email: string; password: string }): Promise<LoginResult> {
    const { data, error } = await this.supabase.auth.signInWithPassword(input);
    if (error || !data.user) throw new UnauthorizedError('Invalid credentials');
    return this.completeLogin({
      auth_user_id: data.user.id,
      email: data.user.email ?? input.email,
      display_name: extractDisplayName(data.user.user_metadata),
    });
  }

  async loginWithOAuth(input: { provider: 'google' | 'apple'; code: string }): Promise<LoginResult> {
    const { data, error } = await this.supabase.auth.exchangeCodeForSession(input.code);
    if (error || !data.user) throw new UnauthorizedError('OAuth exchange failed');
    return this.completeLogin({
      auth_user_id: data.user.id,
      email: data.user.email ?? '',
      display_name: extractDisplayName(data.user.user_metadata),
    });
  }

  async logout(refresh_token_plaintext: string): Promise<void> {
    if (refresh_token_plaintext.length === 0) return;
    const hash = sha256Hex(refresh_token_plaintext);
    await this.repository.markRefreshTokenRevoked(hash);
  }

  private async completeLogin(input: {
    auth_user_id: string;
    email: string;
    display_name: string | null;
  }): Promise<LoginResult> {
    let user = await this.repository.findUserByAuthId(input.auth_user_id);
    const is_first_login = user === null;
    if (user === null) {
      user = await this.repository.createHouseholdAndUser({
        user_id: input.auth_user_id,
        email: input.email,
        display_name: input.display_name,
      });
    }

    const access_token = this.jwt.sign(
      { sub: user.id, hh: user.current_household_id, role: user.role },
      { expiresIn: `${ACCESS_TOKEN_TTL_SECONDS}s` },
    );

    const refresh_token_plaintext = randomBytes(32).toString('base64url');
    await this.repository.insertRefreshToken({
      user_id: user.id,
      family_id: randomUUID(),
      token_hash: sha256Hex(refresh_token_plaintext),
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });

    return {
      access_token,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      user,
      is_first_login,
      refresh_token_plaintext,
      refresh_token_max_age_seconds: REFRESH_TOKEN_TTL_SECONDS,
    };
  }
}

function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function extractDisplayName(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const candidate = metadata['full_name'] ?? metadata['name'];
  return typeof candidate === 'string' ? candidate : null;
}
