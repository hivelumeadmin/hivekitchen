import type { LumiContextSignal, LumiSurface, Turn } from '@hivekitchen/types';
import type { LumiSliceCreator } from './types.js';

export interface ThreadState {
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;

  threadIds: Partial<Record<LumiSurface, string>>;
  turns: Turn[];
  isHydrating: boolean;
}

export interface ThreadSlice extends ThreadState {
  setContext: (signal: LumiContextSignal) => void;
  appendAction: (description: string) => void;
  hydrateThread: (surface: LumiSurface, threadId: string, turns: Turn[]) => void;
  appendTurn: (turn: Turn) => void;
  removeTurn: (turnId: string) => void;
}

export const THREAD_INITIAL_STATE: ThreadState = {
  surface: 'general',
  contextSignal: null,

  threadIds: {},
  turns: [],
  isHydrating: false,
};

export const createThreadSlice: LumiSliceCreator<ThreadSlice> = (set) => ({
  ...THREAD_INITIAL_STATE,

  // Cross-slice atomic: a surface registration also recedes presence and clears
  // the plan-edit scope. It stays ONE set() so no subscriber can observe the
  // intermediate state (new surface + stale scope, or cleared turns + summoned).
  setContext: (signal) =>
    set({
      surface: signal.surface,
      contextSignal: signal,
      // A new surface registration clears any stale plan-edit scope and
      // recedes the sheet — prevents a summon() call on /app/lumi from
      // leaving presenceState:'summoned' when the user navigates away.
      planEditScope: null,
      presenceState: 'atRest',
      turns: [],
      isHydrating: false,
    }),

  // Cap recent_actions at 5 with FIFO eviction. No-op if no contextSignal yet.
  appendAction: (description) =>
    set((state) => {
      if (!state.contextSignal) return {};
      const prev = state.contextSignal.recent_actions ?? [];
      const next = [...prev, description].slice(-5);
      return { contextSignal: { ...state.contextSignal, recent_actions: next } };
    }),

  // surface arg guards against TOCTOU: caller passes the surface it fetched for,
  // so a mid-flight setContext() cannot write the thread ID under the wrong key.
  hydrateThread: (surface, threadId, turns) =>
    set((state) => ({
      threadIds: { ...state.threadIds, [surface]: threadId },
      // Only replace turns when the hydrated surface is still the active one.
      turns: state.surface === surface ? turns : state.turns,
      isHydrating: state.surface === surface ? false : state.isHydrating,
    })),

  appendTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),

  // Slice 5-S10 — remove a resolved family-language ratification turn so its card
  // disappears once the parent opts in / forgets.
  removeTurn: (turnId) =>
    set((state) => ({ turns: state.turns.filter((t) => t.id !== turnId) })),
});
