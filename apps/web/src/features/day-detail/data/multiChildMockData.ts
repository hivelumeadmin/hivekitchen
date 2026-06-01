export type ChildDotColor = 'foliage' | 'lumi-terracotta' | 'sacred';

export type AgeBand = 'toddler' | 'child' | 'preteen' | 'teen';

export interface ChildPerson {
  readonly id: string;
  readonly name: string;
  readonly color: ChildDotColor;
  readonly ageBand: AgeBand;
}

export type CookingMode = 'prep' | 'finish';

export interface MethodStep {
  readonly text: string;
  readonly mode: CookingMode;
}

export interface MainRecipe {
  readonly id: string;
  readonly title: string;
  readonly ingredients: readonly string[];
  readonly method: readonly MethodStep[];
  readonly prepMinutes: number;
  readonly finishMinutes: number;
  readonly familiarityKnown: boolean;
}

export type PortionSize = 'small' | 'regular' | 'large';
export type TextureLevel = 'soft' | 'normal' | 'diced' | 'finger';
export type SpiceLevel = 'mild' | 'regular' | 'spicy';

export interface ChildVariation {
  readonly childId: string;
  readonly portionSize: PortionSize;
  readonly texture: TextureLevel;
  readonly spiceLevel: SpiceLevel;
  readonly cuttingStyle?: string;
  readonly container?: string;
  readonly addOns: readonly string[];
  readonly removals: readonly string[];
  readonly notes?: string;
}

export interface SnackEntry {
  readonly title: string;
  readonly ingredients: readonly string[];
  readonly perChildVariation?: Readonly<Record<string, string>>;
}

export type OptionalExtraKind =
  | 'drink'
  | 'extra_snack'
  | 'protein_boost'
  | 'sports_add'
  | 'sweet'
  | 'toddler_safe'
  | 'allergy_substitute'
  | 'custom';

export interface OptionalExtra {
  readonly kind: OptionalExtraKind;
  readonly title: string;
  readonly perChildAssignment: Readonly<Record<string, 'included' | 'excluded'>>;
}

export interface PrepInvestment {
  readonly savedMinutes: number;
  readonly label: string;
}

// Story 3-DM-A3: aligned mock-data DayName with PlanComposeDaySchema and the
// SCHOOL_DAYS canonical enum. Mock surfaces still render Mon-Fri only; Saturday
// is type-allowed for households whose school week declares it.
export type DayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

export interface DayPlan {
  readonly id: string;
  readonly dayName: DayName;
  readonly dateLabel: string;
  readonly mainGroupId: string;
  readonly mainGroupNote?: string;
  readonly main: MainRecipe;
  readonly variations: readonly ChildVariation[];
  readonly snack: SnackEntry;
  readonly optionalExtra?: OptionalExtra;
  readonly prepInvestment?: PrepInvestment;
}

export interface WeekPlan {
  readonly id: string;
  readonly children: readonly ChildPerson[];
  readonly days: readonly DayPlan[];
}

export function formatAttribution(kids: readonly ChildPerson[]): string {
  if (kids.length === 0) return '';
  if (kids.length === 1) return `For ${kids[0]!.name}`;
  if (kids.length === 2) return `For ${kids[0]!.name} & ${kids[1]!.name}`;
  const head = kids
    .slice(0, -1)
    .map((k) => k.name)
    .join(', ');
  const last = kids[kids.length - 1]!.name;
  return `For ${head} & ${last}`;
}

const AARAV: ChildPerson = { id: 'c-1', name: 'Aarav', color: 'foliage', ageBand: 'toddler' };
const MIRA: ChildPerson = { id: 'c-2', name: 'Mira', color: 'lumi-terracotta', ageBand: 'child' };
const KABIR: ChildPerson = { id: 'c-3', name: 'Kabir', color: 'sacred', ageBand: 'teen' };

