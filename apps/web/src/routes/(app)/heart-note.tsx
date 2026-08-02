import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HeartNoteNullablePayloadSchema,
  HeartNotePayloadSchema,
  ListChildrenResponseSchema,
  type HeartNoteResponse,
  type HeartNoteStatus,
} from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { PageHeader } from '@/components/PageHeader.js';
import { HeartNoteActions } from '@/features/heart-note/components/HeartNoteActions.js';
import { LumiPresenceCard } from '@/features/heart-note/components/LumiPresenceCard.js';
import { MealPreviewCard } from '@/features/heart-note/components/MealPreviewCard.js';
import { ReactionCard } from '@/features/heart-note/components/ReactionCard.js';
import { ScheduleDatePicker } from '@/features/heart-note/components/ScheduleDatePicker.js';
import { StationeryCard } from '@/features/heart-note/components/StationeryCard.js';
import { StatusPill } from '@/features/heart-note/components/StatusPill.js';

const HEART_NOTE_PLACEHOLDER =
  'Hope today is a calm one — a few words for your child here.';
const HEART_NOTE_CHAR_CAP = 280;
const AUTOSAVE_DEBOUNCE_MS = 1500;

// Slice 4-S6 — once a note reaches any of these terminal statuses the
// textarea, date picker, and Cancel button all go read-only.
const TERMINAL_STATUSES: readonly HeartNoteStatus[] = [
  'delivered',
  'viewed',
  'rated',
  'cancelled',
];

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
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [isSaving, setIsSaving] = useState(false);

  // Stored mutably because the debounce timer + the in-flight note id need
  // to be read inside async callbacks without triggering re-renders.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const noteIdRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const childRef = useRef<ChildSummary | null>(null);
  // Captured at page-load so "Copy link" always targets today's date even if
  // the user leaves the page open past midnight.
  const noteDateRef = useRef<string>(isoToday());

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
    setIsSaving(true);
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
      setIsSaving(false);
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

  const handleCopyLink = useCallback(async () => {
    const child = childRef.current;
    if (child === null) return;
    setCopyState('copying');
    try {
      const { url } = await hkFetch<{ url: string }>('/v1/lunch-link/generate', {
        method: 'POST',
        body: { child_id: child.id, date: noteDateRef.current },
      });
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('idle');
    }
  }, []);

  // Slice 4-S6 — scheduling and cancel mutations are direct PATCH calls.
  // They bypass the autosave debounce because they're discrete intent
  // changes, not stream-of-keystroke edits.
  const handleScheduleChange = useCallback(async (date: string | null) => {
    if (noteIdRef.current === null) return;
    try {
      const raw = await hkFetch<unknown>(`/v1/heart-notes/${noteIdRef.current}`, {
        method: 'PATCH',
        body: { scheduled_for: date },
      });
      const { note } = HeartNotePayloadSchema.parse(raw);
      setDraft(note);
    } catch {
      // Scheduling failure is non-fatal — the optimistic state stays out of
      // sync, but the input value reflects the unchanged server draft on the
      // next render.
    }
  }, []);

  const handleCancel = useCallback(async () => {
    if (noteIdRef.current === null) return;
    try {
      const raw = await hkFetch<unknown>(`/v1/heart-notes/${noteIdRef.current}`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      });
      const { note } = HeartNotePayloadSchema.parse(raw);
      setDraft(note);
    } catch {
      // Best-effort: leave the existing draft visible if the cancel fails.
    }
  }, []);

  const isTerminal = draft !== null && TERMINAL_STATUSES.includes(draft.status);
  const childName = activeChild?.name ?? '…';
  const eyebrow = `${formatDayLabel(new Date())} · A note for ${childName}`;
  const envelope = {
    toLabel: activeChild?.name ?? '',
    deliveryTime: draft?.scheduled_for ? formatShortDate(draft.scheduled_for) : '12:15',
    scheduled: draft?.status === 'scheduled',
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
                className="mb-4 rounded-md border border-[color-mix(in_srgb,var(--safety-red)_30%,transparent)] px-4 py-3 text-sm text-safety-red"
              >
                {bootError}
              </p>
            ) : null}
            {draft !== null ? (
              <div className="mb-3">
                <StatusPill
                  status={draft.status}
                  scheduledFor={draft.scheduled_for}
                  deliveredAt={draft.delivered_at}
                />
              </div>
            ) : null}
            <StationeryCard
              envelope={envelope}
              draftText={draft?.content ?? ''}
              placeholder={HEART_NOTE_PLACEHOLDER}
              charCap={HEART_NOTE_CHAR_CAP}
              savedHint={savedHint}
              saveError={saveError}
              onTextChange={isTerminal ? undefined : handleTextChange}
            />
            <ScheduleDatePicker
              value={draft?.scheduled_for ?? null}
              disabled={isTerminal}
              onChange={handleScheduleChange}
            />
            {draft?.status === 'scheduled' ? (
              <button
                type="button"
                onClick={handleCancel}
                className="mt-2 self-start text-sm text-safety-red underline underline-offset-2 hover:text-safety-red"
              >
                Cancel note
              </button>
            ) : null}
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
      <HeartNoteActions
        onSave={handleManualSave}
        onCopyLink={activeChild !== null ? handleCopyLink : undefined}
        copyState={copyState}
        isSaving={isSaving}
      />
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

// Local mirror of the StatusPill date formatter — keeping it in the route
// keeps the StationeryCard envelope label consistent without a shared util.
function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
