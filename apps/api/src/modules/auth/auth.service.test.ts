import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service.js';
import type { AuthRepository, UserRow } from './auth.repository.js';
import { UnauthorizedError } from '../../common/errors.js';

type SupaAuthResult = { data: { user: { id: string; email: string; user_metadata: Record<string, unknown> } | null }; error: unknown };

interface MockSupabase {
  auth: {
    signInWithPassword: ReturnType<typeof vi.fn>;
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
  };
}

interface MockRepo {
  findUserByAuthId: ReturnType<typeof vi.fn>;
  createHouseholdAndUser: ReturnType<typeof vi.fn>;
  insertRefreshToken: ReturnType<typeof vi.fn>;
  markRefreshTokenRevoked: ReturnType<typeof vi.fn>;
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
    },
  };
  const repository: MockRepo = {
    findUserByAuthId: vi.fn(),
    createHouseholdAndUser: vi.fn(),
    insertRefreshToken: vi.fn().mockResolvedValue({ id: 'rt-1' }),
    markRefreshTokenRevoked: vi.fn().mockResolvedValue(undefined),
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

  it('no-op when token absent (empty string)', async () => {
    const mocks = makeMocks();
    await mocks.service.logout('');
    expect(mocks.repository.markRefreshTokenRevoked).not.toHaveBeenCalled();
  });
});
