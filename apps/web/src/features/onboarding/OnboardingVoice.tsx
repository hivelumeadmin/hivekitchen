import { useEffect } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession.js';

export interface OnboardingVoiceProps {
  onComplete: (result: { cultural_priors_detected: boolean }) => void;
  onError?: (message: string) => void;
}

export function OnboardingVoice({ onComplete, onError }: OnboardingVoiceProps) {
  const { status, errorMessage, start, stop } = useVoiceSession({
    onComplete,
    onError: (message) => onError?.(message),
  });

  // Start the session on mount; clean up on unmount.
  useEffect(() => {
    void start();
    return () => stop();
    // start/stop are stable refs from the hook by useCallback; we only want
    // to fire this on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSpeaking = status === 'speaking';

  return (
    <div className="flex flex-col items-center gap-8">
      <div
        className={[
          'w-24 h-24 rounded-full transition-all duration-300',
          isSpeaking
            ? 'bg-amber-500 scale-110 shadow-lg shadow-amber-200'
            : 'bg-stone-200',
        ].join(' ')}
        aria-label={isSpeaking ? 'Lumi is speaking' : 'Listening'}
        role="img"
      />

      <p className="font-sans text-sm text-stone-400 tracking-wide uppercase">
        {status === 'connecting' && 'Connecting…'}
        {status === 'ready' && 'Listening…'}
        {status === 'listening' && 'Listening…'}
        {status === 'processing' && 'Thinking…'}
        {status === 'speaking' && 'Lumi is speaking'}
        {status === 'closing' && 'Wrapping up…'}
        {status === 'error' && (errorMessage ?? 'Something went wrong')}
      </p>

      <button
        type="button"
        onClick={stop}
        className="mt-4 px-6 py-2 rounded-full font-sans text-sm text-stone-600 border border-stone-300 hover:bg-stone-100 transition-colors"
      >
        End session
      </button>
    </div>
  );
}
