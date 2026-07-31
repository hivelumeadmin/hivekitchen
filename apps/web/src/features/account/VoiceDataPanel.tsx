import { useState } from 'react';
import type { UserProfile, VoiceRetentionMode } from '@hivekitchen/types';
import { useVoiceTranscriptsQuery } from './queries.js';
import { useVoiceRetentionMutation } from './mutations.js';

interface VoiceDataPanelProps {
  profile: UserProfile;
  userId: string | null;
}

// Slice 5-S15 — voice transcript retention controls. The profile carries the
// mode for an instant first paint; the dedicated endpoint refines it and
// supplies the list. When that leg fails the panel keeps the profile's mode
// with an empty list (fail-open).
export function VoiceDataPanel({ profile, userId }: VoiceDataPanelProps) {
  const [voiceRetentionError, setVoiceRetentionError] = useState<string | null>(null);
  const voiceTranscripts = useVoiceTranscriptsQuery(userId);
  const voiceRetention = useVoiceRetentionMutation();

  const voiceRetentionMode: VoiceRetentionMode =
    voiceTranscripts.data !== undefined
      ? (voiceTranscripts.data.voice_retention_mode ?? 'standard')
      : profile.voice_retention_mode;
  const transcripts = voiceTranscripts.data?.transcripts ?? [];

  function handleToggle(immediate: boolean) {
    setVoiceRetentionError(null);
    voiceRetention.mutate(immediate ? 'immediate_delete' : 'standard', {
      onError: () => setVoiceRetentionError('Could not update voice data setting. Please try again.'),
    });
  }

  return (
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
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={voiceRetention.isPending}
          className="h-4 w-4"
        />
      </label>
      {voiceRetentionError && (
        <p role="alert" className="text-sm text-safety-red">{voiceRetentionError}</p>
      )}

      {voiceRetentionMode === 'standard' && transcripts.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-sm text-fg-muted">Recent voice transcripts</p>
          <ul className="space-y-2">
            {transcripts.map((t) => {
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

      {voiceRetentionMode === 'standard' && transcripts.length === 0 && (
        <p className="pt-1 text-sm text-fg-muted">No voice transcripts yet.</p>
      )}

      {voiceRetentionMode === 'immediate_delete' && (
        <p className="pt-1 text-sm text-fg-muted">
          Your voice transcripts are deleted immediately and not stored.
        </p>
      )}
    </section>
  );
}
