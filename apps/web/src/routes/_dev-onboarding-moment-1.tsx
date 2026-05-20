import { Moment1Page } from '../features/onboarding-mockups/Moment1Page.js';

/**
 * Dev route for the Moment 1 onboarding mockup. Mirrors the production
 * `/onboarding` route discipline — flat, no AppHeader/AppFooter (the
 * onboarding surface owns its own chrome).
 */
export function DevOnboardingMoment1Page() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Moment1Page />
    </div>
  );
}
