import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { ChipPrimitivePage } from '../features/onboarding-mockups/ChipPrimitivePage.js';
import { Moment5PersonalizedPage } from '../features/onboarding-mockups/Moment5PersonalizedPage.js';

export function DevOnboardingMockupsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <ChipPrimitivePage />
      <Moment5PersonalizedPage />
      <AppFooter />
    </div>
  );
}
