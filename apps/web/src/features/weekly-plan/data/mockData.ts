export type ChildColor = 'foliage' | 'lumi-terracotta';

export interface Child {
  readonly id: string;
  readonly name: string;
  readonly color: ChildColor;
}

export type PlanTileVariant = 'default' | 'saved-waste' | 'no-lunch';

export interface PlanTile {
  readonly day: string;
  readonly date: string;
  readonly variant: PlanTileVariant;
  readonly dish?: string;
  readonly noLunchReason?: string;
  readonly children?: readonly Child[];
  readonly safetyCleared?: string;
  readonly leftoverHint?: string;
}

const aarav: Child = { id: 'aarav', name: 'Aarav', color: 'foliage' };
const layla: Child = { id: 'layla', name: 'Layla', color: 'lumi-terracotta' };

export const weeklyPlanMock: readonly PlanTile[] = [
  {
    day: 'Mon',
    date: '11',
    variant: 'default',
    dish: 'Cumin chicken pita with carrot ribbons',
    children: [aarav, layla],
    safetyCleared: 'Nut-free ✓',
  },
  {
    day: 'Tue',
    date: '12',
    variant: 'saved-waste',
    dish: 'Mini paneer kathi rolls + cucumber sticks',
    children: [aarav, layla],
    safetyCleared: 'Nut-free ✓',
    leftoverHint: "From Sunday's biryani",
  },
  {
    day: 'Wed',
    date: '13',
    variant: 'default',
    dish: 'Lentil soup with crusty bread',
    children: [aarav, layla],
    safetyCleared: 'Nut-free ✓',
  },
  {
    day: 'Thu',
    date: '14',
    variant: 'no-lunch',
    noLunchReason: 'No-lunch · School trip',
  },
  {
    day: 'Fri',
    date: '15',
    variant: 'default',
    dish: 'Veggie pasta bake',
    children: [aarav, layla],
    safetyCleared: 'Nut-free ✓',
  },
];

export const weeklyPlanBriefMock = {
  eyebrow: "This week's brief · Mon 11 May – Fri 15 May",
  headline: 'Five lunches, ready for you.',
  lumiNote:
    'Lumi has prepared five days of lunches for Aarav and Layla. Two children. Two schools. One nut-free policy. Honors your halal preferences and last week’s feedback.',
} as const;

export type WhyReasonIcon = 'star' | 'shield-check' | 'leaf';

export interface WhyReason {
  readonly icon: WhyReasonIcon;
  readonly text: string;
}

export const whyThisWeekMock: readonly WhyReason[] = [
  {
    icon: 'star',
    text: "Aarav rated last Wednesday's chickpea bowl ★★★★★ — repeat-friendly base reused.",
  },
  {
    icon: 'shield-check',
    text: "Layla's school is nut-free; all five lunches comply for safety and policy.",
  },
  {
    icon: 'leaf',
    text: 'Saturday leftovers fold into Tuesday — no waste and less prep time needed.',
  },
];