export const exampleWeek: WeekPlan = {
  id: 'week-2026-05-w20',
  children: [AARAV, MIRA, KABIR],
  days: [
    {
      id: 'day-mon',
      dayName: 'monday',
      dateLabel: '12 May',
      mainGroupId: 'M1',
      mainGroupNote: 'Same as Tuesday',
      main: {
        id: 'main-dal-rice',
        title: 'Dal + rice thermos',
        ingredients: [
          '1 cup yellow dal (toor or moong)',
          '1.5 cups basmati rice',
          '1 tsp ghee',
          'Cumin, turmeric, salt',
          '3 small thermoses',
        ],
        method: [
          { mode: 'prep', text: 'Cook the dal with turmeric, cumin, and salt until soft. Set aside.' },
          { mode: 'prep', text: 'Cook the rice. Keep warm or refrigerate if prepping overnight.' },
          { mode: 'finish', text: 'Layer rice in each thermos, ladle dal on top. Drizzle ghee.' },
          { mode: 'finish', text: 'Seal warm — the thermos keeps it lunchtime-hot.' },
        ],
        prepMinutes: 20,
        finishMinutes: 6,
        familiarityKnown: true,
      },
      variations: [
        {
          childId: AARAV.id,
          portionSize: 'small',
          texture: 'soft',
          spiceLevel: 'mild',
          notes: 'Mash the rice slightly. Skip whole cumin seeds — keep ground only.',
          addOns: [],
          removals: ['whole cumin seeds'],
        },
        {
          childId: MIRA.id,
          portionSize: 'regular',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: [],
          removals: [],
        },
        {
          childId: KABIR.id,
          portionSize: 'large',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: ['1 hard-boiled egg', 'extra ghee'],
          removals: [],
          notes: 'Add the egg whole on top of the rice; he likes it intact.',
        },
      ],
      snack: {
        title: 'Apple slices & cheese',
        ingredients: ['1 small apple', 'Cheese cubes', '1 small pot'],
        perChildVariation: {
          [AARAV.id]: 'Thin slivers, no skin',
          [KABIR.id]: 'Larger wedges, skin on',
        },
      },
      prepInvestment: {
        savedMinutes: 14,
        label: 'Sunday prep',
      },
    },
    {
      id: 'day-tue',
      dayName: 'tuesday',
      dateLabel: '13 May',
      mainGroupId: 'M1',
      mainGroupNote: 'Same base as Monday — paneer added for Mira & Kabir',
      main: {
        id: 'main-dal-rice',
        title: 'Dal + rice thermos',
        ingredients: [
          "Reuse Monday's dal + rice (refrigerated)",
          '4 oz paneer, cubed (for Mira & Kabir)',
          '1 tsp ghee',
          '3 small thermoses',
        ],
        method: [
          { mode: 'prep', text: "Reheat Monday's leftover dal + rice gently." },
          { mode: 'prep', text: 'Cube the paneer; toast in ghee with a pinch of salt (add chili for Kabir).' },
          { mode: 'finish', text: "Layer rice, dal, and paneer in Mira and Kabir's thermoses. Aarav's stays plain." },
          { mode: 'finish', text: 'Seal warm.' },
        ],
        prepMinutes: 8,
        finishMinutes: 5,
        familiarityKnown: true,
      },
      variations: [
        {
          childId: AARAV.id,
          portionSize: 'small',
          texture: 'soft',
          spiceLevel: 'mild',
          addOns: [],
          removals: ['paneer'],
          notes: 'Plain dal + rice today, paneer is for the older kids.',
        },
        {
          childId: MIRA.id,
          portionSize: 'regular',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: ['paneer cubes (4 oz)'],
          removals: [],
        },
        {
          childId: KABIR.id,
          portionSize: 'large',
          texture: 'normal',
          spiceLevel: 'spicy',
          addOns: ['paneer cubes (4 oz)', 'yogurt side cup'],
          removals: [],
        },
      ],
      snack: {
        title: 'Yogurt + fruit',
        ingredients: ['3 yogurt cups', '1 small banana, ½ orange'],
        perChildVariation: {
          [AARAV.id]: 'Mashed banana stirred into yogurt',
        },
      },
      optionalExtra: {
        kind: 'sports_add',
        title: 'School-safe granola bar',
        perChildAssignment: {
          [AARAV.id]: 'excluded',
          [MIRA.id]: 'excluded',
          [KABIR.id]: 'included',
        },
      },
      prepInvestment: {
        savedMinutes: 6,
        label: "Monday's leftovers",
      },
    },
    {
      id: 'day-wed',
      dayName: 'wednesday',
      dateLabel: '14 May',
      mainGroupId: 'M2',
      mainGroupNote: 'Same as Thursday',
      main: {
        id: 'main-paratha-roll',
        title: 'Paneer paratha roll',
        ingredients: [
          '3 wholemeal parathas',
          '6 oz paneer, crumbled',
          'Cilantro chutney',
          'Mint chutney',
          'Cucumber ribbons',
          '3 small leakproof containers',
        ],
        method: [
          { mode: 'prep', text: 'Make the parathas Sunday night; cool and stack with parchment.' },
          { mode: 'prep', text: 'Crumble the paneer and mix with chutney. Refrigerate.' },
          { mode: 'finish', text: 'Warm each paratha briefly. Spread paneer mixture down the centre.' },
          { mode: 'finish', text: 'Add cucumber ribbons; roll tight. Slice on the diagonal.' },
        ],
        prepMinutes: 22,
        finishMinutes: 6,
        familiarityKnown: false,
      },
      variations: [
        {
          childId: AARAV.id,
          portionSize: 'small',
          texture: 'finger',
          spiceLevel: 'mild',
          cuttingStyle: '4 bite-sized rounds',
          addOns: [],
          removals: ['mint chutney'],
          notes: 'Skip mint, just cilantro. Cut into 4 bite-sized rounds.',
        },
        {
          childId: MIRA.id,
          portionSize: 'regular',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: [],
          removals: [],
        },
        {
          childId: KABIR.id,
          portionSize: 'large',
          texture: 'normal',
          spiceLevel: 'spicy',
          addOns: ['extra paneer', 'pickle slices'],
          removals: [],
        },
      ],
      snack: {
        title: 'Crackers + fruit',
        ingredients: ['School-safe crackers (1 pack each)', '3 small apples or pears'],
      },
      prepInvestment: {
        savedMinutes: 19,
        label: 'Sunday prep',
      },
    },
    {
      id: 'day-thu',
      dayName: 'thursday',
      dateLabel: '15 May',
      mainGroupId: 'M2',
      mainGroupNote: 'Same base as Wednesday — egg version for Mira & Kabir',
      main: {
        id: 'main-paratha-roll',
        title: 'Paratha roll',
        ingredients: [
          "Sunday's parathas (3)",
          '3 eggs (for Mira & Kabir)',
          'Mild cheese (for Aarav)',
          'Cucumber, tomato slices',
          'Cilantro chutney',
        ],
        method: [
          { mode: 'prep', text: "Sunday's parathas reheat. For Aarav, fold cheese inside while warm." },
          { mode: 'prep', text: 'Scramble eggs softly with salt and a pinch of pepper. Cool slightly.' },
          { mode: 'finish', text: "Lay egg into Mira and Kabir's parathas; fold cucumber and tomato inside." },
          { mode: 'finish', text: 'Roll all three. Slice. Pack with chutney pot on the side.' },
        ],
        prepMinutes: 9,
        finishMinutes: 7,
        familiarityKnown: false,
      },
      variations: [
        {
          childId: AARAV.id,
          portionSize: 'small',
          texture: 'finger',
          spiceLevel: 'mild',
          cuttingStyle: 'bite-sized rounds',
          addOns: ['mild cheese'],
          removals: ['egg', 'pepper'],
          notes: 'Cheese paratha today — egg-free.',
        },
        {
          childId: MIRA.id,
          portionSize: 'regular',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: ['egg (1)'],
          removals: [],
        },
        {
          childId: KABIR.id,
          portionSize: 'large',
          texture: 'normal',
          spiceLevel: 'spicy',
          addOns: ['egg (1)', 'extra cucumber', 'pickle slices'],
          removals: [],
        },
      ],
      snack: {
        title: 'Cheese + cucumber sticks',
        ingredients: ['Cheese cubes', 'Cucumber batons (1 per kid)'],
      },
      prepInvestment: {
        savedMinutes: 8,
        label: "Wednesday's prep + Sunday batch",
      },
    },
    {
      id: 'day-fri',
      dayName: 'friday',
      dateLabel: '16 May',
      mainGroupId: 'M3',
      mainGroupNote: 'Friday flex',
      main: {
        id: 'main-bento-leftovers',
        title: 'Bento-style leftovers + wraps',
        ingredients: [
          'Leftover paneer from Wednesday',
          'Whole-wheat tortillas (3)',
          'Cheese cubes',
          'Cucumber, carrot ribbons',
          'Bento divider containers (3)',
        ],
        method: [
          { mode: 'finish', text: 'Pack each bento with: half-wrap rolled, cheese cubes, veg ribbons, leftover paneer.' },
          { mode: 'finish', text: 'Add a small fruit for visual appeal.' },
        ],
        prepMinutes: 0,
        finishMinutes: 8,
        familiarityKnown: false,
      },
      variations: [
        {
          childId: AARAV.id,
          portionSize: 'small',
          texture: 'finger',
          spiceLevel: 'mild',
          cuttingStyle: 'all bite-sized',
          addOns: [],
          removals: ['paneer (too spicy from Wednesday)'],
        },
        {
          childId: MIRA.id,
          portionSize: 'regular',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: [],
          removals: [],
        },
        {
          childId: KABIR.id,
          portionSize: 'large',
          texture: 'normal',
          spiceLevel: 'regular',
          addOns: ['extra wrap', 'hummus pot'],
          removals: [],
        },
      ],
      snack: {
        title: 'School-safe granola bar',
        ingredients: ['Granola bar (1 per kid)'],
      },
      optionalExtra: {
        kind: 'sweet',
        title: 'Friday treat — small chocolate square',
        perChildAssignment: {
          [AARAV.id]: 'included',
          [MIRA.id]: 'included',
          [KABIR.id]: 'included',
        },
      },
    },
  ],
};
