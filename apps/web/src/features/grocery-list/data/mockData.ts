export type StoreAccent = 'safety-cleared' | 'amber';
export type StoreIcon = 'storefront' | 'shopping-basket';

export interface GroceryItem {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly quantity: number;
  readonly defaultUnit: string;
  readonly units: readonly string[];
  readonly faded?: boolean;
  readonly checked?: boolean;
}

export interface StoreSubsection {
  readonly title: string;
  readonly items: readonly GroceryItem[];
}

export interface Store {
  readonly name: string;
  readonly accent: StoreAccent;
  readonly icon: StoreIcon;
  readonly badge?: string;
  readonly subsections: readonly StoreSubsection[];
}

export const groceryListMock = {
  hero: {
    eyebrow: 'Plan Updated • 5m ago',
    headline: 'Your Weekly Grocery Shopping List',
    description:
      'Consolidated from your weekly meal plan, including Cashew Satay Bowls, Herbed Lemon Chicken, and household snacks.',
    imageSrc: '/images/grocery-list-hero-ingredients.jpg',
    imageAlt: 'Fresh ingredients laid out on a dark kitchen counter',
  },
  lumiHint:
    'Need help finding a substitute or checking pantry inventory? Just ask.',
  composer: {
    placeholder: 'Add a household snack or essential…',
    buttonLabel: 'Add to List',
  },
  stores: [
    {
      name: "Haji's Global Market",
      accent: 'safety-cleared',
      icon: 'storefront',
      badge: 'Cultural Supplier',
      subsections: [
        {
          title: 'Specialty Pantry',
          items: [
            {
              id: 'cashew-butter',
              name: 'Stone-Ground Cashew Butter',
              sub: '16oz Jar, Unsalted • Aisle 4',
              quantity: 1,
              defaultUnit: 'unit',
              units: ['unit', 'lb', 'oz', 'pack'],
            },
            {
              id: 'chili-oil',
              name: 'Small-Batch Chili Oil',
              sub: '200ml • Check the back shelf',
              quantity: 1,
              defaultUnit: 'ml',
              units: ['ml', 'unit'],
            },
          ],
        },
        {
          title: 'Produce',
          items: [
            {
              id: 'fresh-lemongrass',
              name: 'Fresh Lemongrass',
              sub: '3 stalks • From recent shipment',
              quantity: 3,
              defaultUnit: 'stalks',
              units: ['stalks', 'unit'],
            },
          ],
        },
      ],
    },
    {
      name: 'General Grocer',
      accent: 'amber',
      icon: 'shopping-basket',
      subsections: [
        {
          title: 'Fresh to Pack',
          items: [
            {
              id: 'chicken-breasts',
              name: 'Organic Chicken Breasts',
              sub: '1.5 lb for Herbed Lemon Chicken',
              quantity: 1.5,
              defaultUnit: 'lb',
              units: ['lb', 'unit', 'g'],
            },
            {
              id: 'cilantro',
              name: 'Fresh Cilantro Bunches',
              sub: '2 bunches',
              quantity: 2,
              defaultUnit: 'bunches',
              units: ['bunches', 'unit'],
            },
            {
              id: 'lemons',
              name: 'Large Lemons',
              sub: '4 pieces, firm & heavy',
              quantity: 4,
              defaultUnit: 'unit',
              units: ['unit', 'lb'],
            },
          ],
        },
        {
          title: 'Pantry Staples',
          items: [
            {
              id: 'chicken-breasts-pantry',
              name: 'Organic Chicken Breasts',
              sub: '1.5 lb for Herbed Lemon Chicken',
              quantity: 1.5,
              defaultUnit: 'lb',
              units: ['lb', 'unit', 'g'],
              faded: true,
            },
            {
              id: 'cilantro-pantry',
              name: 'Fresh Cilantro Bunches',
              sub: '2 bunches',
              quantity: 2,
              defaultUnit: 'bunches',
              units: ['bunches', 'unit'],
            },
            {
              id: 'lemons-pantry',
              name: 'Large Lemons',
              sub: '4 pieces, firm & heavy',
              quantity: 4,
              defaultUnit: 'unit',
              units: ['unit', 'lb'],
            },
          ],
        },
      ],
    },
  ] satisfies readonly Store[],
  session: {
    title: 'Store Session',
    progressLabel: 'Progress',
    progressText: '1 of 12 items found',
    progressPercent: 8,
    primaryAction: 'Select a Store',
    proTipLabel: 'Pro-tip for this week:',
    proTipBody:
      "“Haji's just received a shipment of fresh lemongrass. It would be a perfect aromatic addition to the Lemon Chicken marinade.”",
  },
} as const;
