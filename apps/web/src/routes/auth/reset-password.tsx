import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useScope } from '@hivekitchen/ui';
import { zodResolver } from '@/lib/zod-resolver.js';
import type { LoginResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

const ResetPasswordFormSchema = z.object({
  password: z.string().min(12).max(128),
});
type ResetPasswordForm = z.infer<typeof ResetPasswordFormSchema>;

export default function ResetPasswordPage() {
  useScope('app-scope');
  const navigate = useNavigate();

  const accessToken = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    if (!hash) return null;
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    if (params.get('type') !== 'recovery') return null;
    return params.get('access_token');
  }, []);

  const [linkExpired, setLinkExpired] = useState(accessToken === null || accessToken.length === 0);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const submitInProgress = useRef(false);

  const { register, handleSubmit, formState } = useForm<ResetPasswordForm>({
    resolver: zodResolver(ResetPasswordFormSchema),
    mode: 'onBlur',
  });

  useEffect(() => {
    if (accessToken === null || accessToken.length === 0) setLinkExpired(true);
  }, [accessToken]);

  async function onSubmit(values: ResetPasswordForm) {
    if (submitInProgress.current) return;
    if (accessToken === null || accessToken.length === 0) {
      setLinkExpired(true);
      return;
    }
    submitInProgress.current = true;
    setApiError(null);
    try {
      const result = await hkFetch<LoginResponse>('/v1/auth/password-reset-complete', {
        method: 'POST',
        body: { token: accessToken, password: values.password },
      });
      useAuthStore.getState().setSession(result.access_token, result.user);
      navigate('/app');
    } catch (err) {
      if (err instanceof HkApiError && err.status === 410) {
        setLinkExpired(true);
      } else if (err instanceof HkApiError && err.status === 400) {
        setApiError('Password must be 12–128 characters.');
      } else {
        setApiError('Something went wrong. Please try again.');
      }
    } finally {
      submitInProgress.current = false;
    }
  }

  if (linkExpired) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <h1 className="font-serif text-2xl text-warm-neutral-900">Link expired</h1>
          <p className="text-sm text-warm-neutral-700">
            This reset link has expired or already been used.
          </p>
          <a href="/auth/login" className="inline-block text-sm text-honey-amber-700 underline">
            Send a new link
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <header className="text-center space-y-2">
          <h1 className="font-serif text-3xl">Reset your password</h1>
          <p className="text-sm text-warm-neutral-700">
            Choose a new password to sign back in.
          </p>
        </header>

        {apiError && (
          <p role="alert" className="text-sm text-red-700">{apiError}</p>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm">New password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                {...register('password')}
                className="w-full rounded border border-warm-neutral-300 px-3 py-2 pe-16"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-2 my-auto text-xs text-warm-neutral-700"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {formState.errors.password && (
              <p role="alert" className="text-sm text-red-700">
                Password must be 12–128 characters.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={formState.isSubmitting}
            className="w-full rounded bg-honey-amber-600 py-2 text-white"
          >
            Reset password
          </button>
        </form>
      </div>
    </main>
  );
}
