import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { useAuthStore } from '@/stores/auth.store.js';
import { OnboardingVoice } from '@/features/onboarding/OnboardingVoice.js';
import { OnboardingText } from '@/features/onboarding/OnboardingText.js';
import { OnboardingConsent } from '@/features/onboarding/OnboardingConsent.js';
import { CulturalRatificationStep } from '@/features/onboarding/CulturalRatificationStep.js';
import { OnboardingMentalModel } from '@/features/onboarding/OnboardingMentalModel.js';

type OnboardingMode =
  | 'select'
  | 'voice'
  | 'text'
  | 'consent'
  | 'cultural-ratification'
  | 'mental-model';

export default function OnboardingPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  const [mode, setMode] = useState<OnboardingMode>('select');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const userRole = useAuthStore((s) => s.user?.role ?? null);

  // Onboarding is a primary-parent-only flow. Secondaries redeem an invite and
  // land in /app directly — they should never be routed here.
  useEffect(() => {
    if (userRole !== null && userRole !== 'primary_parent') {
      void navigate('/app');
    }
  }, [userRole, navigate]);

  // Story 2.14 — if a stale state lands at cultural-ratification with no
  // household (race with auth), skip to the mental-model step so the parent
  // never bypasses the no-approval copy on their way into /app.
  useEffect(() => {
    if (mode === 'cultural-ratification' && householdId === null) {
      setMode('mental-model');
    }
  }, [mode, householdId]);

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

          {voiceError !== null ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="font-sans text-stone-600">{voiceError}</p>
              <button
                type="button"
                onClick={() => {
                  setVoiceError(null);
                  setMode('text');
                }}
                className="font-sans text-sm text-amber-700 underline underline-offset-2"
              >
                Continue with text instead
              </button>
            </div>
          ) : (
            <OnboardingVoice
              onComplete={() => setMode('consent')}
              onError={(message) => setVoiceError(message)}
            />
          )}
        </div>
      </main>
    );
  }

  if (mode === 'text') {
    return (
      <main className="min-h-screen flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <h1 className="font-serif text-2xl text-stone-800 text-center">
            Let&apos;s get to know your family
          </h1>
          <OnboardingText onFinalized={() => setMode('consent')} />
        </div>
      </main>
    );
  }

  if (mode === 'consent') {
    return (
      <main className="min-h-screen flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <h1 className="font-serif text-2xl text-stone-800 text-center">
            One final step
          </h1>
          <OnboardingConsent
            onConsented={() => {
              if (householdId !== null) {
                setMode('cultural-ratification');
              } else {
                // No household → skip cultural ratification but still show
                // the mental-model copy before entering /app (Story 2.14).
                setMode('mental-model');
              }
            }}
          />
        </div>
      </main>
    );
  }

  if (mode === 'cultural-ratification') {
    if (householdId === null) return null;
    return (
      <main className="min-h-screen flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <h1 className="font-serif text-2xl text-stone-800 text-center">
            Lumi noticed a few things
          </h1>
          <CulturalRatificationStep
            householdId={householdId}
            onComplete={() => setMode('mental-model')}
          />
        </div>
      </main>
    );
  }

  if (mode === 'mental-model') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <OnboardingMentalModel onComplete={() => void navigate('/app')} />
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
