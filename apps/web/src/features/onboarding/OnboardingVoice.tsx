import { useEffect, useCallback } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { VoiceTokenResponse } from '@hivekitchen/contracts';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useVoiceStore } from '@/stores/voice.store.js';

// Inner — must be inside ConversationProvider
function OnboardingVoiceSession({ onComplete }: { onComplete?: () => void }) {
  // Selectors only — never destructure the whole store (per project rule).
  const setStatus = useVoiceStore((s) => s.setStatus);
  const storeStart = useVoiceStore((s) => s.startSession);
  const storeEnd = useVoiceStore((s) => s.endSession);
  const setError = useVoiceStore((s) => s.setError);
  const setIsSpeaking = useVoiceStore((s) => s.setIsSpeaking);

  const { startSession, endSession, isSpeaking, status } = useConversation({
    onConnect: () => setStatus('active'),
    onDisconnect: () => {
      storeEnd();
      // Navigation is owned by the parent (OnboardingPage). The post-call
      // ElevenLabs webhook has already persisted the onboarding summary as a
      // system_event turn before this fires; the parent transitions to the
      // consent step, then onConsented routes to /app.
      onComplete?.();
    },
    onError: (message) => setError(message),
  });

  // Mirror the SDK's isSpeaking flag into the store so consumers outside this
  // subtree (and StrictMode-safe across re-renders) see one source of truth.
  useEffect(() => {
    setIsSpeaking(isSpeaking);
  }, [isSpeaking, setIsSpeaking]);

  // Fetch the signed URL and open the WebSocket session on mount
  useEffect(() => {
    const controller = new AbortController();
    let started = false;

    async function init() {
      setStatus('connecting');
      try {
        const raw = await hkFetch<unknown>('/v1/voice/token', {
          method: 'POST',
          body: { context: 'onboarding' },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const token = VoiceTokenResponse.parse(raw);
        storeStart(token.sessionId);
        startSession({ signedUrl: token.token });
        started = true;
      } catch (err) {
        if (controller.signal.aborted) return;
        // AbortError surfaces here on cleanup; ignore it.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const is502 = err instanceof HkApiError && err.status === 502;
        setError(
          is502
            ? 'Voice is temporarily unavailable.'
            : 'Could not start voice session. Please try again.',
        );
      }
    }

    void init();

    return () => {
      controller.abort();
      // Only call endSession if we actually opened one; calling against an
      // unstarted session leaks a WebSocket on StrictMode double-mount.
      if (started) endSession();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    endSession();
  }, [endSession]);

  // SDK ConversationStatus: 'disconnected' | 'connecting' | 'connected' | 'error'.
  // Use the SDK status as the single source of truth for the rendering decisions
  // here; the store mirrors it via setStatus for cross-tree consumers.
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
        {status === 'connected' && (isSpeaking ? 'Lumi is speaking' : 'Listening…')}
      </p>

      <button
        type="button"
        onClick={handleEnd}
        className="mt-4 px-6 py-2 rounded-full font-sans text-sm text-stone-600 border border-stone-300 hover:bg-stone-100 transition-colors"
      >
        End session
      </button>
    </div>
  );
}

export function OnboardingVoice({ onComplete }: { onComplete?: () => void }) {
  return (
    <ConversationProvider>
      <OnboardingVoiceSession onComplete={onComplete} />
    </ConversationProvider>
  );
}
