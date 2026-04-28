import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import {
  type UserProfile,
  type UpdateProfileRequest,
  type NotificationPrefs,
  type CulturalLanguagePreference,
  CULTURAL_LANGUAGE_VALUES,
} from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useComplianceStore } from '@/stores/compliance.store.js';
import { ParentalNoticeView } from '@/features/compliance/ParentalNoticeView.js';

type LoadState = 'loading' | 'ready' | 'error';

const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

const CULTURAL_LANGUAGE_LABELS: { [K in CulturalLanguagePreference]: string } = {
  default: 'English (Grandma, Grandpa)',
  south_asian: 'South Asian (Nani, Nana, Dadi, Dada)',
  hispanic: 'Spanish (Abuela, Abuelo)',
  east_african: 'East African (Swahili)',
  middle_eastern: 'Middle Eastern (Teta, Jiddo)',
  east_asian: 'East Asian',
  caribbean: 'Caribbean',
};

const CULTURAL_LANGUAGE_OPTIONS = CULTURAL_LANGUAGE_VALUES.map((value) => ({
  value,
  label: CULTURAL_LANGUAGE_LABELS[value],
}));

export default function AccountPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAcknowledgmentState = useComplianceStore((s) => s.setAcknowledgmentState);
  const didLoad = useRef(false);
  const resetInProgress = useRef(false);
  const [showNotice, setShowNotice] = useState(false);

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

  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    weekly_plan_ready: true,
    grocery_list_ready: true,
  });
  const [notifSavingField, setNotifSavingField] = useState<keyof NotificationPrefs | null>(null);
  const [notifError, setNotifError] = useState<string | null>(null);

  const [culturalLanguage, setCulturalLanguage] = useState<CulturalLanguagePreference>('default');
  const [culturalSaving, setCulturalSaving] = useState(false);
  const [culturalError, setCulturalError] = useState<string | null>(null);

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
        setNotifPrefs(result.notification_prefs);
        setCulturalLanguage(result.cultural_language);
        setAcknowledgmentState(
          result.parental_notice_acknowledged_at,
          result.parental_notice_acknowledged_version,
        );
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

  async function handleNotificationToggle(field: keyof NotificationPrefs, checked: boolean) {
    if (!profile) return;
    const previous = profile.notification_prefs;
    setNotifError(null);
    setNotifSavingField(field);
    // Optimistic UI: reflect the toggle immediately, reconcile from server response.
    setNotifPrefs({ ...previous, [field]: checked });
    try {
      const updated = await hkFetch<UserProfile>('/v1/users/me/notifications', {
        method: 'PATCH',
        body: { [field]: checked },
      });
      setProfile(updated);
      setNotifPrefs(updated.notification_prefs);
    } catch {
      setNotifPrefs(previous);
      setNotifError('Could not update notification preference. Please try again.');
    } finally {
      setNotifSavingField(null);
    }
  }

  async function handleCulturalLanguageChange(value: CulturalLanguagePreference) {
    if (!profile) return;
    const previous = culturalLanguage;
    setCulturalError(null);
    setCulturalSaving(true);
    setCulturalLanguage(value);
    try {
      const updated = await hkFetch<UserProfile>('/v1/users/me/preferences', {
        method: 'PATCH',
        body: { cultural_language: value },
      });
      setProfile(updated);
      setCulturalLanguage(updated.cultural_language);
    } catch (err) {
      setCulturalLanguage(previous);
      if (err instanceof HkApiError && err.status === 409) {
        setCulturalError('Family language cannot be changed back once set.');
      } else if (err instanceof HkApiError && err.status === 400) {
        setCulturalError('That option is not valid.');
      } else {
        setCulturalError('Could not update family language. Please try again.');
      }
    } finally {
      setCulturalSaving(false);
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
  const culturalLanguageLocked = profile.cultural_language !== 'default';

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

        <section className="space-y-3 border-t border-warm-neutral-200 pt-6">
          <h2 className="font-serif text-xl">Notifications</h2>
          <p className="text-sm text-warm-neutral-700">
            Choose when Lumi reaches out. Toggle anytime.
          </p>
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">Weekly plan is ready</span>
            <input
              type="checkbox"
              checked={notifPrefs.weekly_plan_ready}
              onChange={(e) =>
                void handleNotificationToggle('weekly_plan_ready', e.target.checked)
              }
              disabled={notifSavingField !== null}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">Grocery list is ready</span>
            <input
              type="checkbox"
              checked={notifPrefs.grocery_list_ready}
              onChange={(e) =>
                void handleNotificationToggle('grocery_list_ready', e.target.checked)
              }
              disabled={notifSavingField !== null}
              className="h-4 w-4"
            />
          </label>
          {notifError && (
            <p role="alert" className="text-sm text-red-700">{notifError}</p>
          )}
        </section>

        <section className="space-y-3 border-t border-warm-neutral-200 pt-6">
          <h2 className="font-serif text-xl">Family language</h2>
          <p className="text-sm text-warm-neutral-700">
            How Lumi refers to family members in your household.
          </p>
          <select
            aria-label="Family language"
            value={culturalLanguage}
            onChange={(e) =>
              void handleCulturalLanguageChange(e.target.value as CulturalLanguagePreference)
            }
            disabled={culturalSaving}
            className="w-full rounded border border-warm-neutral-300 px-3 py-2"
          >
            {CULTURAL_LANGUAGE_OPTIONS.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={opt.value === 'default' && culturalLanguageLocked}
              >
                {opt.label}
              </option>
            ))}
          </select>
          {culturalLanguageLocked && (
            <p className="text-sm text-warm-neutral-700">
              Family language cannot be changed back once set.
            </p>
          )}
          {culturalError && (
            <p role="alert" className="text-sm text-red-700">{culturalError}</p>
          )}
        </section>

        <section className="space-y-3 border-t border-warm-neutral-200 pt-6">
          <h2 className="font-serif text-xl">Privacy &amp; Data</h2>
          {profile.parental_notice_acknowledged_at !== null ? (
            <p className="text-sm text-warm-neutral-700">
              You acknowledged our parental notice on{' '}
              {new Date(profile.parental_notice_acknowledged_at).toLocaleDateString()}{' '}
              (version {profile.parental_notice_acknowledged_version ?? 'unknown'}).
            </p>
          ) : (
            <p className="text-sm text-warm-neutral-700">
              You haven&apos;t read our parental notice yet.
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowNotice((v) => !v)}
            className="text-sm underline"
          >
            {showNotice ? 'Hide the parental notice' : 'Read the parental notice'}
          </button>
          {showNotice && (
            <div className="mt-3 rounded-2xl border border-warm-neutral-200 bg-warm-neutral-50 px-4 py-3">
              <ParentalNoticeView />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
