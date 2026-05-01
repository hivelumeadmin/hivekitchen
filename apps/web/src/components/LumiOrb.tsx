import { useLumiStore } from '@/stores/lumi.store.js';

export function LumiOrb() {
  const isPanelOpen = useLumiStore((s) => s.isPanelOpen);
  const voiceStatus = useLumiStore((s) => s.voiceStatus);
  const pendingNudge = useLumiStore((s) => s.pendingNudge);

  const isVoiceActive = voiceStatus === 'active';
  const hasNudge = pendingNudge !== null;

  // AC4: breathing only when panel is closed. Voice ping is on a decorative
  // child overlay so the button itself stays stable and clickable at peak opacity.
  const buttonAnimationClass = !isVoiceActive && hasNudge && !isPanelOpen
    ? 'animate-pulse motion-reduce:animate-none'
    : '';

  const ariaLabel = isPanelOpen ? 'Lumi is open' : 'Open Lumi';

  function handleClick() {
    if (isPanelOpen) {
      useLumiStore.getState().closePanel();
      return;
    }
    useLumiStore.getState().openPanel();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-expanded={isPanelOpen}
      aria-controls="lumi-panel"
      className={[
        'fixed bottom-6 right-6 z-50',
        'h-10 w-10 rounded-full',
        'bg-amber-500 text-white shadow-lg',
        'ring-1 ring-amber-700/20',
        'hover:bg-amber-600 transition-colors motion-reduce:transition-none',
        'focus:outline-none focus:ring-2 focus:ring-amber-700 focus:ring-offset-2',
        buttonAnimationClass,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isVoiceActive && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-amber-400 opacity-75 animate-ping motion-reduce:animate-none"
        />
      )}
    </button>
  );
}
