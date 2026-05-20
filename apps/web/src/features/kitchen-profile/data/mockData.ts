// ─── Kitchen Profile mock data ─────────────────────────────────────────────
//
// Mirrors the shape the live `KitchenMapSchema` will project once slice 2.5-s11
// is wired (see `packages/contracts/src/kitchen-map.ts`). The Khan-Patel
// household is the canonical seed family — same household as the onboarding
// mockups (Moments 1–6), so the Visible Memory page reads back what the
// parent confirmed in onboarding.
//
// Differences from the older mock (per the 2026-05-19 sprint change proposal):
//  - Allergens render uniformly — no `severity: 'life-threatening' | 'caution'`
//    tiers. A `medical` flag distinguishes medical allergens from religious /
//    lifestyle ones, but visual treatment is uniform.
//  - Cultural items carry an `enforcement` state: 'always' (hard rule),
//    'prefer' (soft preference), 'context' (background flavor). Matches the
//    chip treatment used in Moments 5/6.
//  - Bag composition is first-class per child.
//  - "Lumi's starting line" — the 10 favorite lunches captured in Moment 5 —
//    is a new section.
//  - Skipped / missing moments render via the EmptyMomentPlaceholder pattern.

export type Enforcement = 'always' | 'prefer' | 'context';

export interface EnforcedChip {
  readonly key: string;
  readonly label: string;
  readonly enforcement: Enforcement;
}

export interface Allergen {
  readonly name: string;
  readonly medical: boolean;
}

export interface ChildProfile {
  readonly initial: string;
  readonly name: string;
  readonly age: number;
  readonly ageBand: string;
  readonly schoolBadge: string;
  readonly meta: readonly string[];
  readonly allergens: readonly Allergen[];
  readonly bagComposition: string | null; // null → render EmptyMomentPlaceholder
  readonly loves: string;
  readonly avoids: string;
  readonly lumiQuote?: string;
}

export interface StartingLine {
  readonly count: number;
  readonly target: number;
  readonly items: readonly string[];
}

export const kitchenProfileMock = {
  header: {
    eyebrow: 'Visible Memory · Updated 20 May',
    headline: 'What Lumi knows about your kitchen.',
    description:
      'Lumi only suggests things that fit. If anything here is wrong, change it — Lumi listens.',
  },
  identity: {
    eyebrow: 'Collective Kitchen Identity',
    quote:
      '"A Halal household rooted in Punjabi cooking — comfort food in heavy rotation, with room to try new things on the side."',
    cultural: [
      { key: 'halal', label: 'Halal', enforcement: 'always' },
      { key: 'punjabi', label: 'Punjabi', enforcement: 'prefer' },
      { key: 'italian', label: 'Italian nights', enforcement: 'context' },
    ] satisfies readonly EnforcedChip[],
    dietary: [] satisfies readonly EnforcedChip[],
    sharedTastes:
      'Warm spices like cumin and coriander are welcome; chili is kept mild for the kids. Flavor over heat — but never bland.',
    refineLabel: 'Refine collective identity',
  },
  children: {
    eyebrow: 'Children',
    cards: [
      {
        initial: 'L',
        name: 'Layla',
        age: 10,
        ageBand: '10–12',
        schoolBadge: 'Greenfield Primary · Nut-free policy',
        meta: ['HALAL HOUSEHOLD', 'HOT FOOD UNAVAILABLE AT SCHOOL'],
        allergens: [
          { name: 'Peanut', medical: true },
          { name: 'Tree nuts', medical: true },
        ],
        bagComposition: 'Main + 2 sides',
        loves: 'paneer, dal, parathas',
        avoids: 'pickles, anything spicy',
        lumiQuote: '"Top pick so far: paneer kathi roll"',
      },
      {
        initial: 'A',
        name: 'Adam',
        age: 12,
        ageBand: '10–12',
        schoolBadge: 'Brookmere CofE Primary',
        meta: ['HALAL HOUSEHOLD'],
        allergens: [],
        bagComposition: null, // skipped during onboarding — Empty placeholder
        loves: 'rice bowls, wraps, anything with chicken',
        avoids: 'cucumber, tomato',
      },
    ] satisfies readonly ChildProfile[],
  },
  startingLine: {
    eyebrow: "Lumi's starting line",
    description: 'The ten lunches you said you’d happily pack tomorrow. Lumi mixes it up from here.',
    line: {
      count: 10,
      target: 10,
      items: [
        'Paratha roll',
        'Dal + rice (thermos)',
        'Wrap',
        'Pasta salad',
        'Hummus + pita',
        'Quesadilla',
        'Rice bowl',
        'Noodle box',
        'Bagel + spread',
        'Chicken kebab + naan',
      ],
    } satisfies StartingLine,
  },
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
