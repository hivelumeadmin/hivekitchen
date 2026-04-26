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

export interface RefreshRotatedResult {
  type: 'rotated';
  access_token: string;
  expires_in: number;
  user_id: string;
  refresh_token_plaintext: string;
  refresh_token_max_age_seconds: number;
}

export interface ReuseDetectedResult {
  type: 'reuse_detected';
  user_id: string;
}

export type RefreshResult = RefreshRotatedResult | ReuseDetectedResult;

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
      email: data.user.email || input.email,
      display_name: extractDisplayName(data.user.user_metadata),
    });
  }

  async loginWithOAuth(input: { provider: 'google' | 'apple'; code: string }): Promise<LoginResult> {
    const { data, error } = await this.supabase.auth.exchangeCodeForSession(input.code);
    if (error || !data.user) throw new UnauthorizedError('OAuth exchange failed');
    const email = data.user.email;
    if (!email) throw new UnauthorizedError('OAuth provider did not supply an email address');
    return this.completeLogin({
      auth_user_id: data.user.id,
      email,
      display_name: extractDisplayName(data.user.user_metadata),
    });
  }

  async logout(refresh_token_plaintext: string): Promise<{ user_id: string | null }> {
    if (refresh_token_plaintext.length === 0) return { user_id: null };
    const hash = sha256Hex(refresh_token_plaintext);
    const { user_id } = await this.repository.markRefreshTokenRevoked(hash);
    if (user_id !== null) {
      try {
        await this.supabase.auth.admin.signOut(user_id, 'global');
      } catch {
        // best-effort: DB revocation succeeded; Supabase session will expire naturally
      }
    }
    return { user_id };
  }

  async refreshToken(plaintext: string): Promise<RefreshResult> {
    if (plaintext.length === 0) throw new UnauthorizedError('Refresh token missing');

    const hash = sha256Hex(plaintext);
    const token = await this.repository.findRefreshTokenByHash(hash);
    if (!token) throw new UnauthorizedError('Invalid or expired refresh token');

    if (token.replaced_by !== null) {
      try {
        await this.repository.revokeAllByFamilyId(token.family_id);
      } catch {
        // best-effort: proceed to signOut regardless of DB failure
      }
      try {
        await this.supabase.auth.admin.signOut(token.user_id, 'global');
      } catch {
        // best-effort
      }
      return { type: 'reuse_detected', user_id: token.user_id };
    }

    const newPlaintext = randomBytes(32).toString('base64url');
    const newToken = await this.repository.insertRefreshToken({
      user_id: token.user_id,
      family_id: token.family_id,
      token_hash: sha256Hex(newPlaintext),
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    const consumed = await this.repository.consumeRefreshToken(token.id, newToken.id);
    if (!consumed) {
      // A concurrent request already consumed the original token. Revoke only the orphaned new row
      // (client never received its plaintext) to avoid accumulating valid-but-unreachable tokens.
      // Do not revoke the whole family — the winning concurrent request's new token is legitimate.
      await this.repository.markRefreshTokenRevoked(sha256Hex(newPlaintext));
      throw new UnauthorizedError('Concurrent token rotation detected — please retry');
    }

    const user = await this.repository.findUserByAuthId(token.user_id);
    if (!user || !user.current_household_id) {
      throw new UnauthorizedError('Account not found or household missing — please log in again');
    }

    const access_token = this.jwt.sign(
      { sub: user.id, hh: user.current_household_id, role: user.role },
      { expiresIn: `${ACCESS_TOKEN_TTL_SECONDS}s` },
    );

    return {
      type: 'rotated',
      access_token,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      user_id: user.id,
      refresh_token_plaintext: newPlaintext,
      refresh_token_max_age_seconds: REFRESH_TOKEN_TTL_SECONDS,
    };
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

    if (!user.current_household_id) {
      throw new UnauthorizedError('Session invalid — please log in again');
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
