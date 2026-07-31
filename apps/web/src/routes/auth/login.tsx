import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useScope, AppFooter, PrimaryButton, TextField } from '@hivekitchen/ui';
import { LoginRequestSchema } from '@hivekitchen/contracts';
import type { LoginRequest, LoginResponse } from '@hivekitchen/types';
import { zodResolver } from '@/lib/zod-resolver.js';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { supabase } from '@/lib/supabase-client.js';
import { AppHeader } from '@/components/AppHeader.js';
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from '@hivekitchen/ui';
import { AppleButton } from '@/features/login/components/AppleButton.js';
import { GoogleButton } from '@/features/login/components/GoogleButton.js';
import { LoginHero } from '@/features/login/components/LoginHero.js';
import { OrDivider } from '@/features/login/components/OrDivider.js';
import { loginCopyMock } from '@/features/login/data/mockData.js';

export default function LoginPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [apiError, setApiError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Mount-only: if the user lands on /auth/login while already authenticated,
  // bounce to /app. Post-login navigation (including `next=` and first-login
  // routing) is owned by onSubmit; depending on `accessToken` here would race
  // setSession with onSubmit's own navigate call and clobber it.
  useEffect(() => {
    if (useAuthStore.getState().accessToken !== null) {
      navigate('/app', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { register, handleSubmit, formState } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    mode: 'onBlur',
  });

  async function onSubmit(values: LoginRequest) {
    setApiError(null);
    try {
      const result = await hkFetch<LoginResponse>('/v1/auth/login', {
        method: 'POST',
        body: values,
      });
      useAuthStore.getState().setSession(result.access_token, result.user);
      const next = params.get('next');
      const destination = next && /^\/[^/]/.test(next) ? next : '/app';
      // 2-S19: route to /onboarding whenever the user isn't fully onboarded,
      // not just on their first login. Catches resumed-after-abandon flows.
      navigate(result.is_onboarded ? destination : '/onboarding');
    } catch (err) {
      if (err instanceof HkApiError && err.status === 401) {
        setApiError('Invalid email or password. Please try again.');
      } else {
        setApiError('Something went wrong. Please try again later.');
      }
    }
  }

  async function startOAuth(provider: 'google' | 'apple') {
    setApiError(null);
    try {
      const next = params.get('next');
      const validNext = next && /^\/[^/]/.test(next) ? next : null;
      const redirectTo = new URL('/auth/callback', window.location.origin);
      redirectTo.searchParams.set('provider', provider);
      if (validNext !== null) redirectTo.searchParams.set('next', validNext);
      await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectTo.toString() },
      });
    } catch {
      setApiError('Something went wrong. Please try again later.');
    }
  }

  const c = loginCopyMock;
  const emailReg = register('email');
  const passwordReg = register('password');

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="flex flex-1 flex-col md:flex-row">
        <LoginHero />
        <div className="relative z-10 flex w-full flex-col justify-center bg-bg px-8 py-12 md:w-2/5 md:bg-transparent md:px-16 md:py-24 lg:px-24">
          <div className="mx-auto flex w-full max-w-md flex-col gap-8">
            <header className="space-y-4">
              <p className="text-[11px] font-medium uppercase tracking-widest text-amber-warm">
                {c.eyebrow}
              </p>
              <h1 className="font-serif text-[40px] leading-tight text-fg">{c.headline}</h1>
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-fg-muted">
                {c.description}
              </p>
            </header>

            {apiError ? (
              <p
                role="alert"
                className="rounded-lg border border-safety-red/30 bg-safety-red/10 px-4 py-3 text-sm text-safety-red"
              >
                {apiError}
              </p>
            ) : null}

            <div className="flex flex-col gap-6">
              <GoogleButton
                label={c.googleCta}
                onClick={() => void startOAuth('google')}
              />
              <AppleButton label="Continue with Apple" onClick={() => void startOAuth('apple')} />
              <OrDivider label={c.orDivider} />
            </div>

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="mt-6 flex flex-col gap-6"
              noValidate
            >
              <div className="flex flex-col gap-4">
                <TextField
                  id="login-email"
                  label={c.emailLabel}
                  type="email"
                  autoComplete="email"
                  placeholder={c.emailPlaceholder}
                  icon={<MailIcon />}
                  name={emailReg.name}
                  onChange={emailReg.onChange}
                  onBlur={emailReg.onBlur}
                  inputRef={emailReg.ref}
                  error={formState.errors.email?.message}
                />
                <TextField
                  id="login-password"
                  label={c.passwordLabel}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={c.passwordPlaceholder}
                  icon={<LockIcon />}
                  name={passwordReg.name}
                  onChange={passwordReg.onChange}
                  onBlur={passwordReg.onBlur}
                  inputRef={passwordReg.ref}
                  error={formState.errors.password?.message}
                  trailing={
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((s) => !s)}
                      className="text-fg-muted transition-colors hover:text-fg"
                    >
                      {showPassword ? (
                        <EyeOffIcon className="h-5 w-5" />
                      ) : (
                        <EyeIcon className="h-5 w-5" />
                      )}
                    </button>
                  }
                />
              </div>

              <PrimaryButton
                type="submit"
                size="lg"
                icon={<ArrowRightIcon />}
                disabled={formState.isSubmitting}
              >
                {c.primaryCta}
              </PrimaryButton>
            </form>
          </div>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
