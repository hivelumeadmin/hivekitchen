import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { MediaSection } from '../features/onboarding/components/MediaSection.js';
import { OnboardingActions } from '../features/onboarding/components/OnboardingActions.js';
import { OnboardingHero } from '../features/onboarding/components/OnboardingHero.js';
import { PreviewTiles } from '../features/onboarding/components/PreviewTiles.js';
import { onboardingMock } from '../features/onboarding/data/mockData.js';

export function DevOnboardingPage() {
  const m = onboardingMock;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="relative">
        <OnboardingHero
          eyebrow={m.hero.eyebrow}
          headline={m.hero.headline}
          subhead={m.hero.subhead}
          imageSrc={m.hero.imageSrc}
          imageAlt={m.hero.imageAlt}
        />
        <MediaSection />
        <OnboardingActions />
        <PreviewTiles tiles={m.previewTiles} />
      </main>
      <AppFooter />
    </div>
  );
}
