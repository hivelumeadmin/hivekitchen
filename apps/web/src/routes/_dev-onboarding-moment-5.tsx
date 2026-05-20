import { Moment5Page } from '../features/onboarding-mockups/Moment5Page.js';

/**
 * Dev route for the Moment 5 (A starting line for Lumi — 10 favorite lunches)
 * onboarding mockup. Mirrors the production `/onboarding` flat shell.
 */
export function DevOnboardingMoment5Page() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Moment5Page />
    </div>
  );
}
