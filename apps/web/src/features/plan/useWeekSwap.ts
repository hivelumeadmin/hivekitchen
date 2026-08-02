import { useRef, useState } from 'react';
import type { PlanTileSummary, Weekday } from '@hivekitchen/types';
import { useProposeSwapMutation } from './mutations.js';

// Story 14-s1 — the Brief's swap/picker interaction state, extracted verbatim
// from BriefCanvas. Owns the DisambiguationPicker lifecycle (which day is open,
// which item is swapping), the conversational proposal channel, and the
// focus-restoration ref.
export function useWeekSwap(planId: string | null) {
  // Story 3.12 — picker / swap-in-progress UI state.
  const [activeSwapDay, setActiveSwapDayState] = useState<PlanTileSummary['day'] | null>(null);
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

  const proposeSwap = useProposeSwapMutation();

  // Story 14-s6 (D-14S1-4) — the ref used to be assigned `null` on every path,
  // making the focus restore below a permanent no-op. Opening the picker now
  // captures the focused element (the button the user activated), so Escape /
  // Cancel returns focus where it came from instead of dropping it to <body>.
  const setActiveSwapDay = (day: PlanTileSummary['day'] | null) => {
    // Only capture when opening from a closed picker. Retargeting to another
    // day happens while focus is INSIDE the open picker, and `key={activeSwapDay}`
    // destroys that node immediately — capturing it would hand dismiss a
    // detached element and drop focus to <body>, the very failure this fixes.
    if (day !== null && activeSwapDay === null) {
      const active = document.activeElement;
      swapTriggerRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    setActiveSwapDayState(day);
  };

  const dismissPicker = () => {
    setActiveSwapDayState(null);
    const trigger = swapTriggerRef.current;
    swapTriggerRef.current = null;
    // The trigger can be unmounted while the picker is open (an SSE
    // plan.updated that clears canSwap removes the "Swap a day" button), and
    // focusing a detached node silently drops focus to <body>.
    if (trigger !== null && trigger.isConnected) trigger.focus();
  };

  // Slice 5-S12 — capture the parent's free-text swap intent as a proposal turn
  // in the family thread. Returns the proposal_id so the picker can fire
  // onSwapStarted; the day is stashed in lastProposalRef so onSwapStarted knows
  // this id is a proposal (pulse the tile) rather than a variation (spinner).
  async function handleProposeSwap(day: Weekday, content: string): Promise<string> {
    if (planId === null) throw new Error('No plan');
    const res = await proposeSwap.mutateAsync({ planId, day, content });
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
      setActiveSwapDayState(null);
      return;
    }
    setSwappingItemId(id);
    swapTriggerRef.current = null;
    setActiveSwapDayState(null);
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
