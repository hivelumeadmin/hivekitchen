export interface OnboardingPreviewTile {
  readonly imageSrc?: string;
  readonly iconKind?: 'waveform';
  readonly label: string;
  readonly alt?: string;
}

export const onboardingMock = {
  hero: {
    eyebrow: 'Welcome to HiveKitchen',
    headline: 'Come in. The kitchen is yours.',
    subhead: 'Lumi will help carry the weekly thinking, so you can carry the meaning.',
    imageSrc: '/images/onboarding-hero.jpg',
    imageAlt: 'Hands placing sliced fruit into a wooden lunchbox in a warm, dimly lit kitchen at dusk',
  },
  textOverview: [
    'HiveKitchen is a quiet planning companion for school lunches. We believe the rhythm of a family is found in the small, repeated gestures of care. By organizing the logistics of nutrition and safety, we clear the space for you to focus on the child behind the lunchbox.',
    'It is not a recipe app. It is not a tracker. It is an ambient intelligence designed to understand your school’s unique policies, your child’s evolving tastes, and the reality of a busy Sunday evening. Lumi works in the background, so you never start from a blank page.',
    'In a few moments, Lumi will sit with you for a short kitchen interview. Together, you will define the boundaries of your hearth—from allergen safety to the specific ways your child prefers their sandwiches sliced. This is the foundation of our partnership.',
  ],
  video: {
    imageSrc: '/images/onboarding-video-thumb.jpg',
    imageAlt: 'A still image of a glowing fireplace in a warm kitchen, suggesting a hearth-style introduction video',
  },
  audio: {
    caption: '“Welcome to HiveKitchen…”',
    status: 'Playing Audio Overview',
  },
  privacyReassurance:
    "Your family's data stays yours. Lumi never trains on your private notes.",
  stepIndicator: {
    dots: ['active', 'inactive', 'inactive'] as const,
    label: 'Hearth · Kitchen Interview · First Brief',
  },
  primaryCta: 'Begin the kitchen interview',
  secondaryCta: "I'd like to look around first",
  previewTiles: [
    {
      imageSrc: '/images/onboarding-tile-brief.jpg',
      label: 'A weekend brief',
      alt: 'A handwritten grocery list on textured linen paper',
    },
    {
      imageSrc: '/images/onboarding-tile-note.jpg',
      label: 'A lunchtime note for your child',
      alt: 'A small hand-drawn heart tucked into a lunchbox',
    },
    {
      iconKind: 'waveform' as const,
      label: 'A quiet voice when you need to ask',
    },
  ] satisfies readonly OnboardingPreviewTile[],
} as const;
