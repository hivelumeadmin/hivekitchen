import { useState } from 'react';
import type { UserProfile } from '@hivekitchen/types';
import { useAccessibilityMutation } from './mutations.js';

interface AccessibilityPanelProps {
  profile: UserProfile;
}

// Slice 5-S13 — caption-only (Text only) accessibility preference.
export function AccessibilityPanel({ profile }: AccessibilityPanelProps) {
  const [captionOnlyError, setCaptionOnlyError] = useState<string | null>(null);
  const accessibility = useAccessibilityMutation();

  function handleToggle(checked: boolean) {
    setCaptionOnlyError(null);
    accessibility.mutate(checked, {
      onError: () => setCaptionOnlyError('Could not update accessibility setting. Please try again.'),
    });
  }

  return (
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
          checked={profile.caption_only_mode}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={accessibility.isPending}
          className="h-4 w-4"
        />
      </label>
      {captionOnlyError && (
        <p role="alert" className="text-sm text-safety-red">{captionOnlyError}</p>
      )}
    </section>
  );
}
