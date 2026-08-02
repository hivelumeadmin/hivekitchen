import { useState } from 'react';
import type { UserProfile } from '@hivekitchen/types';
import { ParentalNoticeView } from '@/features/compliance/ParentalNoticeView.js';

interface PrivacyPanelProps {
  profile: UserProfile;
}

export function PrivacyPanel({ profile }: PrivacyPanelProps) {
  const [showNotice, setShowNotice] = useState(false);

  return (
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
  );
}
