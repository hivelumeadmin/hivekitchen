import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type { UserProfile, UpdateProfileRequest } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

type LoadState = 'loading' | 'ready' | 'error';

const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

export default function AccountPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const didLoad = useRef(false);
  const resetInProgress = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    if (accessToken === null) {
      didLoad.current = false; // reset so a fresh login re-fetches the profile
      navigate('/auth/login?next=/account', { replace: true });
      return;
    }
    if (didLoad.current) return;
    didLoad.current = true;

    void (async () => {
      try {
        const result = await hkFetch<UserProfile>('/v1/users/me', { method: 'GET' });
        setProfile(result);
        setDisplayName(result.display_name ?? '');
        setPreferredLanguage(result.preferred_language);
        setEmailDraft(result.email);
        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    })();
  }, [accessToken, navigate]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSaveError(null);

    const body: UpdateProfileRequest = {};
    const nextDisplayName = displayName.trim();
    // Only send display_name if non-empty and changed (empty string is not a valid value)
    if (nextDisplayName.length > 0 && nextDisplayName !== (profile.display_name ?? '')) {
      body.display_name = nextDisplayName;
    }
    if (preferredLanguage !== profile.preferred_language) body.preferred_language = preferredLanguage;
    if (editingEmail && emailDraft !== profile.email) body.email = emailDraft;

    if (Object.keys(body).length === 0) return;

    setSaving(true);
    try {
      const updated = await hkFetch<UserProfile>('/v1/users/me', { method: 'PATCH', body });
      setProfile(updated);
      setDisplayName(updated.display_name ?? '');
      setPreferredLanguage(updated.preferred_language);
      setEmailDraft(updated.email);
      setEditingEmail(false);
      useAuthStore.getState().updateUser({
        display_name: updated.display_name,
        email: updated.email,
      });
    } catch (err) {
      // Always reset email editing state on failure to prevent silent re-submission
      setEditingEmail(false);
      setEmailDraft(profile.email);
      if (err instanceof HkApiError && err.status === 409) {
        setSaveError('That email is already in use.');
      } else if (err instanceof HkApiError && err.status === 400) {
        setSaveError('Please review the form — one or more fields are invalid.');
      } else {
        setSaveError('Something went wrong. Please try again later.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordReset() {
    if (!profile || resetInProgress.current) return;
    resetInProgress.current = true;
    setResetError(null);
    try {
      await hkFetch<void>('/v1/auth/password-reset', {
        method: 'POST',
        body: { email: profile.email },
      });
      setResetSent(true);
      setTimeout(() => {
        setResetSent(false);
        resetInProgress.current = false;
      }, PASSWORD_RESET_COOLDOWN_MS);
    } catch {
      resetInProgress.current = false;
      setResetError('Could not send reset email. Please try again later.');
    }
  }

  if (loadState === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="font-serif text-lg text-warm-neutral-700">Loading your profile…</p>
      </main>
    );
  }

  if (loadState === 'error' || !profile) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p role="alert" className="font-serif text-lg text-warm-neutral-700">
          We couldn&apos;t load your account. Please try again later.
        </p>
      </main>
    );
  }

  const isEmailProvider = profile.auth_providers.includes('email');
  const oauthProvider = profile.auth_providers.find((p) => p !== 'email');

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto w-full max-w-md space-y-8">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl">Your account</h1>
          <p className="text-sm text-warm-neutral-700">
            Update your details. Changes apply only to your profile.
          </p>
        </header>

        <form onSubmit={handleSave} className="space-y-5" noValidate>
          <div className="space-y-1">
            <label htmlFor="display_name" className="block text-sm">Display name</label>
            <input
              id="display_name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              className="w-full rounded border border-warm-neutral-300 px-3 py-2"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="preferred_language" className="block text-sm">Preferred language</label>
            <input
              id="preferred_language"
              type="text"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
              maxLength={10}
              className="w-full rounded border border-warm-neutral-300 px-3 py-2"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm">Email</label>
            {!editingEmail ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-warm-neutral-700">{profile.email}</p>
                {isEmailProvider && (
                  <button
                    type="button"
                    onClick={() => setEditingEmail(true)}
                    className="text-sm underline"
                  >
                    Change email
                  </button>
                )}
              </div>
            ) : (
              <input
                id="email"
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                maxLength={254}
                className="w-full rounded border border-warm-neutral-300 px-3 py-2"
              />
            )}
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-red-700">{saveError}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded bg-honey-amber-600 py-2 text-white"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <section className="space-y-3 border-t border-warm-neutral-200 pt-6">
          <h2 className="font-serif text-xl">Password</h2>
          {isEmailProvider ? (
            <>
              <button
                type="button"
                onClick={() => void handlePasswordReset()}
                disabled={resetSent}
                className="w-full rounded border border-warm-neutral-300 py-2"
              >
                {resetSent ? 'Check your inbox — a reset link has been sent' : 'Send password reset email'}
              </button>
              {resetError && (
                <p role="alert" className="text-sm text-red-700">{resetError}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-warm-neutral-700">
              Your account is managed at {oauthProvider ?? 'your provider'}.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
