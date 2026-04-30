import { useEffect } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession.js';
import { useVoiceStore } from '@/stores/voice.store.js';

export interface OnboardingVoiceProps {
  onComplete: (result: { cultural_priors_detected: boolean }) => void;
}

export function OnboardingVoice({ onComplete }: OnboardingVoiceProps) {
  const setStatus = useVoiceStore((s) => s.setStatus);
  const setError = useVoiceStore((s) => s.setError);
  const setIsSpeaking = useVoiceStore((s) => s.setIsSpeaking);
  const clearError = useVoiceStore((s) => s.clearError);

  const { status, errorMessage, start, stop } = useVoiceSession({
    onComplete,
    onError: (message) => setError(message),
  });

  // Start the session on mount; clean up on unmount.
  useEffect(() => {
    clearError();
    void start();
    return () => stop();
    // start/stop are stable refs from the hook by useCallback; we only want
    // to fire this on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the hook's status into the cross-tree voice store.
  useEffect(() => {
    setStatus(
      status === 'connecting'
        ? 'connecting'
        : status === 'closed'
          ? 'ended'
          : status === 'error'
            ? 'error'
            : status === 'idle'
              ? 'idle'
              : 'active',
    );
    setIsSpeaking(status === 'speaking');
  }, [status, setStatus, setIsSpeaking]);

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
