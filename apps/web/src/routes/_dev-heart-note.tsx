import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { PageHeader } from '../components/PageHeader.js';
import { HeartNoteActions } from '../features/heart-note/components/HeartNoteActions.js';
import { LumiPresenceCard } from '../features/heart-note/components/LumiPresenceCard.js';
import { MealPreviewCard } from '../features/heart-note/components/MealPreviewCard.js';
import { ReactionCard } from '../features/heart-note/components/ReactionCard.js';
import { StationeryCard } from '../features/heart-note/components/StationeryCard.js';

// Dev preview only — exercises the v2.0 heart-note composition with fixed
// sample copy so design + token regressions are visible at /__dev__/heart-note.
// The production route at /app/heart-note (Slice 4-S1) loads real data from the
// API; this file intentionally stays a static stub.
const DEV_HEART_NOTE = {
  eyebrow: 'Tuesday morning · 12 May · A note for Layla',
  childName: 'Layla',
  envelope: { toLabel: 'Layla', deliveryTime: '12:15', scheduled: true },
  draftText:
    'Hope today is a calm one — I packed your favourite carrot ribbons, and the dates are the soft kind you like. Eat slow, the swim meet is later.',
  placeholder: 'Hope today is a calm one — I packed your favourite carrot ribbons...',
  charCap: 280,
  savedHint: 'Saved a moment ago',
  meal: { name: 'Cumin Chicken Pita', allergens: ['Gluten', 'Sesame'] as readonly string[] },
  reaction: { emoji: '🥰', text: '"loved it"', date: 'Mon 11 May' },
  lumiSuggestion:
    'mentioned she loved the texture of the pita yesterday. Maybe mention her big swim meet today?',
};

export function DevHeartNotePage() {
  const n = DEV_HEART_NOTE;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="flex flex-grow justify-center px-6 pb-32 pt-16">
        <div className="flex w-full max-w-[1040px] flex-col items-start gap-10 md:flex-row">
          <div className="flex w-full max-w-[720px] flex-col">
            <PageHeader
              eyebrow={n.eyebrow}
              headlineSize="sm"
              className="mb-8 max-w-none"
            >
              A few words for <span className="text-sacred">{n.childName}</span> today.
            </PageHeader>
            <StationeryCard
              envelope={n.envelope}
              draftText={n.draftText}
              placeholder={n.placeholder}
              charCap={n.charCap}
              savedHint={n.savedHint}
            />
          </div>
          <aside className="flex w-full flex-col gap-8 pt-20 md:w-[280px]">
            <MealPreviewCard childName={n.childName} meal={n.meal} />
            <ReactionCard reaction={n.reaction} />
            <LumiPresenceCard childName={n.childName} suggestion={n.lumiSuggestion} />
          </aside>
        </div>
      </main>
      <HeartNoteActions />
      <AppFooter />
    </div>
  );
}
