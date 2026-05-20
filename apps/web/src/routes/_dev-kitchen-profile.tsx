import { useRef, useState } from 'react';
import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { type CalendarValue } from '../features/kitchen-profile/components/CalendarEditConversation.js';
import { CalendarSummary } from '../features/kitchen-profile/components/CalendarSummary.js';
import { type ChildEditValue } from '../features/kitchen-profile/components/ChildEditConversation.js';
import { ChildProfileCard } from '../features/kitchen-profile/components/ChildProfileCard.js';
import type { IdentityEditValue } from '../features/kitchen-profile/components/IdentityEditConversation.js';
import { KitchenIdentityCard } from '../features/kitchen-profile/components/KitchenIdentityCard.js';
import { ProfileHeader } from '../features/kitchen-profile/components/ProfileHeader.js';
import { type School } from '../features/kitchen-profile/components/SchoolsEditConversation.js';
import { SchoolsList } from '../features/kitchen-profile/components/SchoolsList.js';
import { SectionEyebrow } from '../features/kitchen-profile/components/SectionEyebrow.js';
import { StartingLineCard } from '../features/kitchen-profile/components/StartingLineCard.js';
import {
  type Allergen,
  type ChildProfile,
  type EnforcedChip,
  type StartingLine,
  kitchenProfileMock,
} from '../features/kitchen-profile/data/mockData.js';

// ─── Per-section suggestion catalogs ───────────────────────────────────────

const IDENTITY_SUGGESTIONS: readonly EnforcedChip[] = [
  { key: 'gujarati', label: 'Gujarati', enforcement: 'prefer' },
  { key: 'hindu-vegetarian', label: 'Hindu vegetarian', enforcement: 'prefer' },
  { key: 'kosher', label: 'Kosher', enforcement: 'prefer' },
  { key: 'mediterranean', label: 'Mediterranean', enforcement: 'prefer' },
  { key: 'south-indian', label: 'South Indian', enforcement: 'prefer' },
];

const ALLERGEN_SUGGESTIONS: readonly Allergen[] = [
  { name: 'Dairy', medical: false },
  { name: 'Eggs', medical: false },
  { name: 'Soy', medical: false },
  { name: 'Wheat', medical: false },
  { name: 'Fish', medical: false },
  { name: 'Shellfish', medical: false },
  { name: 'Sesame', medical: false },
];

const LUNCH_SUGGESTIONS: readonly string[] = [
  'Sushi roll',
  'Chicken tikka wrap',
  'Bento box',
  'Idli + chutney',
  'Pizza slice',
  'Khichdi thermos',
];

// ─── Editing-section discriminated union ───────────────────────────────────

type EditingSection =
  | { kind: 'identity' }
  | { kind: 'child'; index: number }
  | { kind: 'startingLine' }
  | { kind: 'schools' }
  | { kind: 'calendar' }
  | null;

function logComposite(section: string, composite: string) {
  // In production this would POST to the Lumi conversation thread API.
  // eslint-disable-next-line no-console
  console.log(`[Kitchen Profile · ${section}] composite sent to Lumi:\n` + composite);
}

