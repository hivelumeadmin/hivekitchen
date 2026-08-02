import { useLumiStore } from '@/stores/lumi.store.js';
import { useVoiceSessionContext } from '@/contexts/VoiceSessionContext.js';
import { LumiSheet, LUMI_SHEET_ID } from './LumiSheet.js';
import { LumiWhisper } from './LumiWhisper.js';

// Epic 13-s2 — the valet presence primitive. Replaces LumiOrb + LumiPanel.
// At rest: a small, quiet breathing dot in the corner (valet rule 2). Tap →
// summons the focused <LumiSheet>, which runs a turn and recedes (valet rule 5).
// The whisper line (presenceState === 'whisper') is rendered by 13-s3; this
// slice drives atRest ↔ summoned only.
export function LumiPresence() {
  const presenceState = useLumiStore((s) => s.presenceState);
  const voiceStatus = useLumiStore((s) => s.voiceStatus);
  const pendingNudge = useLumiStore((s) => s.pendingNudge);
  const lumiThinking = useLumiStore((s) => s.lumiThinking);
  const { endSession } = useVoiceSessionContext();

  const isSummoned = presenceState === 'summoned';
  const isVoiceActive = voiceStatus === 'active';
  const hasNudge = pendingNudge !== null;

  // The dot breathes when Lumi has a pending nudge AND the dot is the only
  // nudge surface (presenceState === 'atRest'). In whisper state the line IS
  // the signal — breathing simultaneously would be redundant. Suppressed during
  // voice session (the ping overlay shows live state). Static under reduced motion.
  const restingBreath =
    !isVoiceActive && hasNudge && presenceState === 'atRest'
      ? 'animate-pulse motion-reduce:animate-none'
      : '';

  const ariaLabel = isVoiceActive ? 'End voice session' : isSummoned ? 'Lumi is open' : 'Open Lumi';

  function handleClick() {
    if (isVoiceActive) {
      void endSession();
      return;
    }
    if (isSummoned) {
      useLumiStore.getState().recede();
      return;
    }
    useLumiStore.getState().summon();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        data-lumi-dot
        aria-label={ariaLabel}
        aria-expanded={isSummoned}
        aria-controls={LUMI_SHEET_ID}
        className={[
          'fixed bottom-6 right-6 z-40',
          'h-9 w-9 rounded-full',
          'bg-lumi-terracotta text-white shadow-md',
          'ring-1 ring-[color-mix(in_srgb,var(--lumi-terracotta-700)_20%,transparent)]',
          'hover:bg-lumi-terracotta-warmed transition-colors motion-reduce:transition-none',
          'focus:outline-none focus:ring-2 focus:ring-foliage focus:ring-offset-2',
          restingBreath,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isVoiceActive && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-lumi-terracotta-400 opacity-75 animate-ping motion-reduce:animate-none"
          />
        )}
        {/* Slice 5-S6 — non-verbal "thinking" pulse during the STT→reply gap.
            A calmer animate-pulse (distinct from the voice-active ping); static
            under reduced motion. Decorative → aria-hidden. */}
        {lumiThinking && (
          <span
            data-testid="lumi-thinking-pulse"
            aria-hidden="true"
            className="absolute -inset-1 rounded-full bg-[color-mix(in_srgb,var(--foliage)_40%,transparent)] animate-pulse motion-reduce:animate-none"
          />
        )}
      </button>

      <LumiWhisper />
      <LumiSheet />
    </>
  );
}
