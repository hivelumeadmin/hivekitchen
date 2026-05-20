import { Moment6Page } from '../features/onboarding-mockups/Moment6Page.js';

/**
 * Dev route for the Summary / Finalize gate (Moment 6) onboarding mockup —
 * slice 2.5-s10. Read-back of captured moments + per-chip hard-elevation
 * confirmation + finalize gate. Mocks `is_onboarded=true` transition; refused
 * finalize routes back to the incomplete moment via the gap callout.
 */
export function DevOnboardingMoment6Page() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Moment6Page />
    </div>
  );
}
