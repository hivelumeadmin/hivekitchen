import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './login.js';

vi.mock('@/lib/supabase-client.js', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const originalFetch = globalThis.fetch;

function mockLoginResponse(
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

describe('LoginPage', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    mockLoginResponse();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders email + password fields and the two OAuth buttons', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    // Email + password inputs (exact labels — "/email/i" or "/password/i" would
    // also match the eye-toggle's aria-label "Show password").
    expect(screen.getByLabelText('Email Address')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();

    // Primary CTA renamed in v2.0: "Sign in" → "Enter Kitchen".
    expect(screen.getByRole('button', { name: /enter kitchen/i })).toBeDefined();

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with apple/i })).toBeDefined();
  });

  it('shows a validation error when email is invalid (Zod resolver fires onBlur)', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText('Email Address');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('POSTs to /v1/auth/login with the form body on submit', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'parent@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'verylongpassword' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /enter kitchen/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/auth/login');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { email: string; password: string };
    expect(body.email).toBe('parent@example.com');
    expect(body.password).toBe('verylongpassword');
  });

  // Slice 2-S19 — onboarding-aware routing
  describe('post-login navigation (2-S19)', () => {
    async function submitLoginForm() {
      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>,
      );
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'parent@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'verylongpassword' },
      });
      fireEvent.submit(
        screen.getByRole('button', { name: /enter kitchen/i }).closest('form')!,
      );
      await waitFor(() => {
        expect(navigateSpy).toHaveBeenCalled();
      });
    }

    it('returning fully-onboarded user → navigates to /app', async () => {
      mockLoginResponse({ is_first_login: false, is_onboarded: true });
      await submitLoginForm();
      expect(navigateSpy).toHaveBeenCalledWith('/app');
    });

    it('first-login user → navigates to /onboarding', async () => {
      mockLoginResponse({ is_first_login: true, is_onboarded: false });
      await submitLoginForm();
      expect(navigateSpy).toHaveBeenCalledWith('/onboarding');
    });

    it('returning user with incomplete onboarding → navigates to /onboarding (the fix)', async () => {
      mockLoginResponse({ is_first_login: false, is_onboarded: false });
      await submitLoginForm();
      expect(navigateSpy).toHaveBeenCalledWith('/onboarding');
    });
  });
});
