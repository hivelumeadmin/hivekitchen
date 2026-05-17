import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { CalendarSummary } from '../features/kitchen-profile/components/CalendarSummary.js';
import { ChildProfileCard } from '../features/kitchen-profile/components/ChildProfileCard.js';
import { KitchenIdentityCard } from '../features/kitchen-profile/components/KitchenIdentityCard.js';
import { ProfileHeader } from '../features/kitchen-profile/components/ProfileHeader.js';
import { SchoolsList } from '../features/kitchen-profile/components/SchoolsList.js';
import { SectionEyebrow } from '../features/kitchen-profile/components/SectionEyebrow.js';
import { TagPillsRow } from '../features/kitchen-profile/components/TagPillsRow.js';
import { kitchenProfileMock } from '../features/kitchen-profile/data/mockData.js';

export function DevKitchenProfilePage() {
  const m = kitchenProfileMock;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-grow px-4 py-16 sm:px-6 md:py-24">
        <ProfileHeader
          eyebrow={m.header.eyebrow}
          headline={m.header.headline}
          description={m.header.description}
        />

        <section className="mb-16">
          <SectionEyebrow>{m.identity.eyebrow}</SectionEyebrow>
          <KitchenIdentityCard
            quote={m.identity.quote}
            pillars={m.identity.pillars}
            refineLabel={m.identity.refineLabel}
          />
        </section>

        <section className="mb-16">
          <SectionEyebrow>{m.children.eyebrow}</SectionEyebrow>
          <div className="space-y-8">
            {m.children.cards.map((child) => (
              <ChildProfileCard key={child.name} child={child} />
            ))}
          </div>
          <TagPillsRow pills={m.tagPills} />
        </section>

        <section className="mb-16">
          <SectionEyebrow>{m.schools.eyebrow}</SectionEyebrow>
          <SchoolsList
            schools={m.schools.list}
            addLabel={m.schools.addLabel}
          />
        </section>

        <section className="mb-16">
          <SectionEyebrow>{m.calendar.eyebrow}</SectionEyebrow>
          <CalendarSummary
            currentTerm={m.calendar.currentTerm}
            upcomingTrip={m.calendar.upcomingTrip}
            syncLabel={m.calendar.syncLabel}
          />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
