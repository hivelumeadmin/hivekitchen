import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCallbackPage from './callback.js';

// Match login.test.tsx's `useNavigate` mock so we can assert routing decisions.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const originalFetch = globalThis.fetch;

function mockCallbackResponse(
  overrides: {
    is_first_login?: boolean;
    is_onboarded?: boolean;
    is_onboarding_in_progress?: boolean;
  } = {},
) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: 'jwt',
        expires_in: 900,
        user: {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'parent@example.com',
          display_name: 'Parent',
          current_household_id: '22222222-2222-2222-2222-222222222222',
          role: 'primary_parent',
        },
        is_first_login: overrides.is_first_login ?? false,
        is_onboarded: overrides.is_onboarded ?? true,
        is_onboarding_in_progress: overrides.is_onboarding_in_progress ?? false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

async function renderCallback(searchParams: string) {
  render(
    <MemoryRouter initialEntries={[`/auth/callback${searchParams}`]}>
      <AuthCallbackPage />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(navigateSpy).toHaveBeenCalled();
  });
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    mockCallbackResponse();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('missing code → /auth/login (no fetch)', async () => {
    await renderCallback('?provider=google');
    expect(navigateSpy).toHaveBeenCalledWith('/auth/login');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('invalid provider → /auth/login (no fetch)', async () => {
    await renderCallback('?provider=facebook&code=abc');
    expect(navigateSpy).toHaveBeenCalledWith('/auth/login');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /v1/auth/callback with provider + code', async () => {
    await renderCallback('?provider=google&code=oauth-code-123');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/auth/callback');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { provider: string; code: string };
    expect(body.provider).toBe('google');
    expect(body.code).toBe('oauth-code-123');
  });

  // Slice 2-S19 — onboarding-aware routing (mirrors login.test.tsx)
  describe('post-callback navigation (2-S19)', () => {
    it('returning fully-onboarded user → navigates to /app', async () => {
      mockCallbackResponse({ is_first_login: false, is_onboarded: true });
      await renderCallback('?provider=google&code=oauth-code');
      expect(navigateSpy).toHaveBeenCalledWith('/app');
    });

    it('first-login user → navigates to /onboarding', async () => {
      mockCallbackResponse({ is_first_login: true, is_onboarded: false });
      await renderCallback('?provider=apple&code=oauth-code');
      expect(navigateSpy).toHaveBeenCalledWith('/onboarding');
    });

    it('returning user with incomplete onboarding → navigates to /onboarding (the fix)', async () => {
      mockCallbackResponse({ is_first_login: false, is_onboarded: false });
      await renderCallback('?provider=google&code=oauth-code');
      expect(navigateSpy).toHaveBeenCalledWith('/onboarding');
    });

    it('honors ?next= param when fully onboarded', async () => {
      mockCallbackResponse({ is_first_login: false, is_onboarded: true });
      await renderCallback('?provider=google&code=oauth-code&next=%2Faccount');
      expect(navigateSpy).toHaveBeenCalledWith('/account');
    });

    it('discards ?next= when not onboarded (routes to /onboarding regardless)', async () => {
      mockCallbackResponse({ is_first_login: false, is_onboarded: false });
      await renderCallback('?provider=google&code=oauth-code&next=%2Faccount');
      expect(navigateSpy).toHaveBeenCalledWith('/onboarding');
    });
  });
});
