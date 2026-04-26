import { useState } from 'react';
import { useScope } from '@hivekitchen/ui';
import { useVoiceStore } from '@/stores/voice.store.js';
import { OnboardingVoice } from '@/features/onboarding/OnboardingVoice.js';

type OnboardingMode = 'select' | 'voice' | 'text';

export default function OnboardingPage() {
  useScope('app-scope');
  const [mode, setMode] = useState<OnboardingMode>('select');
  // Selectors only — never pull the whole store (project rule).
  const voiceStatus = useVoiceStore((s) => s.status);
  const voiceError = useVoiceStore((s) => s.error);
  const clearError = useVoiceStore((s) => s.clearError);

  if (mode === 'voice') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md flex flex-col items-center gap-6">
          <h1 className="font-serif text-2xl text-stone-800 text-center">
            Let&apos;s get to know your family
          </h1>
          <p className="font-sans text-sm text-stone-500 text-center">
            Lumi will ask three questions to personalise your plan.
          </p>

          {voiceStatus === 'error' && voiceError ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="font-sans text-stone-600">{voiceError}</p>
              <button
                type="button"
                onClick={() => {
                  clearError();
                  setMode('text');
                }}
                className="font-sans text-sm text-amber-700 underline underline-offset-2"
              >
                Continue with text instead
              </button>
            </div>
          ) : (
            <OnboardingVoice />
          )}
        </div>
      </main>
    );
  }

  if (mode === 'text') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <p className="font-sans text-stone-600 text-center">
            Text onboarding coming in Story 2.7.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="font-serif text-3xl text-stone-800 mb-3">
            Welcome to HiveKitchen
          </h1>
          <p className="font-sans text-stone-500 leading-relaxed">
            Lumi will learn about your family in a short conversation —
            under 10 minutes, three questions.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 w-full">
          <button
            type="button"
            onClick={() => setMode('voice')}
            className="w-full px-8 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 transition-colors"
          >
            Start with voice
          </button>
          <button
            type="button"
            onClick={() => setMode('text')}
            className="font-sans text-sm text-stone-500 underline underline-offset-2 hover:text-stone-700 transition-colors"
          >
            I&apos;d rather type
          </button>
        </div>
      </div>
    </main>
  );
}
