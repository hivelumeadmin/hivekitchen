import { useEffect, useState } from 'react';
import { hkFetch } from '@/lib/fetch.js';
import { usePlanProgressStore, planProgressLabel } from '@/stores/plan-progress.store.js';
import { useGenerateOnDemandMutation } from './mutations.js';
import { PrimaryButton } from '@/components/PrimaryButton.js';
import { SparkleIcon } from '@/components/icons.js';

function DevTriggerButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleClick() {
    setStatus('loading');
    try {
      await hkFetch('/v1/dev/trigger-plan-generation', { method: 'POST' });
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={status === 'loading' || status === 'done'}
      className="text-xs text-fg-muted underline underline-offset-2 disabled:opacity-50"
    >
      {status === 'loading' && 'Triggering…'}
      {status === 'done' && 'Job queued — refresh in a moment'}
      {status === 'error' && 'Failed — check API logs'}
      {status === 'idle' && '[dev] Generate plan now'}
    </button>
  );
}

// Story 3-S34 — on-demand ("compose now") trigger. Shown in the empty state so
// a parent with no plan yet can compose immediately instead of waiting for the
// Friday auto-generation. The server derives the window (rest-of-this-week vs
// next-week-full) from the household timezone; on success we poll the brief
// until the plan lands (this branch unmounts when brief !== null).
function ComposeMyPlanButton() {
  const generate = useGenerateOnDemandMutation();
  const [isComposing, setIsComposing] = useState(false);
  const [hasError, setHasError] = useState(false);
  // Story 13-s2.5 — the composing lifecycle is push-driven. On success the
  // background job emits `plan.progress` stages then `plan.updated`; the latter
  // invalidates ['brief']+['plan'], the parent refetches, brief becomes non-null
  // and this empty-state branch unmounts. A permanent failure pushes
  // `plan.progress: failed`, which restores the button with an error.
  const progressStage = usePlanProgressStore((s) => s.stage);

  useEffect(() => {
    if (!isComposing) return;
    if (progressStage === 'failed') {
      setIsComposing(false);
      setHasError(true);
      usePlanProgressStore.getState().reset();
    }
  }, [isComposing, progressStage]);

  if (isComposing) {
    return (
      <p className="text-sm text-fg-muted text-center" role="status">
        {planProgressLabel(progressStage) ?? 'Lumi is composing your plan…'} this can take a minute.
      </p>
    );
  }

  function handleClick() {
    setHasError(false);
    // Clear any terminal stage from a prior compose so a stale `failed`/`ready`
    // does not immediately trip the effect above for this new run.
    usePlanProgressStore.getState().reset();
    // Capture the key once so React Query retries reuse it — a fresh UUID per
    // retry would defeat deduplication and consume extra rate-limit slots.
    const idempotencyKey = crypto.randomUUID();
    generate.mutate(idempotencyKey, {
      onSuccess: () => setIsComposing(true),
      onError: () => setHasError(true),
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <PrimaryButton
        onClick={handleClick}
        disabled={generate.isPending}
        icon={<SparkleIcon />}
        ariaLabel="Compose my plan now"
      >
        {generate.isPending ? 'Starting…' : 'Compose my plan'}
      </PrimaryButton>
      {hasError && (
        <p className="text-xs text-clay-600" role="alert">
          Couldn&rsquo;t start composing. Please try again.
        </p>
      )}
    </div>
  );
}

// Story 14-s2 — the Brief's "no plan yet" empty branch, extracted verbatim
// (carries the AC7-exempt ComposeMyPlanButton + DevTriggerButton with it).
export function BriefEmptyState() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-grow flex items-center justify-center px-6 pt-12 pb-24">
      <div className="flex flex-col items-center gap-4">
        <p className="max-w-sm text-base text-fg-muted text-center">
          Lumi is preparing your first plan. Check back Sunday evening.
        </p>
        <ComposeMyPlanButton />
        {import.meta.env.DEV && <DevTriggerButton />}
      </div>
    </main>
  );
}
