import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service.js';
import type { AuthRepository, UserRow } from './auth.repository.js';
import { UnauthorizedError } from '../../common/errors.js';

type SupaAuthResult = { data: { user: { id: string; email: string; user_metadata: Record<string, unknown> } | null }; error: unknown };

interface MockSupabase {
  auth: {
    signInWithPassword: ReturnType<typeof vi.fn>;
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
    admin: { signOut: ReturnType<typeof vi.fn> };
  };
}

interface MockRepo {
  findUserByAuthId: ReturnType<typeof vi.fn>;
  createHouseholdAndUser: ReturnType<typeof vi.fn>;
  insertRefreshToken: ReturnType<typeof vi.fn>;
  markRefreshTokenRevoked: ReturnType<typeof vi.fn>;
  findRefreshTokenByHash: ReturnType<typeof vi.fn>;
  consumeRefreshToken: ReturnType<typeof vi.fn>;
  revokeAllByFamilyId: ReturnType<typeof vi.fn>;
}

const SAMPLE_USER: UserRow = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'parent@example.com',
  display_name: 'Sample Parent',
  current_household_id: '22222222-2222-2222-2222-222222222222',
  role: 'primary_parent',
};

function makeMocks() {
  const supabase: MockSupabase = {
    auth: {
      signInWithPassword: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      admin: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    },
  };
  const repository: MockRepo = {
    findUserByAuthId: vi.fn(),
    createHouseholdAndUser: vi.fn(),
    insertRefreshToken: vi.fn().mockResolvedValue({ id: 'rt-1' }),
    markRefreshTokenRevoked: vi.fn().mockResolvedValue({ user_id: null }),
    findRefreshTokenByHash: vi.fn(),
    consumeRefreshToken: vi.fn().mockResolvedValue(true),
    revokeAllByFamilyId: vi.fn().mockResolvedValue(undefined),
  };
  const jwt = { sign: vi.fn().mockReturnValue('signed.jwt.token') };
  // Type-erase to satisfy AuthService constructor; runtime shape matches.
  const service = new AuthService(
    repository as unknown as AuthRepository,
    supabase as unknown as ConstructorParameters<typeof AuthService>[1],
    jwt as unknown as ConstructorParameters<typeof AuthService>[2],
  );
  return { service, supabase, repository, jwt };
}

function okSupaResult(id: string, email = 'parent@example.com'): SupaAuthResult {
  return { data: { user: { id, email, user_metadata: { full_name: 'Sample Parent' } } }, error: null };
}

