import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import {
  OnboardingStateResponseSchema,
  type OnboardingStateResponse,
} from '@hivekitchen/contracts';
import { useAuthStore } from '@/stores/auth.store.js';
import { hkFetch } from '@/lib/fetch.js';
import { AppFooter } from '@hivekitchen/ui';
import { AppHeader } from '@/components/AppHeader.js';
import { OnboardingVoice } from '@/features/onboarding/OnboardingVoice.js';
import { OnboardingText } from '@/features/onboarding/OnboardingText.js';
import { OnboardingConsent } from '@/features/onboarding/OnboardingConsent.js';
import { OnboardingResume } from '@/features/onboarding/OnboardingResume.js';
import { CulturalRatificationStep } from '@/features/onboarding/CulturalRatificationStep.js';
import { OnboardingMentalModel } from '@/features/onboarding/OnboardingMentalModel.js';
import { MediaSection } from '@/features/onboarding/components/MediaSection.js';
import { OnboardingActions } from '@/features/onboarding/components/OnboardingActions.js';
import { OnboardingHero } from '@/features/onboarding/components/OnboardingHero.js';
import { PreviewTiles } from '@/features/onboarding/components/PreviewTiles.js';
import { onboardingMock } from '@/features/onboarding/data/mockData.js';

type OnboardingMode =
  | 'select'
  | 'resume'
  | 'voice'
  | 'text'
  | 'consent'
  | 'cultural-ratification'
  | 'mental-model';

/**
 * Production onboarding flow. State-machine of 6 modes:
 *
 *   select → (voice | text) → consent → [cultural-ratification?] → mental-model → /app
 *
 * v2.0 chrome (AppHeader + AppFooter) wraps every mode. The `select` mode
 * renders the v2.0 onboarding intro composition (Hero + MediaSection + Actions
 * + PreviewTiles). All other modes keep their v1 step components verbatim — they
 * own real logic (ElevenLabs voice WS, consent flows, cultural inference) that
 * isn't part of this visual-only migration. Phase 5+ will replace the inner
 * step UIs with v2.0 components.
 */
