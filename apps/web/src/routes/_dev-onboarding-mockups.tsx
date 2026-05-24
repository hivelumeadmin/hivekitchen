import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { ChipPrimitivePage } from '../features/onboarding-mockups/ChipPrimitivePage.js';
import { Moment1PersonalizedPage } from '../features/onboarding-mockups/Moment1PersonalizedPage.js';
import { Moment2PersonalizedPage } from '../features/onboarding-mockups/Moment2PersonalizedPage.js';
import { Moment3PersonalizedPage } from '../features/onboarding-mockups/Moment3PersonalizedPage.js';
import { Moment4PersonalizedPage } from '../features/onboarding-mockups/Moment4PersonalizedPage.js';
import { Moment5PersonalizedPage } from '../features/onboarding-mockups/Moment5PersonalizedPage.js';

export function DevOnboardingMockupsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <ChipPrimitivePage />
      <Moment1PersonalizedPage />
      <Moment2PersonalizedPage />
      <Moment3PersonalizedPage />
      <Moment4PersonalizedPage />
      <Moment5PersonalizedPage />
      <AppFooter />
    </div>
  );
}
