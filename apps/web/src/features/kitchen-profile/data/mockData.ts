export interface Allergy {
  readonly name: string;
  readonly severity: 'life-threatening' | 'caution';
}

export interface ChildProfile {
  readonly initial: string;
  readonly name: string;
  readonly age: number;
  readonly schoolBadge: string;
  readonly meta: readonly string[];
  readonly allergies: readonly Allergy[];
  readonly loves: string;
  readonly avoids: string;
  readonly lumiQuote?: string;
}

export type TagPillIcon = 'utensils' | 'ban' | 'globe';
export type TagPillColor = 'amber' | 'safety-cleared' | 'lumi-terracotta';

export interface TagPill {
  readonly icon: TagPillIcon;
  readonly color: TagPillColor;
  readonly label: string;
}

export const kitchenProfileMock = {
  header: {
    eyebrow: 'Visible Memory · Updated 9 May',
    headline: 'What Lumi knows about your kitchen.',
    description:
      'Lumi only suggests things that fit. If anything here is wrong, change it — Lumi listens.',
  },
  identity: {
    eyebrow: 'Collective Kitchen Identity',
    quote:
      "“A blend of Punjabi and Gujarati traditions, rooted in a Halal household where flavor is non-negotiable but heat is tempered for the little ones.”",
    pillars: [
      {
        icon: 'globe' as const,
        title: 'Cultural Heritage',
        body: 'A rich blend of Punjabi and Gujarati traditions. Cooking centers around hearty, comforting meals that celebrate these dual heritages.',
      },
      {
        icon: 'shield' as const,
        title: 'Dietary Guardrails',
        items: ['Halal', 'Nut-free', 'Egg-free'],
      },
      {
        icon: 'utensils' as const,
        title: 'Shared Tastes',
        body: 'Strong preference for warm spices like cumin and coriander over chili. Flavor is paramount, but heat levels are kept mild.',
      },
    ],
    refineLabel: 'Refine collective identity',
  },
  children: {
    eyebrow: 'Children',
    cards: [
      {
        initial: 'A',
        name: 'Aarav',
        age: 9,
        schoolBadge: 'Greenfield Primary',
        meta: ['HALAL', 'SOUTH ASIAN HOUSEHOLD', 'HOT FOOD UNAVAILABLE AT SCHOOL'],
        allergies: [
          { name: 'TREE NUTS', severity: 'life-threatening' },
          { name: 'Sesame', severity: 'caution' },
        ],
        loves: 'chickpeas, paneer, chutney',
        avoids: 'cucumber, tomato',
        lumiQuote: '“Rated highest: cumin chicken pita”',
      },
      {
        initial: 'L',
        name: 'Layla',
        age: 7,
        schoolBadge: 'Brookmere CofE Primary · Nut-free policy',
        meta: ['HALAL', 'DAIRY-LIGHT'],
        allergies: [{ name: 'EGGS', severity: 'life-threatening' }],
        loves: 'paneer kathi rolls, carrot ribbons',
        avoids: 'pickles, spicy food',
      },
    ] satisfies readonly ChildProfile[],
  },
  tagPills: [
    { icon: 'utensils', color: 'amber', label: 'Halal' },
    { icon: 'ban', color: 'safety-cleared', label: 'Nut-Free' },
    { icon: 'globe', color: 'lumi-terracotta', label: 'Punjabi-Gujarati' },
  ] satisfies readonly TagPill[],
  schools: {
    eyebrow: 'Schools',
    list: [
      { name: 'Greenfield Primary' },
      { name: 'Brookmere CofE Primary' },
    ],
    addLabel: 'Add a school',
  },
  calendar: {
    eyebrow: 'Calendar',
    currentTerm: { label: 'Current Term', value: 'Ends Friday, 19 July' },
    upcomingTrip: { label: 'Upcoming Trip', value: 'Tue, 14 May · Science Museum' },
    syncLabel: 'Sync Google Calendar',
  },
} as const;
