import { Moment3Page } from '../features/onboarding-mockups/Moment3Page.js';

/**
 * Dev route for the Moment 3 (How your kitchen tastes) onboarding mockup.
 * Mirrors the production `/onboarding` flat shell (no AppHeader/AppFooter).
 */
export function DevOnboardingMoment3Page() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Moment3Page />
    </div>
  );
}
