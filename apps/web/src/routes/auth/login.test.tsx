import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './login.js';

vi.mock('@/lib/supabase-client.js', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}));

const originalFetch = globalThis.fetch;

describe('LoginPage', () => {
  beforeEach(() => {
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
          is_first_login: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
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

    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByLabelText(/password/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with apple/i })).toBeDefined();
  });

  it('shows a validation error when email is invalid (Zod resolver fires onBlur)', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/email/i);
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

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'parent@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'verylongpassword' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/auth/login');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { email: string; password: string };
    expect(body.email).toBe('parent@example.com');
    expect(body.password).toBe('verylongpassword');
  });
});
