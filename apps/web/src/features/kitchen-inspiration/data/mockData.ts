export type BadgeIcon = 'star' | 'check' | 'shield' | 'sun' | 'award';
export type BadgeColor = 'sacred' | 'safety-cleared' | 'amber';

export interface RecipeBadge {
  readonly icon: BadgeIcon;
  readonly color: BadgeColor;
  readonly label: string;
}

export type RecipeCardVariant = 'large' | 'small';

export interface Recipe {
  readonly id: string;
  readonly variant: RecipeCardVariant;
  readonly badges: readonly RecipeBadge[];
  readonly title: string;
  readonly body: string;
  readonly reasoning: string;
}

export const kitchenInspirationMock = {
  header: {
    title: 'In the Same Rhythm',
    description:
      "Lumi curated these based on your love for the Cashew Satay Bowl's warmth and nutty complexity.",
    statusLabel: 'Lumi is curating rhythms from recent family signals',
  },
  recipes: [
    {
      id: 'tahini-roasted-sweet-potato',
      variant: 'large',
      badges: [
        { icon: 'star', color: 'sacred', label: "Maya's Pick" },
        { icon: 'check', color: 'safety-cleared', label: 'Halal' },
      ],
      title: 'Tahini Roasted Sweet Potato Bowl',
      body: "An earthy blend of slow-roasted tubers and nutty creaminess that echoes the profile of satay.",
      reasoning:
        '“This hits that same comfort chord—warm fats meeting vibrant textures, just like your favorite cashew base.”',
    },
    {
      id: 'ginger-miso-salmon',
      variant: 'small',
      badges: [{ icon: 'shield', color: 'safety-cleared', label: 'Nut-Free' }],
      title: 'Ginger Miso Salmon',
      body: 'The miso provides a savory depth similar to peanut sauce without the allergens.',
      reasoning: '“Umami-forward and silky.”',
    },
    {
      id: 'golden-coconut-curry',
      variant: 'small',
      badges: [{ icon: 'sun', color: 'amber', label: "Today's Suggestion" }],
      title: 'Golden Coconut Curry',
      body: 'A gentle aromatic bowl that utilizes the same lime-leaf base as your Cashew Satay.',
      reasoning: '“A seamless flavor bridge.”',
    },
    {
      id: 'zaatar-cauliflower-roast',
      variant: 'large',
      badges: [{ icon: 'award', color: 'sacred', label: 'Sacred Choice' }],
      title: "Za'atar Cauliflower Roast",
      body:
        "A textured vegetable-forward dish that satisfies the 'crunch' factor you enjoyed last Tuesday.",
      reasoning:
        '“The pomegranate provides that acid spark your palate seeks after richer meals.”',
    },
  ] satisfies readonly Recipe[],
  actions: {
    loadMoreLabel: 'Load more rhythms',
    notTheseLabel: 'Not these?',
    talkToLumiLabel: 'Talk to Lumi',
  },
} as const;
