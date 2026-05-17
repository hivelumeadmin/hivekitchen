export interface MessagePart {
  readonly text: string;
  readonly highlight?: boolean;
}

export type InterviewTurn =
  | {
      readonly kind: 'message';
      readonly speaker: 'lumi' | 'user';
      readonly timestamp: string;
      readonly message: readonly MessagePart[];
    }
  | {
      readonly kind: 'listening';
      readonly timestamp: string;
    };

export const kitchenInterviewMock = {
  title: 'The Kitchen Interview',
  subtitle: "Let's build your profile. Speak naturally, I'm taking notes.",
  userAvatarSrc: '/images/interview-user-avatar.jpg',
  userAvatarAlt: 'User profile photo',
  turns: [
    {
      kind: 'message',
      speaker: 'lumi',
      timestamp: 'Just now',
      message: [
        { text: 'To start, what did your ' },
        { text: 'grandmother', highlight: true },
        {
          text:
            ' cook? Any specific dishes or flavors that immediately come to mind?',
        },
      ],
    },
    {
      kind: 'message',
      speaker: 'user',
      timestamp: 'Just now',
      message: [
        { text: 'She always made this incredible ' },
        { text: 'slow-roasted lamb', highlight: true },
        {
          text:
            " on Sundays. Lots of rosemary and garlic. Oh, and for allergies—I'm strictly gluten-free.",
        },
      ],
    },
    {
      kind: 'listening',
      timestamp: 'Listening…',
    },
  ] satisfies readonly InterviewTurn[],
  holdToTalkLabel: 'Hold to talk',
} as const;
