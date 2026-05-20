import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { ChipPrimitivePage } from '../features/onboarding-mockups/ChipPrimitivePage.js';

export function DevOnboardingMockupsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <ChipPrimitivePage />
      <AppFooter />
    </div>
  );
}
