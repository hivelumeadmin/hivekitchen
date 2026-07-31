import { useRef, useState } from 'react';
import type { UserProfile } from '@hivekitchen/types';
import { usePasswordResetMutation } from './mutations.js';

const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

interface PasswordPanelProps {
  profile: UserProfile;
}

export function PasswordPanel({ profile }: PasswordPanelProps) {
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Synchronous guard: a second click lands before React re-renders the
  // disabled button, so the state flag alone cannot prevent a double send.
  const resetInProgress = useRef(false);
  const passwordReset = usePasswordResetMutation();

  const isEmailProvider = profile.auth_providers.includes('email');
  const oauthProvider = profile.auth_providers.find((p) => p !== 'email');

  function handlePasswordReset() {
    if (resetInProgress.current) return;
    resetInProgress.current = true;
    setResetError(null);
    passwordReset.mutate(
      { email: profile.email },
      {
        onSuccess: () => {
          setResetSent(true);
          setTimeout(() => {
            setResetSent(false);
            resetInProgress.current = false;
          }, PASSWORD_RESET_COOLDOWN_MS);
        },
        onError: () => {
          setResetError('Could not send reset email. Please try again later.');
        },
        // Clearing the guard here rather than in onError: mutate()-scoped
        // callbacks are skipped once the observer unmounts, and onSettled at
        // least keeps the success and failure paths symmetric. The ref is
        // component-scoped, so an unmount discards it anyway.
        onSettled: (_data, error) => {
          if (error !== null) resetInProgress.current = false;
        },
      },
    );
  }

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-serif text-xl text-fg">Password</h2>
      {isEmailProvider ? (
        <>
          <button
            type="button"
            onClick={handlePasswordReset}
            disabled={resetSent}
            className="w-full rounded border border-border py-2"
          >
            {resetSent ? 'Check your inbox — a reset link has been sent' : 'Send password reset email'}
          </button>
          {resetError && (
            <p role="alert" className="text-sm text-safety-red">{resetError}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-fg-muted">
          Your account is managed at {oauthProvider ?? 'your provider'}.
        </p>
      )}
    </section>
  );
}
