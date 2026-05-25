export type FreshnessVariant = 'fresh' | 'stale' | 'loading' | 'failed' | 'offline' | 'reworking';

interface FreshnessStateProps {
  variant: FreshnessVariant;
  lastSyncedAt?: string;
  failedAt?: string;  // only consumed by 'reworking' variant
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0 || isNaN(diff)) return 'just now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// Story 3.26 — exported for independent unit testing without React rendering.
// Specific to FreshnessState; do NOT promote to lib/.
export function formatEstimatedRecovery(failedAt: string | undefined): string {
  if (failedAt === undefined) return 'within the hour';
  const eta = new Date(new Date(failedAt).getTime() + 3_600_000);
  if (isNaN(eta.getTime())) return 'within the hour';
  if (eta.getTime() <= Date.now()) return 'soon';
  return eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const STATIC_MESSAGES: Record<Exclude<FreshnessVariant, 'fresh' | 'stale' | 'reworking'>, string> = {
  loading: "Lumi is drafting this week's plan. About 30 seconds.",
  failed: "Lumi couldn't reach the plan right now.",
  offline: "You're offline. Yesterday's plan below.",
};

export function FreshnessState({ variant, lastSyncedAt, failedAt }: FreshnessStateProps) {
  if (variant === 'fresh') return null;

  if (variant === 'stale') {
    const timeText =
      lastSyncedAt !== undefined
        ? `last synced ${formatRelativeTime(lastSyncedAt)}`
        : undefined;
    return (
      <p
        className="inline-flex items-center gap-1.5 mt-2 font-sans text-[13px] text-fg-muted"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-foliage motion-safe:animate-pulse"
        />
        {timeText !== undefined ? `Checking… ${timeText}` : 'Checking…'}
      </p>
    );
  }

  if (variant === 'reworking') {
    const eta = formatEstimatedRecovery(failedAt);
    return (
      <p
        className="mt-2 font-sans text-[13px] text-fg-muted"
        role="status"
        aria-live="polite"
      >
        {`Lumi is reworking this week's plan. We'll have it ready by ${eta}.`}
      </p>
    );
  }

  return (
    <p
      className="mt-2 font-sans text-[13px] text-fg-muted"
      role="status"
      aria-live="polite"
    >
      {STATIC_MESSAGES[variant]}
    </p>
  );
}
