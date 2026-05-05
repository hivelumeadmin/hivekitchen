import type { SurfaceKind } from '@hivekitchen/types';

interface PresenceIndicatorProps {
  surface: { kind: SurfaceKind; id: string };
  partnerName?: string;
  className?: string;
}

// Minimal presence affordance — visible when partnerName is provided.
// SSE wiring (presence.partner-active subscription via the surface prop)
// arrives with Story 5.2; until then, the parent passes partnerName
// explicitly when it wants to render the locked-by-partner state.
export function PresenceIndicator({
  partnerName,
  className,
}: PresenceIndicatorProps) {
  if (partnerName === undefined || partnerName === '') return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1 font-sans text-[13px] text-warm-neutral-600 ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-5 w-5 rounded-full bg-sacred-200"
      />
      <span>{partnerName} is editing</span>
    </span>
  );
}
