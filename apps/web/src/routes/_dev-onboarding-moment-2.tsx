import { Moment2Page } from '../features/onboarding-mockups/Moment2Page.js';

/**
 * Dev route for the Moment 2 (Safety — allergens) onboarding mockup.
 * Mirrors the production `/onboarding` flat shell (no AppHeader/AppFooter).
 */
export function DevOnboardingMoment2Page() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Moment2Page />
    </div>
  );
}
