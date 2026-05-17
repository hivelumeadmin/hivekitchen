import { FeedbackBlock } from '@/features/lunch-link/components/FeedbackBlock.js';
import { HeartNoteCard } from '@/features/lunch-link/components/HeartNoteCard.js';
import { LunchSummary } from '@/features/lunch-link/components/LunchSummary.js';
import { MumNoteSalutation } from '@/features/lunch-link/components/MumNoteSalutation.js';
import { lunchLinkMock } from '@/features/lunch-link/data/mockData.js';

// Child-scope surface. AppLayout suppresses the LumiOrb/LumiPanel for /lunch/*
// routes (via useMatch); chrome (AppHeader/AppFooter) is intentionally kept so
// a parent peeking at the link recognizes the family of surfaces.
export default function LunchLinkRoute() {
  const m = lunchLinkMock;
  return (
    <main className="flex w-full flex-grow items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-8">
        <MumNoteSalutation
          title={m.salutation.title}
          date={m.salutation.date}
        />
        <HeartNoteCard body={m.heartNote.body} from={m.heartNote.from} />
        <LunchSummary lunch={m.lunch} />
        <FeedbackBlock
          question={m.feedback.question}
          options={m.feedback.options}
          hint={m.feedback.hint}
        />
      </div>
    </main>
  );
}
