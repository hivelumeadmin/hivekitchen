import { useState } from 'react';
import type { OnboardingStateResponse } from '@hivekitchen/contracts';
import { ArrowRightIcon, RefreshIcon } from '@/components/icons.js';
import { PrimaryButton } from '@/components/PrimaryButton.js';
import { SecondaryButton } from '@/components/SecondaryButton.js';

interface Readonly_OnboardingResumeProps {
  /**
   * The in-progress state payload from GET /v1/onboarding/state. The parent
   * route guarantees `state.status === 'in_progress'` and that the optional
   * fields (`modality`, `started_at`, `last_activity_at`, `turns`) are
   * populated before mounting this component.
   */
  readonly state: OnboardingStateResponse;
  /** First-name greeting prefix. Falls back to "back" if unavailable. */
  readonly firstName?: string | null;
  /**
   * Continue with the existing thread. Parent flips the page mode to the
   * resumed mode (text, or text when origin was voice — see story AC5).
   */
  readonly onContinue: () => void;
  /**
   * Close the active thread and route back to the mode picker.
   * Returns a promise so the button can show a "Starting over…" state.
   */
  readonly onStartOver: () => Promise<void>;
}

export type OnboardingResumeProps = Readonly<Readonly_OnboardingResumeProps>;

export function OnboardingResume({
  state,
  firstName,
  onContinue,
  onStartOver,
}: OnboardingResumeProps) {
  const [resetting, setResetting] = useState(false);
  const modality = state.modality ?? 'text';
  // Slice 2-S26 — voice resume is text-only this slice. When the prior thread
  // was voice, surface a "Switch to text" CTA instead of "Continue" so the
  // user isn't left guessing why a voice-shaped offer renders text once they
  // tap it. The thread continues as voice on the server (turns are
  // role-tagged, not modality-tagged), so re-mounting OnboardingText against
  // a voice-origin thread is sound.
  const continueLabel = modality === 'voice' ? 'Switch to text' : 'Continue';
  const relative = state.last_activity_at
    ? formatRelative(new Date(state.last_activity_at))
    : 'recently';

  return (
    <section className="flex flex-1 items-center justify-center px-8 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <p className="text-xs uppercase tracking-widest text-fg-muted/80">
          {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        </p>
        <h1 className="font-serif text-2xl text-fg sm:text-3xl">
          You started a {modality} interview {relative}.
        </h1>
        <p className="font-serif text-base italic text-fg-muted">
          Pick up where you left off?
        </p>
        <div className="flex flex-col items-center gap-4">
          <PrimaryButton size="lg" icon={<ArrowRightIcon />} onClick={onContinue}>
            {continueLabel}
          </PrimaryButton>
          <SecondaryButton
            icon={<RefreshIcon />}
            onClick={() => {
              if (resetting) return;
              setResetting(true);
              void onStartOver().finally(() => setResetting(false));
            }}
            disabled={resetting}
          >
            {resetting ? 'Starting over…' : 'Start over'}
          </SecondaryButton>
        </div>
      </div>
    </section>
  );
}

// Slice 2-S26 — minimal relative-time formatter. Per story T6.2 we avoid
// adding a date-fns / dayjs dependency just for this one phrase. Three
// buckets cover the onboarding-resume timing window:
//   - <60 min: "earlier today"
//   - same UTC day, ≥60 min: "today"
//   - one calendar day ago: "yesterday"
//   - 2–13 days: "N days ago"
//   - ≥14 days: "a couple of weeks ago"
// Edge cases (clock skew, future timestamps, NaN) collapse to "recently".
export function formatRelative(when: Date, now: Date = new Date()): string {
  const ms = now.getTime() - when.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'recently';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return 'earlier today';
  const sameDay =
    when.getUTCFullYear() === now.getUTCFullYear() &&
    when.getUTCMonth() === now.getUTCMonth() &&
    when.getUTCDate() === now.getUTCDate();
  if (sameDay) return 'today';
  const days = Math.floor(ms / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return 'a couple of weeks ago';
}
