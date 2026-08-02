import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BriefStateRow, GetPlansResponse } from '@hivekitchen/types';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { usePlanProgressStore } from '@/stores/plan-progress.store.js';
import {
  useRequestRegenerationMutation,
  useUpdateSovereigntyModeMutation,
  usePlanEditMutation,
} from './mutations.js';

// Story 14-s1 — the Brief's plan-mutating lifecycle, extracted verbatim from
// BriefCanvas: regenerate (week/day), sovereignty toggle, confirm-week commit,
// and hard-fail banner recovery, plus the push-driven `isRegenerating` state and
// its two effects. No visual/behaviour change.
export function useComposeLifecycle(params: {
  householdId: string | null;
  planId: string | null;
  brief: BriefStateRow | null;
}) {
  const { householdId, planId, brief } = params;
  const queryClient = useQueryClient();
  // Story 3.13 — regenerating state. Stays true from POST 202 until the brief's
  // plan_revision increments, indicating the BullMQ job committed a new plan.
  const [isRegenerating, setIsRegenerating] = useState(false);
  const lastPlanRevisionRef = useRef<number | null>(null);
  const regenerateMutation = useRequestRegenerationMutation();
  // Story 3.29 — sovereignty toggle for the degraded inline note.
  const sovereigntyMutation = useUpdateSovereigntyModeMutation();
  const [sovereigntyError, setSovereigntyError] = useState(false);
  // 13-s10 (Task 5, W1) — confirm-week commit.
  const commitMutation = usePlanEditMutation();

  // Story 13-s2.5 — regeneration is push-driven. The server emits `plan.updated`
  // on commit, which invalidates ['brief']; the refetch bumps plan_revision and
  // the effect below clears the flag. A permanent failure pushes
  // `plan.progress: failed`, which clears the flag without a bump so the spinner
  // stops. (Replaces the old 5s setInterval poll.)
  const planProgressStage = usePlanProgressStore((s) => s.stage);
  useEffect(() => {
    if (!isRegenerating) return;
    if (planProgressStage === 'failed') {
      setIsRegenerating(false);
      usePlanProgressStore.getState().reset();
    }
  }, [isRegenerating, planProgressStage]);

  // Story 3.13 — detect plan_revision bump to stop the regenerating state. The
  // first time the brief loads, capture the baseline; any subsequent increase
  // clears the flag.
  useEffect(() => {
    if (!brief) return;
    if (lastPlanRevisionRef.current === null) {
      lastPlanRevisionRef.current = brief.plan_revision;
      return;
    }
    if (brief.plan_revision > lastPlanRevisionRef.current) {
      lastPlanRevisionRef.current = brief.plan_revision;
      setIsRegenerating(false);
    }
  }, [brief]);

  function handleToggleAlternatingSovereignty() {
    if (!householdId || sovereigntyMutation.isPending) return;
    setSovereigntyError(false);
    sovereigntyMutation.mutate(
      {
        householdId,
        input: { sovereignty_mode: 'alternating' },
        idempotencyKey: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          usePlanProgressStore.getState().reset();
          if (brief) {
            lastPlanRevisionRef.current = brief.plan_revision;
          }
          setIsRegenerating(true);
        },
        onError: (err) => {
          console.error('sovereignty mode toggle failed', err);
          setSovereigntyError(true);
        },
      },
    );
  }

  function handleRegenerate(scope: 'week' | 'day', day?: string) {
    if (!planId || isRegenerating) return;
    regenerateMutation.mutate(
      { planId, scope, day },
      {
        onSuccess: () => {
          usePlanProgressStore.getState().reset();
          if (brief) {
            lastPlanRevisionRef.current = brief.plan_revision;
          }
          setIsRegenerating(true);
        },
        onError: (err) => {
          console.error('regeneration failed', err);
        },
      },
    );
  }

  function handleConfirmWeek() {
    if (planId === null) return;
    commitMutation.mutate(
      { planId, body: { intent: { intent: 'commit', confidence: 1 } } },
      {
        onSuccess: () => {
          const confirmedAt = new Date().toISOString();
          queryClient.setQueryData<GetPlansResponse>(
            QueryKeys.planByWeek('current'),
            (prev) =>
              prev?.plan ? { ...prev, plan: { ...prev.plan, confirmed_at: confirmedAt } } : prev,
          );
          void queryClient.invalidateQueries({ queryKey: ['plan'] });
        },
      },
    );
  }

  // Story pre-4-s3 — banner-driven recovery. In hard-fail state planId is null
  // (no plan committed); fall back to invalidating plan + brief queries so the
  // UI picks up backend recovery on the next poll cycle.
  function handleBannerRetry() {
    if (planId) {
      handleRegenerate('week');
    } else {
      void queryClient.invalidateQueries({ queryKey: QueryKeys.planByWeek('current') });
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    }
  }

  return {
    isRegenerating,
    sovereigntyError,
    handleRegenerate,
    handleToggleAlternatingSovereignty,
    handleConfirmWeek,
    handleBannerRetry,
    confirming: commitMutation.isPending,
    regeneratePending: regenerateMutation.isPending,
    sovereigntyPending: sovereigntyMutation.isPending,
  };
}

// Named for BriefContent's props (14-s2) without re-deriving the shape.
export type ComposeLifecycle = ReturnType<typeof useComposeLifecycle>;
