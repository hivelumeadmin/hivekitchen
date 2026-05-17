export type Rating = 'loved' | 'ok' | 'not-really';

export interface RatingOption {
  readonly id: Rating;
  readonly emoji: string;
  readonly label: string;
}

export const lunchLinkMock = {
  salutation: {
    title: 'A note from Mum',
    date: 'Tuesday · 12 May',
  },
  heartNote: {
    body: "“Hope today is a calm one — I packed your favourite carrot ribbons because I know you're trying out for the choir later. You're going to be amazing. Love, Mum xx”",
    from: '— Mum',
  },
  lunch: {
    eyebrow: "Today's Lunch",
    name: 'Cumin chicken pita',
    sub: 'with carrot ribbons',
    imageSrc: '/images/lunch-link-cumin-pita.jpg',
    imageAlt: 'A warm cumin chicken pita with golden bread and carrot ribbons',
    safetyBadge: 'Nut-free',
  },
  feedback: {
    childName: 'Layla',
    question: 'How was lunch, Layla?',
    options: [
      { id: 'loved', emoji: '😋', label: 'Loved it' },
      { id: 'ok', emoji: '🙂', label: 'It was OK' },
      { id: 'not-really', emoji: '😕', label: 'Not really' },
    ] satisfies readonly RatingOption[],
    hint: "Tap one. That's all.",
  },
} as const;
