import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { FeedbackBlock } from '../features/lunch-link/components/FeedbackBlock.js';
import { HeartNoteCard } from '../features/lunch-link/components/HeartNoteCard.js';
import { LunchSummary } from '../features/lunch-link/components/LunchSummary.js';
import { MumNoteSalutation } from '../features/lunch-link/components/MumNoteSalutation.js';
import { lunchLinkMock } from '../features/lunch-link/data/mockData.js';

/**
 * Dev preview of the `.child-scope` Lunch Link surface.
 *
 * Per DESIGN.md §3 rules: single-column, 72px tap targets, Heart Note
 * delivered unmodified, AAA contrast across the surface. This is the
 * child's experience — intentionally tiny, no global app affordances
 * cluttering the view.
 */
export function DevLunchLinkPage() {
  const m = lunchLinkMock;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
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
      <AppFooter />
    </div>
  );
}
