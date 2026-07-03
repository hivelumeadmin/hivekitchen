import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  GetPlansResponse,
  PlanEditResult,
  PlanIntentResult,
} from '@hivekitchen/types';
import { useLumiStore, type PlanEditScope, type PlanEditDay } from '@/stores/lumi.store.js';
import { usePlanProgressStore, planProgressLabel } from '@/stores/plan-progress.store.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import {
  usePlanEditMutation,
  useRequestRegenerationMutation,
  useGenerateOnDemandMutation,
  safeRandomUuid,
} from './mutations.js';
import { clarifyCopy, escalateCopy, resultCopy } from './plan-edit-copy.js';
import { mergePlanEditDelta, collectDeltaRows, hasDeltaRows } from './plan-edit-cache.js';

// Epic 13-s10 — the conversational plan-edit exchange inside the summoned sheet.
// Ephemeral by design (valet doctrine — the artifact is the product, the
// exchange recedes): entries live only for the life of the summon; the edit
// endpoint persists no thread turn. A typed utterance costs one classifier call;
// chip taps and confirms are pre-built {intent} posts (zero LLM). The expensive
// path fires ONLY through the escalate confirm gate below.

const DAY_LABELS: Record<PlanEditDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
};

const SHORT_TO_FULL: Record<PlanEditDay, string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
};

const ALL_DAYS: PlanEditDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

interface Entry {
  id: string;
  role: 'user' | 'lumi';
  text: string;
}

