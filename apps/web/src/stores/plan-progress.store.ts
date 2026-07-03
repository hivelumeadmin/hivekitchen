import { create } from 'zustand';
import type { PlanProgressEvent } from '@hivekitchen/types';

// Story 13-s2.5 — pushed plan-generation progress. The SSE bridge writes the
// latest `plan.progress` stage here so the Brief draft spinner reflects the real
// phase (composing → guardrail → persisting → ready/failed) instead of a fixed
// "~30s". A household generates one plan at a time, so tracking the latest stage
// (with its week_id) is sufficient — no per-week map is needed.
export type PlanProgressStage = PlanProgressEvent['stage'];

interface PlanProgressState {
  stage: PlanProgressStage | null;
  weekId: string | null;
  setProgress: (weekId: string, stage: PlanProgressStage) => void;
  reset: () => void;
}

export const usePlanProgressStore = create<PlanProgressState>()((set) => ({
  stage: null,
  weekId: null,
  setProgress: (weekId, stage) => set({ weekId, stage }),
  reset: () => set({ stage: null, weekId: null }),
}));

// Human-readable copy for each in-flight stage. `ready`/`failed` are terminal
// and handled by the surrounding component (unmount / error), so they map to
// null here — the spinner only renders the working stages.
export function planProgressLabel(stage: PlanProgressStage | null): string | null {
  switch (stage) {
    case 'queued':
      return 'Lumi is getting started…';
    case 'composing':
      return 'Lumi is composing your plan…';
    case 'guardrail':
      return 'Checking every meal against your allergens…';
    case 'persisting':
      return 'Saving your week…';
    default:
      return null;
  }
}
