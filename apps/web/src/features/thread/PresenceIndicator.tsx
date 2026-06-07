import type { SurfaceKind } from '@hivekitchen/types';
import { usePresence } from '@/hooks/usePresence.js';

interface PresenceIndicatorProps {
  // `kind` selects the presence surface; `id` is the household id (the presence
  // namespace until the family thread ships in 5-S3). Per UX-DR26.
  surface: { kind: SurfaceKind; id: string };
  className?: string;
}

// Story 5-S1 — live multi-tab presence. Self-manages the heartbeat lifecycle via
// usePresence and renders the partner-active affordance. No motion states in
// 5-S1 (UX-DR26 viewing/editing distinction deferred to a later slice).
export function PresenceIndicator({ surface, className }: PresenceIndicatorProps) {
  const { partners } = usePresence(surface.kind);

  if (partners.length === 0) return null;

  const label =
    partners.length === 1
      ? `${partners[0]!.display_name ?? 'Someone'} is also on Brief`
      : `${partners.length} others on Brief`;

  const initial =
    partners.length === 1 && partners[0]!.display_name
      ? partners[0]!.display_name.charAt(0).toUpperCase()
      : null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1 font-sans text-[13px] text-warm-neutral-600 ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warm-neutral-200 text-[11px] text-warm-neutral-600"
      >
        {initial}
      </span>
      <span>{label}</span>
    </span>
  );
}
