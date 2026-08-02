import type { Turn } from '@hivekitchen/types';
import type { LumiSliceCreator, PanelMode, PlanEditScope, PresenceState } from './types.js';

export interface PresenceData {
  presenceState: PresenceState;
  panelMode: PanelMode;
  planEditScope: PlanEditScope | null;

  pendingNudge: Turn | null;
  // Story 12-S12 — mirror of users.notification_prefs.proactive_lumi_nudges so
  // the in-panel "Pause/Resume nudges" toggle can render + optimistically update
  // without a new store. Hydrated from /v1/users/me wherever it is read (account
  // page); defaults to opted-in.
  proactiveNudges: boolean;
}

export interface PresenceSlice extends PresenceData {
  // 13-s10 — arm the plan-edit scope, then summon(). Pass null to clear.
  setPlanEditScope: (scope: PlanEditScope | null) => void;
  summon: (mode?: PanelMode) => void;
  recede: () => void;
  // 13-s3 — drives the whisper channel (one quiet dismissible line).
  whisper: () => void;
  // 13-s3 — atomic nudge dismiss: clears the nudge and recedes in one set() call
  // to prevent a torn intermediate state (pendingNudge=null + presenceState='whisper').
  dismissNudge: () => void;
  setNudge: (turn: Turn | null) => void;
  setProactiveNudges: (value: boolean) => void;
  // 14-s6 — the arriving-nudge gate, lifted out of the SSE dispatcher so the
  // atRest→whisper trigger condition is unit-testable without an EventSource.
  // Returns whether the whisper fired.
  tryWhisper: () => boolean;
}

export const PRESENCE_INITIAL_STATE: PresenceData = {
  presenceState: 'atRest',
  panelMode: 'text',
  planEditScope: null,

  pendingNudge: null,
  proactiveNudges: true,
};

export const createPresenceSlice: LumiSliceCreator<PresenceSlice> = (set, get) => ({
  ...PRESENCE_INITIAL_STATE,

  setPlanEditScope: (scope) => set({ planEditScope: scope }),

  // Summon the focused sheet. Acknowledges any waiting nudge — the dot reverts to
  // calm (Story 12-S12 AC#10, carried forward to the valet model).
  summon: (mode) =>
    set((state) => ({
      presenceState: 'summoned',
      panelMode: mode ?? state.panelMode,
      pendingNudge: null,
    })),

  // Recede back into the finished product (valet rule 5). Works from both
  // 'summoned' and 'whisper' states — returns to the calm at-rest dot.
  recede: () => set({ presenceState: 'atRest', planEditScope: null }),

  // Surface a pending nudge as one quiet dismissible line (valet rule 3).
  // The dot stops breathing — the whisper IS the signal.
  whisper: () => set({ presenceState: 'whisper' }),

  // Atomic dismiss: clears the nudge and recedes in one set() call so no
  // subscriber ever sees presenceState='whisper' with pendingNudge=null.
  dismissNudge: () => set({ pendingNudge: null, presenceState: 'atRest', planEditScope: null }),

  setNudge: (turn) => set({ pendingNudge: turn }),

  setProactiveNudges: (value) => set({ proactiveNudges: value }),

  // Only whisper from a fully at-rest dot: 'summoned' means the parent is
  // already looking at Lumi, and 'whisper' means a line is already showing.
  tryWhisper: () => {
    const { proactiveNudges, presenceState } = get();
    if (!proactiveNudges || presenceState !== 'atRest') return false;
    set({ presenceState: 'whisper' });
    return true;
  },
});