export function PlanEditPanel({ scope }: { scope: PlanEditScope }) {
  const queryClient = useQueryClient();
  const editMutation = usePlanEditMutation();
  const regenerate = useRequestRegenerationMutation();
  const generateNext = useGenerateOnDemandMutation();
  const progressStage = usePlanProgressStore((s) => s.stage);

  // AC9 — a compose_next offer opens the sheet directly on the confirm gate.
  const [entries, setEntries] = useState<Entry[]>(() =>
    scope.offer === 'compose_next'
      ? [{ id: safeRandomUuid(), role: 'lumi', text: escalateCopy('compose_next').line }]
      : [],
  );
  const [draft, setDraft] = useState('');
  const [lastResult, setLastResult] = useState<PlanEditResult | null>(() =>
    scope.offer === 'compose_next' ? { status: 'escalate', reason: 'compose_next' } : null,
  );
  const [lastIntent, setLastIntent] = useState<PlanIntentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const isSending = editMutation.isPending;

  function appendEntry(role: Entry['role'], text: string) {
    setEntries((prev) => [...prev, { id: safeRandomUuid(), role, text }]);
  }

  // Write an applied delta straight into the plan cache (AC3 — no blocking
  // refetch; the plan.updated SSE remains the authoritative reconciler).
  function writeDelta(result: PlanEditResult) {
    const rows = collectDeltaRows(result);
    if (!hasDeltaRows(rows)) return;
    for (const week of ['current', 'next'] as const) {
      const key = QueryKeys.planByWeek(week);
      const prev = queryClient.getQueryData<GetPlansResponse>(key);
      if (prev?.plan?.id === scope.planId) {
        queryClient.setQueryData(key, mergePlanEditDelta(prev, result));
      }
    }
  }

  function handleResult(intent: PlanIntentResult, result: PlanEditResult) {
    setLastIntent(intent);
    setLastResult(result);
    if (result.status === 'applied') writeDelta(result);
    appendEntry('lumi', resultCopy(result, scope.dayLabel));
  }

  function runTurn(body: { utterance: string } | { intent: PlanIntentResult }) {
    setError(null);
    editMutation.mutate(
      { planId: scope.planId, body },
      {
        onSuccess: (res) => handleResult(res.intent, res.result),
        onError: () => setError("Lumi couldn't do that just now. Try again."),
      },
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const utterance = draft.trim();
    if (!utterance || isSending) return;
    appendEntry('user', utterance);
    setDraft('');
    // A fresh utterance clears any pending clarify/escalate affordance.
    setLastResult(null);
    runTurn({ utterance });
  }

  // Chip bypass (AC4): re-submit the PRIOR intent with the picked slot merged —
  // never a new utterance. confidence:1 marks the structured (zero-LLM) path.
  function pickDay(day: PlanEditDay) {
    if (!lastIntent) return;
    setLastResult(null);
    runTurn({ intent: { ...lastIntent, day, confidence: 1 } });
  }
  function pickChild(childId: string) {
    if (!lastIntent) return;
    setLastResult(null);
    runTurn({ intent: { ...lastIntent, childId, confidence: 1 } });
  }

  // Escalate confirm-then-fire (AC5). Nothing here runs without an explicit tap.
  function confirmEscalation(reason: string) {
    setLastResult(null);
    const key = safeRandomUuid();
    if (reason === 'recompose') {
      setDrafting(true);
      regenerate.mutate({ planId: scope.planId, scope: 'week' });
    } else if (reason === 'compose_next') {
      setDrafting(true);
      generateNext.mutate(key);
    } else {
      // catalog_miss / add_dish → a genuine day-scope compose for the target day.
      const targetShort = lastIntent?.day ?? scope.day;
      if (!targetShort) {
        // No day to target — ask via day chips first (fall back to a clarify).
        setLastIntent(lastIntent ?? { intent: 'add_dish', confidence: 1 });
        setLastResult({ status: 'clarify', reason: 'day_required' });
        appendEntry('lumi', clarifyCopy('day_required').line);
        return;
      }
      setDrafting(true);
      regenerate.mutate({
        planId: scope.planId,
        scope: 'day',
        day: SHORT_TO_FULL[targetShort],
      });
    }
    appendEntry('lumi', "On it — I'll have something in about a minute.");
  }

  function declineEscalation() {
    setLastResult(null);
    appendEntry('lumi', "Okay — I'll leave it as is.");
    useLumiStore.getState().recede();
  }

  const days = scope.days && scope.days.length > 0 ? scope.days : ALL_DAYS;
  const children = scope.children ?? [];
  const clarify = lastResult?.status === 'clarify' ? clarifyCopy(lastResult.reason) : null;
  const escalate = lastResult?.status === 'escalate' ? escalateCopy(lastResult.reason) : null;
  const draftingLabel = drafting ? planProgressLabel(progressStage) ?? "Lumi's drafting…" : null;

  const contextLine =
    scope.dayLabel !== undefined
      ? scope.dishes && scope.dishes.length > 0
        ? `${scope.dayLabel} · ${scope.dishes.join(', ')}`
        : scope.dayLabel
      : 'This week';

  return (
    <div className="flex flex-col gap-3" data-testid="plan-edit-panel">
      <p className="font-sans text-xs text-fg-muted">{contextLine}</p>

      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-live="polite">
        {entries.length === 0 ? (
          <p className="font-sans text-sm text-fg-muted">
            Tell me what to change{scope.dayLabel ? ` about ${scope.dayLabel}` : ''}.
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-0.5">
              <span className="font-sans text-[11px] uppercase tracking-wide text-fg-muted">
                {entry.role === 'user' ? 'You' : 'Lumi'}
              </span>
              <p className="font-sans text-sm text-fg whitespace-pre-wrap">{entry.text}</p>
            </div>
          ))
        )}
      </div>

      {/* Clarify chips — zero-LLM recovery (AC4). Render below Lumi's turn. */}
      {clarify?.chips === 'day' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pick a day">
          {days.map((day) => (
            <ActionChip key={day} onClick={() => pickDay(day)} disabled={isSending}>
              {DAY_LABELS[day]}
            </ActionChip>
          ))}
        </div>
      )}
      {clarify?.chips === 'child' && children.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pick a child">
          {children.map((child) => (
            <ActionChip key={child.id} onClick={() => pickChild(child.id)} disabled={isSending}>
              {child.name || 'This child'}
            </ActionChip>
          ))}
        </div>
      )}

      {/* Escalate confirm-then-fire (AC5). */}
      {escalate && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => confirmEscalation(lastResult!.status === 'escalate' ? lastResult!.reason : '')}
            disabled={isSending}
            className="font-sans text-xs px-3 py-1 rounded bg-lumi-terracotta text-white hover:bg-lumi-terracotta-warmed transition-colors motion-reduce:transition-none disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-foliage"
          >
            {escalate.confirmLabel}
          </button>
          <button
            type="button"
            onClick={declineEscalation}
            className="font-sans text-xs px-3 py-1 rounded border border-border text-fg hover:bg-surface-2 transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage"
          >
            {escalate.declineLabel}
          </button>
        </div>
      )}

      {draftingLabel !== null && (
        <p role="status" aria-live="polite" className="font-sans text-xs text-fg-muted italic">
          {draftingLabel}
        </p>
      )}

      <form onSubmit={handleSubmit} className="border-t border-border pt-3">
        <textarea
          aria-label="Tell Lumi what to change"
          placeholder="e.g. less spicy Thursday"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isSending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e as unknown as FormEvent);
            }
          }}
          className="w-full resize-none rounded-md border border-border bg-surface text-fg px-2 py-1 font-sans text-sm placeholder:text-fg-muted disabled:bg-surface-2 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-foliage"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSending || !draft.trim()}
            className="font-sans text-xs px-3 py-1 rounded bg-lumi-terracotta text-white hover:bg-lumi-terracotta-warmed transition-colors motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-foliage"
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {error !== null && (
          <p role="alert" className="mt-1 font-sans text-xs text-lumi-terracotta">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

// Local action chip (single-shot; fires on tap). Matches the ChoiceChip visual
// idiom without a cross-feature import into features/onboarding — action chips
// here carry no persistent selected state (the Honey rule's foliage-on-select is
// for multi/single-select choice chips, not momentary actions).
function ActionChip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-sans text-xs px-3 py-1 rounded-full border border-border bg-surface text-fg hover:bg-surface-2 transition-colors motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-foliage"
    >
      {children}
    </button>
  );
}
