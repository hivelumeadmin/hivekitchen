export interface DayDetail {
  readonly eyebrow: string;
  readonly headline: string;
  readonly description: string;
  readonly servingNote: string;
  readonly ingredients: readonly string[];
  readonly morningNotes: string;
  readonly safety: SafetySection;
  readonly allergens: readonly Allergen[];
  readonly whyLumiChose: readonly WhyReason[];
  readonly source: Source;
  readonly footerHint: string;
}

export interface SafetySection {
  readonly schoolLabel: string;
  readonly policies: readonly string[];
}

export interface Allergen {
  readonly label: string;
  readonly flagged?: boolean;
}

export type WhyReasonIcon = 'star' | 'package' | 'nutrition';

export interface WhyReason {
  readonly icon: WhyReasonIcon;
  readonly text: string;
}

export interface Source {
  readonly bookTitle: string;
  readonly category: string;
}

export const dayDetailMock: DayDetail = {
  eyebrow: 'Tuesday · 12 May · Lunch for Aarav',
  headline: 'Cumin chicken pita with carrot ribbons',
  description:
    "A travel-friendly handheld with a side that won't wilt — Lumi picked this because Aarav rated last week's pita ★★★★★ and chickpeas are running ahead this week.",
  servingNote: 'Approx. 6 oz / serves one',
  ingredients: [
    'Cumin-spiced grilled chicken (4 oz)',
    'Wholemeal pita, halved',
    'Carrot ribbons with lemon (small pot)',
    '2 medjool dates',
  ],
  morningNotes:
    'Pack the pita with the chicken folded inside, not pre-stuffed — keeps it from going soggy. Send the carrot ribbons in the small leakproof pot.',
  safety: {
    schoolLabel: "Safe for Aarav's school",
    policies: ['Nut-free', 'No heating required', 'Halal'],
  },
  allergens: [
    { label: 'Wheat', flagged: true },
    { label: 'Dairy-free' },
    { label: 'Egg-free' },
  ],
  whyLumiChose: [
    { icon: 'star', text: "Matches Aarav's preference for handheld textures." },
    { icon: 'package', text: 'Maintains integrity for up to 6 hours in transit.' },
    { icon: 'nutrition', text: 'Fits the weekly goal for complex proteins.' },
  ],
  source: {
    bookTitle: 'From the Seed Library',
    category: 'Family-friendly handhelds',
  },
  footerHint: 'Last week, Aarav rated this style ★★★★★ on 7 May.',
};
