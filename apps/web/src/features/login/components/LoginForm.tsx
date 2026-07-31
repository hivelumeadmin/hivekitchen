import { useState } from 'react';
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from '@hivekitchen/ui';
import { PrimaryButton } from '@hivekitchen/ui';
import { TextField } from '@hivekitchen/ui';
import { loginCopyMock } from '../data/mockData.js';
import { GoogleButton } from './GoogleButton.js';
import { OrDivider } from './OrDivider.js';
import { SecondaryCtaButton } from './SecondaryCtaButton.js';

export function LoginForm() {
  const c = loginCopyMock;
  const [showPassword, setShowPassword] = useState(false);

  return (
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

        <div className="flex flex-col gap-6">
          <GoogleButton label={c.googleCta} />
          <OrDivider label={c.orDivider} />
        </div>

        <form
          className="mt-6 flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <div className="flex flex-col gap-4">
            <TextField
              id="login-email"
              label={c.emailLabel}
              type="email"
              autoComplete="email"
              placeholder={c.emailPlaceholder}
              icon={<MailIcon />}
            />
            <TextField
              id="login-password"
              label={c.passwordLabel}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={c.passwordPlaceholder}
              icon={<LockIcon />}
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

          <div className="mt-2 flex flex-col gap-4">
            <PrimaryButton type="submit" size="lg" icon={<ArrowRightIcon />}>
              {c.primaryCta}
            </PrimaryButton>
            <SecondaryCtaButton>{c.secondaryCta}</SecondaryCtaButton>
          </div>
        </form>
      </div>
    </div>
  );
}
