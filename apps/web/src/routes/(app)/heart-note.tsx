import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HeartNoteNullablePayloadSchema,
  HeartNotePayloadSchema,
  ListChildrenResponseSchema,
  type HeartNoteResponse,
} from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { PageHeader } from '@/components/PageHeader.js';
import { HeartNoteActions } from '@/features/heart-note/components/HeartNoteActions.js';
import { LumiPresenceCard } from '@/features/heart-note/components/LumiPresenceCard.js';
import { MealPreviewCard } from '@/features/heart-note/components/MealPreviewCard.js';
import { ReactionCard } from '@/features/heart-note/components/ReactionCard.js';
import { StationeryCard } from '@/features/heart-note/components/StationeryCard.js';

const HEART_NOTE_PLACEHOLDER =
  'Hope today is a calm one — a few words for your child here.';
const HEART_NOTE_CHAR_CAP = 280;
const AUTOSAVE_DEBOUNCE_MS = 1500;

interface ChildSummary {
  readonly id: string;
  readonly name: string;
}

// S1 — bag preview / reaction / Lumi suggestion remain mock-shaped placeholders.
// Real data wires in later slices (plan tile data, rating signals, Lumi
// snapshot). The route renders the cards so the layout matches γ Phase 4
// while only the StationeryCard does real I/O.
const PLACEHOLDER_MEAL = {
  name: 'Cumin Chicken Pita',
  allergens: ['Gluten', 'Sesame'] as readonly string[],
};
const PLACEHOLDER_REACTION = {
  emoji: '🥰',
  text: '"loved it"',
  date: 'Yesterday',
};
const PLACEHOLDER_LUMI_SUGGESTION =
  'might enjoy a soft note today — keep it short and warm.';

export default function HeartNoteRoute() {
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);

  const [activeChild, setActiveChild] = useState<ChildSummary | null>(null);
  const [draft, setDraft] = useState<HeartNoteResponse | null>(null);
  const [savedHint, setSavedHint] = useState<string>('');
  const [saveError, setSaveError] = useState<boolean>(false);
  const [bootError, setBootError] = useState<string | null>(null);

  // Stored mutably because the debounce timer + the in-flight note id need
  // to be read inside async callbacks without triggering re-renders.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const noteIdRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const childRef = useRef<ChildSummary | null>(null);

  useEffect(() => {
    childRef.current = activeChild;
  }, [activeChild]);

  // Boot: load children → pick first → fetch today's draft (if any).
  useEffect(() => {
    if (householdId === null) return;
    setBootError(null);
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const childrenRaw = await hkFetch<unknown>(
          `/v1/households/${householdId}/children`,
          { method: 'GET', signal: controller.signal },
        );
        if (cancelled) return;
        const { children } = ListChildrenResponseSchema.parse(childrenRaw);
        if (children.length === 0) {
          setBootError('No children on this household yet.');
          return;
        }
        const first = children[0];
        if (!first) {
          setBootError('No children on this household yet.');
          return;
        }
        const child: ChildSummary = { id: first.id, name: first.name };
        setActiveChild(child);

        const today = isoToday();
        const draftRaw = await hkFetch<unknown>(
          `/v1/heart-notes?child_id=${child.id}&date=${today}`,
          { method: 'GET', signal: controller.signal },
        );
        if (cancelled) return;
        const { note } = HeartNoteNullablePayloadSchema.parse(draftRaw);
        if (note !== null) {
          setDraft(note);
          noteIdRef.current = note.id;
          setSavedHint(`Saved at ${formatTime(new Date(note.updated_at))}`);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setBootError('Could not load today’s note.');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [householdId]);

  // Performs the save (POST first time, PATCH thereafter). Skips the call
  // when another save is already in flight; the latest pending text is
  // re-tried by handleTextChange via the debounce timer.
  const flushSave = useCallback(async (text: string) => {
    const child = childRef.current;
    if (child === null || inFlightRef.current) return;
    inFlightRef.current = true;
    setSavedHint('Saving…');
    setSaveError(false);
    try {
      if (noteIdRef.current === null) {
        const raw = await hkFetch<unknown>('/v1/heart-notes', {
          method: 'POST',
          body: { child_id: child.id, content: text },
        });
        const { note } = HeartNotePayloadSchema.parse(raw);
        noteIdRef.current = note.id;
        setDraft(note);
      } else {
        const raw = await hkFetch<unknown>(`/v1/heart-notes/${noteIdRef.current}`, {
          method: 'PATCH',
          body: { content: text },
        });
        const { note } = HeartNotePayloadSchema.parse(raw);
        setDraft(note);
      }
      setSavedHint(`Saved at ${formatTime(new Date())}`);
    } catch {
      setSavedHint('Save failed');
      setSaveError(true);
    } finally {
      inFlightRef.current = false;
      // If the user typed more while the save was in flight, drain it.
      if (pendingTextRef.current !== null && pendingTextRef.current !== text) {
        const next = pendingTextRef.current;
        pendingTextRef.current = null;
        void flushSave(next);
      }
    }
  }, []);

  const handleTextChange = useCallback(
    (text: string) => {
      pendingTextRef.current = text;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const pending = pendingTextRef.current;
        pendingTextRef.current = null;
        if (pending !== null) void flushSave(pending);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const handleManualSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingTextRef.current;
    pendingTextRef.current = null;
    if (pending !== null) void flushSave(pending);
  }, [flushSave]);

  const childName = activeChild?.name ?? '…';
  const eyebrow = `${formatDayLabel(new Date())} · A note for ${childName}`;
  const envelope = {
    toLabel: activeChild?.name ?? '',
    deliveryTime: '12:15',
    scheduled: false,
  };

  return (
    <>
      <main className="flex flex-grow justify-center px-6 pb-32 pt-16">
        <div className="flex w-full max-w-[1040px] flex-col items-start gap-10 md:flex-row">
          <div className="flex w-full max-w-[720px] flex-col">
            <PageHeader eyebrow={eyebrow} headlineSize="sm" className="mb-8 max-w-none">
              A few words for <span className="text-sacred">{childName}</span> today.
            </PageHeader>
            {bootError !== null ? (
              <p
                role="alert"
                className="mb-4 rounded-md border border-safety-red/30 bg-safety-red/10 px-4 py-3 text-sm text-safety-red"
              >
                {bootError}
              </p>
            ) : null}
            <StationeryCard
              envelope={envelope}
              draftText={draft?.content ?? ''}
              placeholder={HEART_NOTE_PLACEHOLDER}
              charCap={HEART_NOTE_CHAR_CAP}
              savedHint={savedHint}
              saveError={saveError}
              onTextChange={handleTextChange}
            />
          </div>
          <aside className="flex w-full flex-col gap-8 pt-20 md:w-[280px]">
            <MealPreviewCard childName={childName} meal={PLACEHOLDER_MEAL} />
            <ReactionCard reaction={PLACEHOLDER_REACTION} />
            <LumiPresenceCard
              childName={childName}
              suggestion={PLACEHOLDER_LUMI_SUGGESTION}
            />
          </aside>
        </div>
      </main>
      <HeartNoteActions onSave={handleManualSave} />
    </>
  );
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}
