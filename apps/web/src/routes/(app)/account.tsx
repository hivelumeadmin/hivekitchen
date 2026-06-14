import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import {
  type UserProfile,
  type UpdateProfileRequest,
  type NotificationPrefs,
  type CulturalLanguagePreference,
  type KitchenMap,
  type VoiceTranscriptItem,
  type VoiceRetentionMode,
  CULTURAL_LANGUAGE_VALUES,
} from '@hivekitchen/types';
import { hkFetch, hkFetchBlob, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useComplianceStore } from '@/stores/compliance.store.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { ParentalNoticeView } from '@/features/compliance/ParentalNoticeView.js';
import { PageHeader } from '@/components/PageHeader.js';
import { Dialog } from '@/components/Dialog.js';

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
  useLumiContext({ surface: 'general' });
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
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
    proactive_lumi_nudges: true,
  });
  const [notifSavingField, setNotifSavingField] = useState<keyof NotificationPrefs | null>(null);
  const [notifError, setNotifError] = useState<string | null>(null);

  const [culturalLanguage, setCulturalLanguage] = useState<CulturalLanguagePreference>('default');
  const [culturalSaving, setCulturalSaving] = useState(false);
  const [culturalError, setCulturalError] = useState<string | null>(null);

  // Slice 5-S13 — caption-only (Text only) accessibility preference.
  const [captionOnlyMode, setCaptionOnlyModeLocal] = useState(false);
  const [captionOnlySaving, setCaptionOnlySaving] = useState(false);
  const [captionOnlyError, setCaptionOnlyError] = useState<string | null>(null);

  // Slice 5-S15 — voice transcript retention controls.
  const [voiceRetentionMode, setVoiceRetentionMode] = useState<VoiceRetentionMode>('standard');
  const [voiceTranscripts, setVoiceTranscripts] = useState<VoiceTranscriptItem[]>([]);
  const [voiceRetentionLoading, setVoiceRetentionLoading] = useState(false);
  const [voiceRetentionError, setVoiceRetentionError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState<'json' | 'pdf' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [exportState, setExportState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [householdDisplayName, setHouseholdDisplayName] = useState<string | null>(null);
  const [householdDisplayNameLoading, setHouseholdDisplayNameLoading] = useState(false);
  const [householdDisplayNameError, setHouseholdDisplayNameError] = useState(false);
  const [deleteState, setDeleteState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');

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
        // Story 12-S12 — keep the in-panel nudge toggle (lumi store) in sync with
        // the canonical value loaded here.
        useLumiStore.getState().setProactiveNudges(result.notification_prefs.proactive_lumi_nudges);
        setCulturalLanguage(result.cultural_language);
        // Slice 5-S13 — hydrate the local toggle + the lumi store flag the
        // voice hook reads (same pattern as proactiveNudges above).
        setCaptionOnlyModeLocal(result.caption_only_mode);
        useLumiStore.getState().setCaptionOnlyMode(result.caption_only_mode);
        // Slice 5-S15 — hydrate the toggle from the profile (instant), then refine
        // mode + load the transcript list from the dedicated endpoint.
        setVoiceRetentionMode(result.voice_retention_mode);
        setAcknowledgmentState(
          result.parental_notice_acknowledged_at,
          result.parental_notice_acknowledged_version,
        );
        setLoadState('ready');
        try {
          const voiceData = await hkFetch<{
            transcripts: VoiceTranscriptItem[];
            voice_retention_mode: VoiceRetentionMode;
          }>('/v1/users/me/voice-transcripts', { method: 'GET' });
          setVoiceRetentionMode(voiceData.voice_retention_mode ?? 'standard');
          setVoiceTranscripts(voiceData.transcripts ?? []);
        } catch {
          // fail-open: the Voice Data section renders with defaults
        }
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
      useLumiStore.getState().setProactiveNudges(updated.notification_prefs.proactive_lumi_nudges);
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

  // Slice 5-S13 — toggle the caption-only accessibility preference. Optimistic
  // UI: flip the local + store state immediately, reconcile from the response,
  // revert on error (mirrors handleCulturalLanguageChange / notification toggles).
  async function handleAccessibilityToggle(checked: boolean) {
    if (!profile) return;
    const previous = captionOnlyMode;
    setCaptionOnlyError(null);
    setCaptionOnlySaving(true);
    setCaptionOnlyModeLocal(checked);
    useLumiStore.getState().setCaptionOnlyMode(checked);
    try {
      const updated = await hkFetch<UserProfile>('/v1/users/me/accessibility', {
        method: 'PATCH',
        body: { caption_only_mode: checked },
      });
      setProfile(updated);
      setCaptionOnlyModeLocal(updated.caption_only_mode);
      useLumiStore.getState().setCaptionOnlyMode(updated.caption_only_mode);
    } catch {
      setCaptionOnlyModeLocal(previous);
      useLumiStore.getState().setCaptionOnlyMode(previous);
      setCaptionOnlyError('Could not update accessibility setting. Please try again.');
    } finally {
      setCaptionOnlySaving(false);
    }
  }

  // Slice 5-S15 — toggle voice retention mode. Optimistic: flip the mode and (on
  // immediate-delete) clear the transcript list immediately, then PATCH. Revert
  // both on failure (AC10).
  async function handleVoiceRetentionToggle(immediate: boolean) {
    setVoiceRetentionError(null);
    const newMode: VoiceRetentionMode = immediate ? 'immediate_delete' : 'standard';
    const prevMode = voiceRetentionMode;
    const prevTranscripts = voiceTranscripts;

    setVoiceRetentionMode(newMode);
    if (newMode === 'immediate_delete') setVoiceTranscripts([]);

    setVoiceRetentionLoading(true);
    try {
      await hkFetch('/v1/users/me/voice-retention', {
        method: 'PATCH',
        body: { voice_retention_mode: newMode },
      });
    } catch {
      setVoiceRetentionMode(prevMode);
      setVoiceTranscripts(prevTranscripts);
      setVoiceRetentionError('Could not update voice data setting. Please try again.');
    } finally {
      setVoiceRetentionLoading(false);
    }
  }

  // Slice 4-S17 — download the household's allergy transparency log (JSON or
  // PDF). The endpoint returns a binary/non-JSON body, so it uses hkFetchBlob
  // (not hkFetch). The synthetic-anchor click is the only reliable cross-browser
  // way to save a same-origin response instead of navigating to it.
  async function handleDownload(format: 'json' | 'pdf') {
    setDownloadError(null);
    setDownloading(format);
    try {
      const blob = await hkFetchBlob('/v1/heart-notes/transparency-log', {
        method: 'POST',
        body: { format },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `allergy-log-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('Could not download your allergy log. Please try again later.');
    } finally {
      setDownloading(null);
    }
  }

  // Slice 7-S10 — request a full data-portability export. The POST returns 202
  // (the snapshot is composed asynchronously and emailed as a signed link); the
  // success copy replaces the button. No polling, no redirect.
  async function handleExport() {
    setExportState('pending');
    try {
      await hkFetch<unknown>(`/v1/households/${householdId ?? ''}/export`, { method: 'POST' });
      setExportState('success');
    } catch (err) {
      if (err instanceof HkApiError && err.status === 401) {
        navigate('/auth/login?next=/account', { replace: true });
        return;
      }
      setExportState('error');
    }
  }

  // Slice 7-S11 — account deletion. The confirmation dialog requires the parent
  // to type the household display_name, fetched lazily from the kitchen-map
  // projection the first time the dialog opens (the user profile carries the
  // caregiver's name, not the household label).
  async function handleOpenDeleteDialog() {
    setShowDeleteDialog(true);
    setDeleteConfirmInput('');
    setDeleteState('idle');
    if (householdDisplayName !== null || householdId === null) return;
    setHouseholdDisplayNameError(false);
    setHouseholdDisplayNameLoading(true);
    try {
      const map = await hkFetch<KitchenMap>(`/v1/households/${householdId}/kitchen-map`, {
        method: 'GET',
      });
      setHouseholdDisplayName(map.household.display_name ?? null);
    } catch {
      setHouseholdDisplayName(null);
      setHouseholdDisplayNameError(true);
    } finally {
      setHouseholdDisplayNameLoading(false);
    }
  }

  async function handleDeleteAccount() {
    if (householdId === null || householdDisplayName === null) return;
    setDeleteState('pending');
    try {
      await hkFetch<unknown>(`/v1/households/${householdId}/delete`, {
        method: 'POST',
        body: { confirmation_name: deleteConfirmInput },
      });
      setDeleteState('success');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await useAuthStore.getState().logout();
      navigate('/auth/login', { replace: true });
    } catch (err) {
      if (err instanceof HkApiError && err.status === 401) {
        navigate('/auth/login?next=/account', { replace: true });
        return;
      }
      setDeleteState('error');
    }
  }

  if (loadState === 'loading') {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-grow items-center justify-center px-6 py-24">
        <p className="font-serif text-lg text-fg-muted">Loading your profile…</p>
      </main>
    );
  }

  if (loadState === 'error' || !profile) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-grow items-center justify-center px-6 py-24">
        <p role="alert" className="font-serif text-lg text-fg-muted">
          We couldn&apos;t load your account. Please try again later.
        </p>
      </main>
    );
  }

  const isEmailProvider = profile.auth_providers.includes('email');
  const oauthProvider = profile.auth_providers.find((p) => p !== 'email');
  const culturalLanguageLocked = profile.cultural_language !== 'default';

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <PageHeader
        eyebrow="Settings"
        headlineSize="md"
        description="Update your details. Changes apply only to your profile."
        className="mb-12"
      >
        Your account
      </PageHeader>
      <div className="mx-auto w-full max-w-md space-y-8">
        <form onSubmit={handleSave} className="space-y-5" noValidate>
          <div className="space-y-1">
            <label htmlFor="display_name" className="block text-sm">Display name</label>
            <input
              id="display_name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              className="w-full rounded border border-border px-3 py-2"
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
              className="w-full rounded border border-border px-3 py-2"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm">Email</label>
            {!editingEmail ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-fg-muted">{profile.email}</p>
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
                className="w-full rounded border border-border px-3 py-2"
              />
            )}
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-safety-red">{saveError}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded bg-amber-warm py-2 font-medium text-bg transition-colors hover:bg-amber motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm focus-visible:ring-offset-2"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-xl text-fg">Password</h2>
          {isEmailProvider ? (
            <>
              <button
                type="button"
                onClick={() => void handlePasswordReset()}
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

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-xl text-fg">Notifications</h2>
          <p className="text-sm text-fg-muted">
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
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">Lumi proactive nudges</span>
            <input
              type="checkbox"
              checked={notifPrefs.proactive_lumi_nudges}
              onChange={(e) =>
                void handleNotificationToggle('proactive_lumi_nudges', e.target.checked)
              }
              disabled={notifSavingField !== null}
              className="h-4 w-4"
            />
          </label>
          {notifError && (
            <p role="alert" className="text-sm text-safety-red">{notifError}</p>
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-xl text-fg">Accessibility</h2>
          <p className="text-sm text-fg-muted">
            Captions stream normally — Lumi&apos;s voice reply won&apos;t auto-play.
          </p>
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">Text only — captions without audio</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Text only — captions without audio"
              checked={captionOnlyMode}
              onChange={(e) => void handleAccessibilityToggle(e.target.checked)}
              disabled={captionOnlySaving}
              className="h-4 w-4"
            />
          </label>
          {captionOnlyError && (
            <p role="alert" className="text-sm text-safety-red">{captionOnlyError}</p>
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-xl text-fg">Voice Data</h2>
          <p className="text-sm text-fg-muted">
            When on, Lumi forgets your voice turns as soon as they&apos;re processed. When off,
            transcripts are kept for 90 days.
          </p>
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">Delete transcripts immediately</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Delete transcripts immediately"
              checked={voiceRetentionMode === 'immediate_delete'}
              onChange={(e) => void handleVoiceRetentionToggle(e.target.checked)}
              disabled={voiceRetentionLoading}
              className="h-4 w-4"
            />
          </label>
          {voiceRetentionError && (
            <p role="alert" className="text-sm text-safety-red">{voiceRetentionError}</p>
          )}

          {voiceRetentionMode === 'standard' && voiceTranscripts.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-fg-muted">Recent voice transcripts</p>
              <ul className="space-y-2">
                {voiceTranscripts.map((t) => {
                  const daysLeft = Math.ceil(
                    (new Date(t.retention_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                  );
                  return (
                    <li key={t.id} className="rounded border border-border p-3 text-sm text-fg">
                      <p className="line-clamp-2">{t.transcript}</p>
                      <p className="mt-1 text-fg-muted">
                        {daysLeft > 0
                          ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
                          : 'Expiring soon'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {voiceRetentionMode === 'standard' && voiceTranscripts.length === 0 && (
            <p className="pt-1 text-sm text-fg-muted">No voice transcripts yet.</p>
          )}

          {voiceRetentionMode === 'immediate_delete' && (
            <p className="pt-1 text-sm text-fg-muted">
              Your voice transcripts are deleted immediately and not stored.
            </p>
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-xl text-fg">Family language</h2>
          <p className="text-sm text-fg-muted">
            How Lumi refers to family members in your household.
          </p>
          <select
            aria-label="Family language"
            value={culturalLanguage}
            onChange={(e) =>
              void handleCulturalLanguageChange(e.target.value as CulturalLanguagePreference)
            }
            disabled={culturalSaving}
            className="w-full rounded border border-border px-3 py-2"
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
            <p className="text-sm text-fg-muted">
              Family language cannot be changed back once set.
            </p>
          )}
          {culturalError && (
            <p role="alert" className="text-sm text-safety-red">{culturalError}</p>
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-xl text-fg">Privacy &amp; Data</h2>
          {profile.parental_notice_acknowledged_at !== null ? (
            <p className="text-sm text-fg-muted">
              You acknowledged our parental notice on{' '}
              {new Date(profile.parental_notice_acknowledged_at).toLocaleDateString()}{' '}
              (version {profile.parental_notice_acknowledged_version ?? 'unknown'}).
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
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
            <div className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
              <ParentalNoticeView />
            </div>
          )}
        </section>

        {(profile.role === 'primary_parent' || profile.role === 'secondary_caregiver') && (
          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="font-serif text-xl text-fg">Allergy safety log</h2>
            <p className="text-sm text-fg-muted">
              Download a record of every allergy safety decision Lumi has made for your household.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleDownload('json')}
                disabled={downloading !== null}
                className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
              >
                {downloading === 'json' ? 'Preparing…' : 'Download JSON'}
              </button>
              <button
                type="button"
                onClick={() => void handleDownload('pdf')}
                disabled={downloading !== null}
                className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
              >
                {downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}
              </button>
            </div>
            {downloadError && (
              <p role="alert" className="text-sm text-safety-red">{downloadError}</p>
            )}
          </section>
        )}

        {profile.role === 'primary_parent' && (
          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="font-serif text-xl text-fg">Data portability</h2>
            <p className="text-sm text-fg-muted">
              Download a copy of everything HiveKitchen has stored for your household.
              Encrypted fields are decrypted to plain text in the export.
            </p>
            {exportState === 'success' ? (
              <p className="text-sm text-fg-muted">
                We&apos;re preparing your export. You&apos;ll receive an email with a download link within 72 hours.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={exportState === 'pending'}
                  className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
                >
                  {exportState === 'pending' ? 'Exporting…' : 'Export my data'}
                </button>
                {exportState === 'error' && (
                  <p role="alert" className="text-sm text-safety-red">
                    Something went wrong. Please try again.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {profile.role === 'primary_parent' && (
          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="font-serif text-xl text-fg">Delete account</h2>
            <p className="text-sm text-fg-muted">
              Permanently delete your household and all associated data. This cannot be undone.
            </p>
            <button
              type="button"
              onClick={() => void handleOpenDeleteDialog()}
              className="rounded border border-border px-4 py-2 text-sm"
            >
              Delete my account
            </button>
          </section>
        )}
      </div>

      <Dialog
        open={showDeleteDialog}
        onClose={() => {
          if (deleteState === 'pending' || deleteState === 'success') return;
          setShowDeleteDialog(false);
          setDeleteConfirmInput('');
          setDeleteState('idle');
        }}
        titleId="delete-account-dialog-title"
        descriptionId="delete-account-dialog-desc"
      >
        <div className="flex flex-col gap-4">
          <h2 id="delete-account-dialog-title" className="font-serif text-xl text-fg">
            Delete your account permanently?
          </h2>
          <p id="delete-account-dialog-desc" className="text-sm text-fg-muted">
            All household data — plans, children, memory, Heart Notes — will be erased within 30
            days. You will be logged out immediately and cannot log back in.
          </p>

          {householdDisplayNameLoading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : householdDisplayName !== null ? (
            <div className="space-y-1">
              <label htmlFor="delete-confirm-input" className="block text-sm">
                {`Type "${householdDisplayName}" to confirm`}
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                disabled={deleteState === 'pending' || deleteState === 'success'}
                className="w-full rounded border border-border px-3 py-2 disabled:opacity-50"
                placeholder={householdDisplayName}
                autoComplete="off"
              />
            </div>
          ) : householdDisplayNameError ? (
            <p className="text-sm text-fg-muted">
              Could not load your household name. Please close and try again.
            </p>
          ) : null}

          {deleteState === 'error' && (
            <p role="alert" className="text-sm text-safety-red">
              Something went wrong. Please try again.
            </p>
          )}

          {deleteState === 'success' ? (
            <p className="text-sm text-fg-muted">Account deletion scheduled. Logging you out…</p>
          ) : (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirmInput('');
                  setDeleteState('idle');
                }}
                disabled={deleteState === 'pending'}
                className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={
                  deleteState === 'pending' ||
                  householdDisplayName === null ||
                  deleteConfirmInput.trim().toLowerCase() !==
                    householdDisplayName.trim().toLowerCase()
                }
                className="rounded border border-border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteState === 'pending' ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          )}
        </div>
      </Dialog>
    </main>
  );
}
