import { useState } from 'react';
import type { UpdateProfileRequest, UserProfile } from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';
import { useUpdateProfileMutation } from './mutations.js';

interface ProfilePanelProps {
  profile: UserProfile;
}

export function ProfilePanel({ profile }: ProfilePanelProps) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [preferredLanguage, setPreferredLanguage] = useState(profile.preferred_language);
  const [emailDraft, setEmailDraft] = useState(profile.email);
  const [editingEmail, setEditingEmail] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateProfile = useUpdateProfileMutation();
  const isEmailProvider = profile.auth_providers.includes('email');

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    updateProfile.mutate(body, {
      onSuccess: (updated) => {
        setDisplayName(updated.display_name ?? '');
        setPreferredLanguage(updated.preferred_language);
        setEmailDraft(updated.email);
        setEditingEmail(false);
      },
      onError: (err) => {
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
      },
    });
  }

  return (
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
        disabled={updateProfile.isPending}
        className="w-full rounded bg-amber-warm py-2 font-medium text-bg transition-colors hover:bg-amber motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm focus-visible:ring-offset-2"
      >
        {updateProfile.isPending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