export default function OnboardingPage() {
  useScope('app-scope');
  const navigate = useNavigate();
  // Slice 2-S26 — start in 'loading' until GET /v1/onboarding/state resolves.
  // The probe decides whether to show 'select' (fresh) or 'resume' (mid-flow).
  // Once the user picks a mode, mode transitions are local and the resume
  // state stays static (we don't re-probe mid-flow).
  const [mode, setMode] = useState<OnboardingMode | 'loading'>('loading');
  const [resumeState, setResumeState] = useState<OnboardingStateResponse | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const userRole = useAuthStore((s) => s.user?.role ?? null);
  const displayName = useAuthStore((s) => s.user?.display_name ?? null);
  const firstName = displayName ? displayName.split(/\s+/)[0] : null;

  // Onboarding is a primary-parent-only flow. Secondaries redeem an invite and
  // land in /app directly — they should never be routed here.
  useEffect(() => {
    if (userRole !== null && userRole !== 'primary_parent') {
      void navigate('/app');
    }
  }, [userRole, navigate]);

  // Slice 2-S26 — probe onboarding state on mount. A successful 'in_progress'
  // result swaps the mode picker for the Resume surface; 'completed' bounces
  // to /app (defensive — auth callback should have already routed there);
  // 'not_started' or any error falls through to the normal 'select' mode.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const raw = await hkFetch<unknown>('/v1/onboarding/state', {
          method: 'GET',
          signal: controller.signal,
        });
        if (cancelled) return;
        const parsed = OnboardingStateResponseSchema.parse(raw);
        if (parsed.status === 'completed') {
          void navigate('/app');
          return;
        }
        if (parsed.status === 'in_progress') {
          setResumeState(parsed);
          setMode('resume');
          return;
        }
        setMode('select');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Non-fatal: fall through to the normal mode picker. A logged-out
        // user hitting /onboarding directly would hit a 401 here; the
        // existing route guards handle redirecting to /auth/login.
        setMode('select');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [navigate]);

  // Story 2.14 — if a stale state lands at cultural-ratification with no
  // household (race with auth), skip to the mental-model step so the parent
  // never bypasses the no-approval copy on their way into /app.
  useEffect(() => {
    if (mode === 'cultural-ratification' && householdId === null) {
      setMode('mental-model');
    }
  }, [mode, householdId]);

  const handleStartOver = async (): Promise<void> => {
    try {
      await hkFetch('/v1/onboarding/state/reset', { method: 'POST' });
    } catch {
      // Best-effort: if reset fails the user is still on the resume surface
      // and can retry. Swallow rather than blocking the UI.
    }
    setResumeState(null);
    setMode('select');
  };

  const handleContinue = (): void => {
    if (resumeState === null) return;
    // Voice-origin threads continue in text mode this slice (story AC5).
    // The server thread keeps its 'voice' modality column; we just render
    // the text UI on top of the same turn history.
    setMode('text');
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="flex flex-1 flex-col">
        {renderMode()}
      </main>
      <AppFooter />
    </div>
  );

  function renderMode() {
    if (mode === 'loading') {
      // Brief spinner-less placeholder. The state probe usually resolves in
      // <100ms; rendering a full skeleton flashes more than it helps. An
      // accessible region label lets screen readers announce the page.
      return (
        <section
          aria-busy="true"
          aria-label="Loading onboarding"
          className="flex flex-1 items-center justify-center px-8 py-16"
        />
      );
    }

    if (mode === 'resume' && resumeState !== null) {
      return (
        <OnboardingResume
          state={resumeState}
          firstName={firstName}
          onContinue={handleContinue}
          onStartOver={handleStartOver}
        />
      );
    }

    if (mode === 'select') {
      const m = onboardingMock;
      return (
        <>
          <OnboardingHero
            eyebrow={m.hero.eyebrow}
            headline={m.hero.headline}
            subhead={m.hero.subhead}
            imageSrc={m.hero.imageSrc}
            imageAlt={m.hero.imageAlt}
          />
          <MediaSection />
          {/* Epic 13-s6 (AC7) — entry continuity, text-first. Voice is deferred
              (memory onboarding-text-first, Q2a): both entries land in text; the
              promise is "start talking, finish typing" and the line stands in for
              a not-yet-built voice path. The "I'd rather type" secondary is kept
              (still → text) so the Epic 2.5/2.6 onboarding e2e gate stays green. */}
          <OnboardingActions
            onBegin={() => setMode('text')}
            onLookAround={() => setMode('text')}
            primaryLabel="Start with Lumi"
            secondaryLabel="I'd rather type"
            privacyLine="Voice is coming soon. For now, Lumi is ready in text — you can type your way through."
          />
          <PreviewTiles tiles={m.previewTiles} />
        </>
      );
    }

    if (mode === 'voice') {
      return (
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="flex w-full max-w-md flex-col items-center gap-6">
            <header className="text-center">
              <h1 className="font-serif text-2xl text-fg">Let&apos;s get to know your family</h1>
              <p className="mt-2 text-sm text-fg-muted">
                Lumi will ask three questions to personalise your plan.
              </p>
            </header>

            {voiceError !== null ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-fg-muted">{voiceError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setVoiceError(null);
                    setMode('text');
                  }}
                  className="text-sm text-amber-warm underline underline-offset-2 hover:text-amber"
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
        </div>
      );
    }

    if (mode === 'text') {
      // Slice 2-S26 — when arriving from Resume, pass prior turns so the
      // transcript re-hydrates. On a fresh start (resumeState === null)
      // OnboardingText falls back to its single-greeting initial state,
      // preserving 2-7 behavior exactly.
      const initialTurns = resumeState?.turns?.map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
      }));
      return (
        <div className="flex flex-1 overflow-hidden">
          <OnboardingText
            onFinalized={() => setMode('consent')}
            initialTurns={initialTurns}
            initialHouseholdDisplayName={resumeState?.household_display_name ?? null}
            initialMomentKey={resumeState?.current_moment ?? null}
            initialChipConfig={resumeState?.chip_config ?? null}
          />
        </div>
      );
    }

    if (mode === 'consent') {
      return (
        <div className="flex flex-1 items-start justify-center px-4 py-12">
          <div className="flex w-full max-w-2xl flex-col gap-6">
            <h1 className="text-center font-serif text-2xl text-fg">One final step</h1>
            <OnboardingConsent
              onConsented={() => {
                if (householdId !== null) {
                  setMode('cultural-ratification');
                } else {
                  setMode('mental-model');
                }
              }}
            />
          </div>
        </div>
      );
    }

    if (mode === 'cultural-ratification') {
      if (householdId === null) return null;
      return (
        <div className="flex flex-1 items-start justify-center px-4 py-12">
          <div className="flex w-full max-w-2xl flex-col gap-6">
            <h1 className="text-center font-serif text-2xl text-fg">
              Lumi noticed a few things
            </h1>
            <CulturalRatificationStep
              householdId={householdId}
              onComplete={() => setMode('mental-model')}
            />
          </div>
        </div>
      );
    }

    if (mode === 'mental-model') {
      return (
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            <OnboardingMentalModel onComplete={() => void navigate('/app')} />
          </div>
        </div>
      );
    }

    return null;
  }
}