describe('AuthService.loginWithPassword', () => {
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('first login: creates household + user and returns is_first_login=true', async () => {
    mocks.supabase.auth.signInWithPassword.mockResolvedValue(okSupaResult(SAMPLE_USER.id));
    mocks.repository.findUserByAuthId.mockResolvedValue(null);
    mocks.repository.createHouseholdAndUser.mockResolvedValue(SAMPLE_USER);

    const result = await mocks.service.loginWithPassword({ email: 'parent@example.com', password: 'verylongpassword' });

    expect(mocks.repository.createHouseholdAndUser).toHaveBeenCalledWith({
      user_id: SAMPLE_USER.id,
      email: 'parent@example.com',
      display_name: 'Sample Parent',
    });
    expect(result.is_first_login).toBe(true);
    expect(result.user).toEqual(SAMPLE_USER);
    expect(result.access_token).toBe('signed.jwt.token');
    expect(result.expires_in).toBe(15 * 60);
  });

  it('returning user: skips createHouseholdAndUser, is_first_login=false', async () => {
    mocks.supabase.auth.signInWithPassword.mockResolvedValue(okSupaResult(SAMPLE_USER.id));
    mocks.repository.findUserByAuthId.mockResolvedValue(SAMPLE_USER);

    const result = await mocks.service.loginWithPassword({ email: 'parent@example.com', password: 'verylongpassword' });

    expect(mocks.repository.createHouseholdAndUser).not.toHaveBeenCalled();
    expect(result.is_first_login).toBe(false);
    expect(result.user).toEqual(SAMPLE_USER);
  });

  it('inserts refresh token by SHA-256 hash, never plaintext', async () => {
    mocks.supabase.auth.signInWithPassword.mockResolvedValue(okSupaResult(SAMPLE_USER.id));
    mocks.repository.findUserByAuthId.mockResolvedValue(SAMPLE_USER);

    const result = await mocks.service.loginWithPassword({ email: 'parent@example.com', password: 'verylongpassword' });

    expect(mocks.repository.insertRefreshToken).toHaveBeenCalledTimes(1);
    const arg = mocks.repository.insertRefreshToken.mock.calls[0]![0] as { token_hash: string };
    expect(arg.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(arg.token_hash).not.toBe(result.refresh_token_plaintext);
    expect(result.refresh_token_plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('Supabase rejection → throws UnauthorizedError', async () => {
    mocks.supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    });

    await expect(
      mocks.service.loginWithPassword({ email: 'parent@example.com', password: 'wrongpassword12' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('AuthService.loginWithOAuth', () => {
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('google happy path delegates to completeLogin', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue(okSupaResult(SAMPLE_USER.id));
    mocks.repository.findUserByAuthId.mockResolvedValue(SAMPLE_USER);

    const result = await mocks.service.loginWithOAuth({ provider: 'google', code: 'abc' });

    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(result.user).toEqual(SAMPLE_USER);
  });

  it('apple happy path delegates to completeLogin', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue(okSupaResult(SAMPLE_USER.id));
    mocks.repository.findUserByAuthId.mockResolvedValue(SAMPLE_USER);

    const result = await mocks.service.loginWithOAuth({ provider: 'apple', code: 'xyz' });

    expect(result.is_first_login).toBe(false);
  });

  it('failed exchange → throws UnauthorizedError', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'bad code' },
    });

    await expect(
      mocks.service.loginWithOAuth({ provider: 'google', code: 'bad' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('AuthService.logout', () => {
  it('marks the refresh token revoked when token present', async () => {
    const mocks = makeMocks();
    await mocks.service.logout('some-plaintext-token');
    expect(mocks.repository.markRefreshTokenRevoked).toHaveBeenCalledTimes(1);
    const arg = mocks.repository.markRefreshTokenRevoked.mock.calls[0]![0] as string;
    expect(arg).toMatch(/^[a-f0-9]{64}$/);
  });

  it('calls supabase admin.signOut when user_id is returned from repo', async () => {
    const mocks = makeMocks();
    mocks.repository.markRefreshTokenRevoked.mockResolvedValue({ user_id: SAMPLE_USER.id });
    await mocks.service.logout('some-plaintext-token');
    expect(mocks.supabase.auth.admin.signOut).toHaveBeenCalledWith(SAMPLE_USER.id, 'global');
  });

  it('skips admin.signOut when token not found (user_id null)', async () => {
    const mocks = makeMocks();
    await mocks.service.logout('unknown-token');
    expect(mocks.supabase.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it('no-op when token absent (empty string)', async () => {
    const mocks = makeMocks();
    await mocks.service.logout('');
    expect(mocks.repository.markRefreshTokenRevoked).not.toHaveBeenCalled();
  });
});

describe('AuthService.refreshToken', () => {
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('valid token: rotates and returns new access + refresh', async () => {
    mocks.repository.findRefreshTokenByHash.mockResolvedValue({
      id: 'old-rt',
      user_id: SAMPLE_USER.id,
      family_id: 'fam-1',
      replaced_by: null,
    });
    mocks.repository.insertRefreshToken.mockResolvedValue({ id: 'new-rt' });
    mocks.repository.findUserByAuthId.mockResolvedValue(SAMPLE_USER);

    const result = await mocks.service.refreshToken('plaintext-old-token');

    expect(result.type).toBe('rotated');
    if (result.type !== 'rotated') return;
    expect(result.access_token).toBe('signed.jwt.token');
    expect(result.expires_in).toBe(15 * 60);
    expect(result.user_id).toBe(SAMPLE_USER.id);
    expect(result.refresh_token_plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.repository.insertRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: SAMPLE_USER.id, family_id: 'fam-1' }),
    );
    expect(mocks.repository.consumeRefreshToken).toHaveBeenCalledWith('old-rt', 'new-rt');
  });

  it('reused token (replaced_by set): revokes family + signs out user, returns reuse_detected', async () => {
    mocks.repository.findRefreshTokenByHash.mockResolvedValue({
      id: 'reused-rt',
      user_id: SAMPLE_USER.id,
      family_id: 'fam-1',
      replaced_by: 'replacement-rt',
    });

    const result = await mocks.service.refreshToken('plaintext-reused');

    expect(result.type).toBe('reuse_detected');
    if (result.type !== 'reuse_detected') return;
    expect(result.user_id).toBe(SAMPLE_USER.id);
    expect(mocks.repository.revokeAllByFamilyId).toHaveBeenCalledWith('fam-1');
    expect(mocks.supabase.auth.admin.signOut).toHaveBeenCalledWith(SAMPLE_USER.id, 'global');
    expect(mocks.repository.insertRefreshToken).not.toHaveBeenCalled();
  });

  it('unknown token (no row found) → throws UnauthorizedError', async () => {
    mocks.repository.findRefreshTokenByHash.mockResolvedValue(null);

    await expect(mocks.service.refreshToken('plaintext-bad')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(mocks.repository.revokeAllByFamilyId).not.toHaveBeenCalled();
  });

  it('empty plaintext → throws UnauthorizedError without DB lookup', async () => {
    await expect(mocks.service.refreshToken('')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mocks.repository.findRefreshTokenByHash).not.toHaveBeenCalled();
  });
});
