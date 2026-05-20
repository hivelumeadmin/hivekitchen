import { Moment4Page } from '../features/onboarding-mockups/Moment4Page.js';

/**
 * Dev route for the Moment 4 (What goes in the bag) onboarding mockup.
 * Mirrors the production `/onboarding` flat shell (no AppHeader/AppFooter).
 */
export function DevOnboardingMoment4Page() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Moment4Page />
    </div>
  );
}
