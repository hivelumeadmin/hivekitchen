export interface Proposal {
  readonly label: string;
  readonly name: string;
  readonly prepMinutes: number;
  readonly imageSrc: string;
  readonly imageAlt: string;
}

export interface MessagePart {
  readonly text: string;
  readonly highlight?: boolean;
}

export type Turn =
  | {
      readonly kind: 'user';
      readonly time: string;
      readonly text: string;
    }
  | {
      readonly kind: 'lumi';
      readonly time: string;
      readonly message: readonly MessagePart[];
      readonly proposal: Proposal;
    }
  | {
      readonly kind: 'diff';
      readonly previous: string;
      readonly next: string;
      readonly status: string;
    }
  | {
      readonly kind: 'cultural';
      readonly label: string;
      readonly heartNote: string;
      readonly primaryLabel: string;
      readonly secondaryLabel: string;
    };

export const eveningCheckinMock = {
  title: 'Evening Check-in',
  subtitle: "Tuesday, Oct 24 • Finalizing Tomorrow's Plan",
  turns: [
    {
      kind: 'user',
      time: 'YOU • 18:42',
      text:
        'Can we swap Wednesday? Sarah is staying late at the clinic, so I need something I can prep solo in under 20 minutes.',
    },
    {
      kind: 'lumi',
      time: 'LUMI • 18:43',
      message: [
        { text: "Understood. I've pulled the " },
        { text: 'Cashew Butter Soba', highlight: true },
        {
          text:
            ' forward from Thursday. It’s a one-pot assembly—mostly fresh scallions and cold noodles.',
        },
      ],
      proposal: {
        label: 'PROPOSAL',
        name: 'Cashew Butter Soba',
        prepMinutes: 18,
        imageSrc: '/images/evening-checkin-cashew-soba.jpg',
        imageAlt: 'A ceramic bowl of cold soba noodles in cashew butter sauce with scallions',
      },
    },
    {
      kind: 'diff',
      previous: 'Wed: Roasted Chicken',
      next: 'Wed: Cashew Soba',
      status: 'Plan Updated',
    },
    {
      kind: 'cultural',
      label: 'LUMI • CULTURAL NOTE',
      heartNote:
        '"Since Sarah is working late, this soba reminds me of the ‘late-shift comfort’ her mother used to mention. Would you like me to add a quick note to the recipe about the toasted sesame oil ratio she prefers?"',
      primaryLabel: 'Yes, keep it going',
      secondaryLabel: 'Tell Lumi more',
    },
  ] satisfies readonly Turn[],
  composer: {
    placeholder: 'Type a heart note or plan update…',
    charCap: 280,
  },
} as const;
