import { useRef, useState } from 'react';
import type { PlanTileSummary, ProposeSwapResponse, Weekday } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';

// Story 14-s1 — the Brief's swap/picker interaction state, extracted verbatim
// from BriefCanvas. Owns the DisambiguationPicker lifecycle (which day is open,
// which item is swapping), the conversational proposal channel, and the
// focus-restoration ref. No visual/behaviour change.
export function useWeekSwap(planId: string | null) {
  // Story 3.12 — picker / swap-in-progress UI state.
  const [activeSwapDay, setActiveSwapDay] = useState<PlanTileSummary['day'] | null>(null);
  const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
  // Slice 5-S12 — tracks an in-flight conversational swap proposal; the matching
  // tile pulses (sacred-plum) until Lumi resolves it. The day is captured here
  // (not via onSwapStarted, which only carries the id) so the right tile pulses.
  const [pendingProposal, setPendingProposal] = useState<{
    id: string;
    day: PlanTileSummary['day'];
  } | null>(null);
  const lastProposalRef = useRef<{ id: string; day: PlanTileSummary['day'] } | null>(null);
  // Capture the tile element that opened the picker so dismiss can return focus
  // to it (WCAG 2.4.3 Focus Order). Cleared on dismiss to avoid stale targets.
  const swapTriggerRef = useRef<HTMLElement | null>(null);

  const dismissPicker = () => {
    setActiveSwapDay(null);
    const trigger = swapTriggerRef.current;
    swapTriggerRef.current = null;
    trigger?.focus();
  };

  // Slice 5-S12 — capture the parent's free-text swap intent as a proposal turn
  // in the family thread. Returns the proposal_id so the picker can fire
  // onSwapStarted; the day is stashed in lastProposalRef so onSwapStarted knows
  // this id is a proposal (pulse the tile) rather than a variation (spinner).
  async function handleProposeSwap(day: Weekday, content: string): Promise<string> {
    if (planId === null) throw new Error('No plan');
    const res = await hkFetch<ProposeSwapResponse>(
      `/v1/plans/${planId}/swap-proposals`,
      {
        method: 'POST',
        body: { day, content },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      },
    );
    lastProposalRef.current = { id: res.proposal_id, day };
    return res.proposal_id;
  }

  function onSwapStarted(id: string) {
    // 5-S12 — a proposal flow returns a proposal_id (tracked in lastProposalRef).
    // It pulses the matching tile but must NOT set swappingItemId, which would
    // lock the rest of the canvas.
    if (lastProposalRef.current?.id === id) {
      setPendingProposal(lastProposalRef.current);
      lastProposalRef.current = null;
      swapTriggerRef.current = null;
      setActiveSwapDay(null);
      return;
    }
    setSwappingItemId(id);
    swapTriggerRef.current = null;
    setActiveSwapDay(null);
  }

  function onSwapSettled() {
    setSwappingItemId(null);
  }

  return {
    activeSwapDay,
    setActiveSwapDay,
    swappingItemId,
    pendingProposal,
    dismissPicker,
    handleProposeSwap,
    onSwapStarted,
    onSwapSettled,
  };
}

// Named for BriefContent's props (14-s2) without re-deriving the shape.
export type WeekSwap = ReturnType<typeof useWeekSwap>;
