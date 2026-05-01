import { useEffect, useRef } from 'react';
import { hkFetch } from '@/lib/fetch.js';

// Story 2.14 — final onboarding step that teaches the no-approval mental
// model with two sentences (UX-DR65). Said once. No coachmarks, no tooltips,
// no progress chrome. The exact strings are part of the contract — the UX
// spec ratified the wording and any paraphrase loses the calming register.
const SENTENCE_ONE =
  "The plan is always ready. Change anything, anytime. You don't need to approve it.";
const SENTENCE_TWO = 'Changes save as you go. No button needed.';

interface OnboardingMentalModelProps {
  onComplete: () => void;
}

export function OnboardingMentalModel({ onComplete }: OnboardingMentalModelProps) {
  // React 19 StrictMode invokes mount effects twice in dev. The breadcrumb
  // is supposed to record that this screen was shown to the parent, not how
  // many times React re-mounted the component, so a ref-gate keeps the audit
  // row single per screen view.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    // Fire-and-forget: a missing audit row must never block the user from
    // entering the app. Swallow all errors silently.
    void hkFetch('/v1/onboarding/mental-model-shown', { method: 'POST' }).catch(
      () => undefined,
    );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <p className="font-serif text-xl text-stone-800 leading-relaxed">{SENTENCE_ONE}</p>
      <p className="font-serif text-xl text-stone-800 leading-relaxed">{SENTENCE_TWO}</p>
      <button
        type="button"
        onClick={onComplete}
        className="w-full mt-2 px-6 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 transition-colors motion-reduce:transition-none"
      >
        Get started
      </button>
    </div>
  );
}
