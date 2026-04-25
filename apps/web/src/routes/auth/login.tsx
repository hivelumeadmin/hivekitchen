import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { LoginRequestSchema } from '@hivekitchen/contracts';
import type { LoginRequest, LoginResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { supabase } from '@/lib/supabase-client.js';

export default function LoginPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [apiError, setApiError] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (accessToken !== null) navigate('/app', { replace: true });
  }, [accessToken, navigate]);

  const { register, handleSubmit, formState } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    mode: 'onBlur',
  });

  async function onSubmit(values: LoginRequest) {
    setApiError(null);
    try {
      const result = await hkFetch<LoginResponse>('/v1/auth/login', { method: 'POST', body: values });
      useAuthStore.getState().setSession(result.access_token, result.user);
      const next = params.get('next');
      const destination = next && next.startsWith('/') ? next : '/app';
      navigate(result.is_first_login ? '/onboarding' : destination);
    } catch (err) {
      if (err instanceof HkApiError && err.status === 401) {
        setApiError('Invalid email or password. Please try again.');
      } else {
        setApiError('Something went wrong. Please try again later.');
      }
    }
  }

  async function startOAuth(provider: 'google' | 'apple') {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?provider=${provider}` },
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <header className="text-center space-y-2">
          <h1 className="font-serif text-3xl">Welcome to HiveKitchen</h1>
          <p className="text-sm text-warm-neutral-700">
            Sign in to continue planning your week.
          </p>
        </header>

        {apiError && (
          <p role="alert" className="text-sm text-red-700">{apiError}</p>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              className="w-full rounded border border-warm-neutral-300 px-3 py-2"
            />
            {formState.errors.email && (
              <p role="alert" className="text-sm text-red-700">{formState.errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              className="w-full rounded border border-warm-neutral-300 px-3 py-2"
            />
            {formState.errors.password && (
              <p role="alert" className="text-sm text-red-700">{formState.errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={formState.isSubmitting}
            className="w-full rounded bg-honey-amber-600 py-2 text-white"
          >
            Sign in
          </button>
        </form>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void startOAuth('google')}
            className="w-full rounded border border-warm-neutral-300 py-2"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => void startOAuth('apple')}
            className="w-full rounded border border-warm-neutral-300 py-2"
          >
            Continue with Apple
          </button>
        </div>
      </div>
    </main>
  );
}