export function DevKitchenProfilePage() {
  const m = kitchenProfileMock;

  // Live state per section. Initial values from the canonical mock.
  const [identity, setIdentity] = useState<IdentityEditValue>({
    cultural: m.identity.cultural,
    sharedTastes: m.identity.sharedTastes,
  });
  const [children, setChildren] = useState<readonly ChildProfile[]>(m.children.cards);
  const [startingLine, setStartingLine] = useState<StartingLine>(m.startingLine.line);
  const [schools, setSchools] = useState<readonly School[]>(m.schools.list);
  const [calendar, setCalendar] = useState<CalendarValue>({
    currentTerm: m.calendar.currentTerm,
    upcomingTrip: m.calendar.upcomingTrip,
  });

  const [editingSection, setEditingSection] = useState<EditingSection>(null);

  // Refs for scroll-anchoring each section when its edit panel opens.
  const identityRef = useRef<HTMLElement | null>(null);
  const childrenRef = useRef<HTMLElement | null>(null);
  const startingLineRef = useRef<HTMLElement | null>(null);
  const schoolsRef = useRef<HTMLElement | null>(null);
  const calendarRef = useRef<HTMLElement | null>(null);

  function scrollTo(ref: { current: HTMLElement | null }) {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ─── Identity ────────────────────────────────────────────────────────────
  function openIdentityEdit() {
    setEditingSection({ kind: 'identity' });
    scrollTo(identityRef);
  }
  function handleIdentitySend(composite: string, next: IdentityEditValue) {
    setIdentity(next);
    logComposite('Identity', composite);
  }
  function handleIdentityDone() {
    setEditingSection(null);
  }

  // ─── Children (per-child) ────────────────────────────────────────────────
  function openChildEdit(index: number) {
    setEditingSection({ kind: 'child', index });
    scrollTo(childrenRef);
  }
  function handleChildSend(index: number, composite: string, next: ChildEditValue) {
    setChildren((prev) =>
      prev.map((c, i) =>
        i === index
          ? {
              ...c,
              allergens: next.allergens,
              bagComposition: next.bagComposition,
              loves: next.loves,
              avoids: next.avoids,
              lumiQuote: next.lumiQuote,
            }
          : c,
      ),
    );
    logComposite(`Child[${index}]`, composite);
  }
  function handleChildDone() {
    setEditingSection(null);
  }

  // ─── Starting line ───────────────────────────────────────────────────────
  function openStartingLineEdit() {
    setEditingSection({ kind: 'startingLine' });
    scrollTo(startingLineRef);
  }
  function handleStartingLineSend(composite: string, next: StartingLine) {
    setStartingLine(next);
    logComposite('Starting line', composite);
  }
  function handleStartingLineDone() {
    setEditingSection(null);
  }

  // ─── Schools ─────────────────────────────────────────────────────────────
  function openSchoolsEdit() {
    setEditingSection({ kind: 'schools' });
    scrollTo(schoolsRef);
  }
  function handleSchoolsSend(composite: string, next: readonly School[]) {
    setSchools(next);
    logComposite('Schools', composite);
  }
  function handleSchoolsDone() {
    setEditingSection(null);
  }

  // ─── Calendar ────────────────────────────────────────────────────────────
  function openCalendarEdit() {
    setEditingSection({ kind: 'calendar' });
    scrollTo(calendarRef);
  }
  function handleCalendarSend(composite: string, next: CalendarValue) {
    setCalendar(next);
    logComposite('Calendar', composite);
  }
  function handleCalendarDone() {
    setEditingSection(null);
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-grow px-4 py-16 sm:px-6 md:py-24">
        <ProfileHeader
          eyebrow={m.header.eyebrow}
          headline={m.header.headline}
          description={m.header.description}
        />

        <section ref={identityRef} className="mb-16 scroll-mt-24">
          <SectionEyebrow>{m.identity.eyebrow}</SectionEyebrow>
          <KitchenIdentityCard
            quote={m.identity.quote}
            cultural={identity.cultural}
            sharedTastes={identity.sharedTastes}
            refineLabel={m.identity.refineLabel}
            suggestedAdditions={IDENTITY_SUGGESTIONS}
            isEditing={editingSection?.kind === 'identity'}
            onRefine={openIdentityEdit}
            onSendComposite={handleIdentitySend}
            onDone={handleIdentityDone}
          />
        </section>

        <section ref={childrenRef} className="mb-16 scroll-mt-24">
          <SectionEyebrow>{m.children.eyebrow}</SectionEyebrow>
          <div className="space-y-8">
            {children.map((child, idx) => (
              <ChildProfileCard
                key={child.name}
                child={child}
                suggestedAllergens={ALLERGEN_SUGGESTIONS}
                isEditing={
                  editingSection?.kind === 'child' &&
                  editingSection.index === idx
                }
                onEdit={() => openChildEdit(idx)}
                onSendComposite={(composite, next) =>
                  handleChildSend(idx, composite, next)
                }
                onDone={handleChildDone}
              />
            ))}
          </div>
        </section>

        <section ref={startingLineRef} className="mb-16 scroll-mt-24">
          <SectionEyebrow>{m.startingLine.eyebrow}</SectionEyebrow>
          <StartingLineCard
            description={m.startingLine.description}
            line={startingLine}
            suggestedAdditions={LUNCH_SUGGESTIONS}
            isEditing={editingSection?.kind === 'startingLine'}
            onEdit={openStartingLineEdit}
            onSendComposite={handleStartingLineSend}
            onDone={handleStartingLineDone}
          />
        </section>

        <section ref={schoolsRef} className="mb-16 scroll-mt-24">
          <SectionEyebrow>{m.schools.eyebrow}</SectionEyebrow>
          <SchoolsList
            schools={schools}
            addLabel={m.schools.addLabel}
            isEditing={editingSection?.kind === 'schools'}
            onEdit={openSchoolsEdit}
            onSendComposite={handleSchoolsSend}
            onDone={handleSchoolsDone}
          />
        </section>

        <section ref={calendarRef} className="mb-16 scroll-mt-24">
          <SectionEyebrow>{m.calendar.eyebrow}</SectionEyebrow>
          <CalendarSummary
            currentTerm={calendar.currentTerm}
            upcomingTrip={calendar.upcomingTrip}
            syncLabel={m.calendar.syncLabel}
            isEditing={editingSection?.kind === 'calendar'}
            onEdit={openCalendarEdit}
            onSendComposite={handleCalendarSend}
            onDone={handleCalendarDone}
          />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
