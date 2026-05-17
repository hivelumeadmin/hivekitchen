import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useScope } from '@hivekitchen/ui';
import { zodResolver } from '@/lib/zod-resolver.js';
import type { LoginResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { AppFooter } from '@/components/AppFooter.js';
import { AppHeader } from '@/components/AppHeader.js';
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
} from '@/components/icons.js';
import { PrimaryButton } from '@/components/PrimaryButton.js';
import { TextField } from '@/components/TextField.js';
import { LoginHero } from '@/features/login/components/LoginHero.js';

const ResetPasswordFormSchema = z.object({
  password: z.string().min(12).max(128),
});
type ResetPasswordForm = z.infer<typeof ResetPasswordFormSchema>;

const copy = {
  eyebrow: 'Reset password',
  headline: 'Set a new password',
  description:
    'Choose something memorable — Lumi will keep your week ready for you when you come back.',
  passwordLabel: 'New password',
  passwordPlaceholder: 'At least 12 characters',
  primaryCta: 'Save and continue',
  freshLink: 'Need a fresh link?',
  expiredEyebrow: 'Reset password',
  expiredHeadline: 'This link has expired',
  expiredDescription:
    "Reset links open for a short window. Send yourself a fresh one and we'll keep your week here in the meantime.",
  expiredCta: 'Send a new link',
};

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
  const passwordReg = register('password');

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
      // 2-S19: a parent resetting their password mid-onboarding lands back at
      // /onboarding, not /app. Mirrors login.tsx + callback.tsx routing.
      navigate(result.is_onboarded ? '/app' : '/onboarding');
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

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="flex flex-1 flex-col md:flex-row">
        <LoginHero />
        <div className="relative z-10 flex w-full flex-col justify-center bg-bg px-8 py-12 md:w-2/5 md:bg-transparent md:px-16 md:py-24 lg:px-24">
          <div className="mx-auto flex w-full max-w-md flex-col gap-8">
            {linkExpired ? (
              <>
                <header className="space-y-4">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-amber-warm">
                    {copy.expiredEyebrow}
                  </p>
                  <h1 className="font-serif text-[40px] leading-tight text-fg">
                    {copy.expiredHeadline}
                  </h1>
                  <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-fg-muted">
                    {copy.expiredDescription}
                  </p>
                </header>
                <PrimaryButton
                  size="lg"
                  icon={<ArrowRightIcon />}
                  onClick={() => navigate('/auth/login')}
                >
                  {copy.expiredCta}
                </PrimaryButton>
              </>
            ) : (
              <>
                <header className="space-y-4">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-amber-warm">
                    {copy.eyebrow}
                  </p>
                  <h1 className="font-serif text-[40px] leading-tight text-fg">
                    {copy.headline}
                  </h1>
                  <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-fg-muted">
                    {copy.description}
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

                <form
                  onSubmit={handleSubmit(onSubmit)}
                  className="flex flex-col gap-6"
                  noValidate
                >
                  <TextField
                    id="reset-password"
                    label={copy.passwordLabel}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={copy.passwordPlaceholder}
                    icon={<LockIcon />}
                    name={passwordReg.name}
                    onChange={passwordReg.onChange}
                    onBlur={passwordReg.onBlur}
                    inputRef={passwordReg.ref}
                    error={
                      formState.errors.password
                        ? 'Password must be 12–128 characters.'
                        : undefined
                    }
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

                  <PrimaryButton
                    type="submit"
                    size="lg"
                    icon={<ArrowRightIcon />}
                    disabled={formState.isSubmitting}
                  >
                    {copy.primaryCta}
                  </PrimaryButton>

                  <a
                    href="/auth/login"
                    className="text-center text-sm text-fg-muted underline underline-offset-2 transition-colors hover:text-amber-warm"
                  >
                    {copy.freshLink}
                  </a>
                </form>
              </>
            )}
          </div>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
