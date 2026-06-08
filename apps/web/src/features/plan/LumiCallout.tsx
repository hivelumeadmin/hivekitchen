import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LearningMomentAction, LearningMomentCallout as LearningMomentCalloutType } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';

interface LumiCalloutProps {
  readonly callout: LearningMomentCalloutType;
  readonly householdId: string;
  readonly onTellMore?: () => void;
}

const ACTIONS: ReadonlyArray<{ label: string; action: LearningMomentAction }> = [
  { label: 'Yes, keep it in mind', action: 'confirm' },
  { label: 'Tell me more', action: 'tell_more' },
  { label: 'Not for us', action: 'dismiss' },
];

/**
 * Slice 5-S8 — the "I noticed" learning-moment callout in the Brief footer.
 * Lumi's voice (editorial serif); three secondary pills. Tapping any action
 * POSTs to the respond endpoint, then invalidates the Brief query so the
 * callout unmounts on the next refetch. No voice, no SSE, no stores.
 */
export function LumiCallout({ callout, householdId, onTellMore }: LumiCalloutProps) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function respond(action: LearningMomentAction) {
    if (submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      await hkFetch(`/v1/households/${householdId}/brief/learning-moment`, {
        method: 'POST',
        // hkFetch JSON-stringifies the body — pass the raw object.
        body: { action },
      });
      if (action === 'tell_more') onTellMore?.();
      void queryClient.invalidateQueries({ queryKey: QueryKeys.brief(householdId) });
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="mb-6 rounded-lg bg-surface-2 px-4 py-3"
      role="region"
      aria-label="Lumi noticed"
      aria-busy={submitting}
    >
      <p className="mb-1 font-sans text-xs font-medium text-honey-amber-600">Lumi noticed</p>
      <p className="font-serif text-base text-fg">{callout.prose}</p>
      {failed && (
        <p className="mt-1 font-sans text-xs text-safety-red" role="alert">
          Something went wrong — tap again to retry.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.map(({ label, action }) => (
          <button
            key={action}
            type="button"
            onClick={() => void respond(action)}
            disabled={submitting}
            className="rounded-full border border-border px-3 py-1 font-sans text-[13px] text-fg-muted transition-colors hover:text-fg motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-honey-amber-600 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
