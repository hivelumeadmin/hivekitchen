import { useState } from 'react';
import { useScopeGuard } from '@hivekitchen/ui';
import { HeartNotePayloadSchema } from '@hivekitchen/contracts';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { PrimaryButton } from '@/components/PrimaryButton.js';
import { CalendarIcon, CheckCircleIcon, SendIcon } from '@/components/icons.js';

interface Readonly_HeartNoteComposerProps {
  readonly childId: string;
  readonly childName: string;
  readonly grandparentName: string;
  readonly grandparentTerm: string | null; // null → no sacred-plum underline
  readonly notesUsed: number;
  readonly cap: number;
  readonly nextMonthOpens: string; // YYYY-MM-DD
}

export type HeartNoteComposerProps = Readonly<Readonly_HeartNoteComposerProps>;

type SaveState = 'idle' | 'saving' | 'sent' | 'scheduled' | 'error';

export function HeartNoteComposer(props: HeartNoteComposerProps) {
  // UX-DR22 — dev-mode assertion if rendered outside `.grandparent-scope`.
  useScopeGuard('grandparent-scope');

  const { childId, childName, grandparentTerm, cap, nextMonthOpens } = props;
  const [content, setContent] = useState('');
  // Starts from the server count; flips to `cap` if a POST is rejected for the
  // cap mid-session, which transitions the card into the at-cap rhythm state.
  const [effectiveNotesUsed, setEffectiveNotesUsed] = useState(props.notesUsed);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const isAtCap = effectiveNotesUsed >= cap;
  const isAtSoftCap = !isAtCap && effectiveNotesUsed === cap - 1;
  const isSaving = saveState === 'saving';

  async function handleSend() {
    if (isSaving || content.trim().length === 0) return;
    setSaveState('saving');
    try {
      const raw = await hkFetch<unknown>('/v1/heart-notes', {
        method: 'POST',
        body: { child_id: childId, content },
      });
      HeartNotePayloadSchema.parse(raw);
      setSaveState('sent');
    } catch (err) {
      // Cap reached between page load and submit → flip to the at-cap rhythm.
      if (err instanceof HkApiError && err.status === 422) {
        setEffectiveNotesUsed(cap);
        setSaveState('idle');
        return;
      }
      setSaveState('error');
    }
  }

  async function handleScheduleNextMonth() {
    if (isSaving) return;
    setSaveState('saving');
    try {
      // An empty draft scheduled for next month — the grandparent writes it
      // once the month rolls over. The cap bypass lives in the API route.
      const raw = await hkFetch<unknown>('/v1/heart-notes', {
        method: 'POST',
        body: { child_id: childId, content: '', scheduled_for: nextMonthOpens },
      });
      HeartNotePayloadSchema.parse(raw);
      setSaveState('scheduled');
    } catch {
      setSaveState('error');
    }
  }

  if (saveState === 'sent') {
    return (
      <ConfirmationPanel heading="Sent ✓" body={`Your note is on its way to ${childName}.`} />
    );
  }
  if (saveState === 'scheduled') {
    return (
      <ConfirmationPanel
        heading={`Saved for ${formatMonthDay(nextMonthOpens)}.`}
        body="You'll be able to write your note then."
      />
    );
  }

  if (isAtCap) {
    return (
      <div className="rounded-lg bg-surface p-8">
        <p className="font-serif text-[26px] leading-relaxed text-fg">
          {childName} has both of your notes this month
          {grandparentTerm ? (
            <>
              , <TermHighlight name={grandparentTerm} />
            </>
          ) : null}
          .
          <br />
          The next one opens {formatMonthDay(nextMonthOpens)}.
        </p>

        <textarea
          value={content}
          readOnly
          className="mt-6 min-h-[140px] w-full cursor-not-allowed resize-none border-none bg-transparent font-serif text-[26px] leading-relaxed text-fg opacity-50 focus:outline-none"
          aria-label="Heart Note (read-only — monthly cap reached)"
        />

        <p className="mt-2 text-[15px] text-safety-red">Both notes used this month</p>

        <PrimaryButton
          size="lg"
          icon={<CalendarIcon />}
          onClick={() => void handleScheduleNextMonth()}
          disabled={isSaving}
          className="mt-6"
        >
          {`Save for ${formatButtonDate(nextMonthOpens)}`}
        </PrimaryButton>

        {saveState === 'error' ? <ErrorLine /> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface p-8">
      <p className="mb-3 text-[18px] text-fg-muted">A note for {childName}</p>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={`Write something for ${childName}…`}
        maxLength={280}
        className="min-h-[220px] w-full resize-none border-none bg-transparent font-serif text-[26px] leading-relaxed text-fg placeholder:text-fg-muted/40 focus:outline-none focus:ring-0"
        aria-label="Heart Note"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className={`text-[15px] ${isAtSoftCap ? 'text-amber' : 'text-fg-muted'}`}>
          Note {effectiveNotesUsed + 1} of {cap} this month
        </span>
        <span className="text-[13px] text-fg-muted/60">{content.length} / 280</span>
      </div>

      <PrimaryButton
        size="lg"
        icon={<SendIcon />}
        onClick={() => void handleSend()}
        disabled={isSaving || content.trim().length === 0}
        className="mt-6"
      >
        {isSaving ? 'Sending…' : `Tuck into ${childName}'s ${nextSchoolDay()} lunch`}
      </PrimaryButton>

      {saveState === 'error' ? <ErrorLine /> : null}
    </div>
  );
}

// Cultural recognition (AC9, UX-DR22) — sacred-plum underline on the family
// term inside the system-rendered rhythm copy. Underline only; the text colour
// stays the surrounding paragraph colour. Never applied to Heart Note content.
function TermHighlight({ name }: { readonly name: string }) {
  return (
    <span className="underline decoration-sacred decoration-2 underline-offset-2">{name}</span>
  );
}

function ConfirmationPanel({
  heading,
  body,
}: {
  readonly heading: string;
  readonly body: string;
}) {
  return (
    <div className="rounded-lg bg-surface p-8 text-center">
      <CheckCircleIcon className="mx-auto h-10 w-10 text-safety-cleared" />
      <p className="mt-4 font-serif text-[26px] leading-relaxed text-fg">{heading}</p>
      <p className="mt-2 text-[18px] text-fg-muted">{body}</p>
    </div>
  );
}

function ErrorLine() {
  return (
    <p role="alert" className="mt-3 text-[15px] text-safety-red">
      Something went wrong. Please try again.
    </p>
  );
}

// "1 July" — day + month name, no year (used in the rhythm copy + confirmation).
function formatMonthDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(
    new Date(year ?? 0, (month ?? 1) - 1, day ?? 1),
  );
}

// "Jul 1" — short month + day (used in the "Save for …" button label).
function formatButtonDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
    new Date(year ?? 0, (month ?? 1) - 1, day ?? 1),
  );
  return `${monthShort} ${String(day ?? 1)}`;
}

// Next school day (Mon–Fri) from today, for the send affordance copy.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function nextSchoolDay(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun, 6=Sat
  const add = dow === 0 ? 1 : dow === 5 ? 3 : dow === 6 ? 2 : 1;
  d.setDate(d.getDate() + add);
  return DAYS[d.getDay()]!;
}
