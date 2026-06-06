import { create } from 'zustand';
import type { LumiSurface, LumiContextSignal, Turn } from '@hivekitchen/types';

type VoiceStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error';
type PanelMode = 'text' | 'voice';

interface LumiState {
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;

  threadIds: Partial<Record<LumiSurface, string>>;
  turns: Turn[];
  isHydrating: boolean;

  talkSessionId: string | null;
  voiceStatus: VoiceStatus;
  isSpeaking: boolean;
  voiceError: string | null;

  isPanelOpen: boolean;
  panelMode: PanelMode;

  pendingNudge: Turn | null;
  // Story 12-S12 — mirror of users.notification_prefs.proactive_lumi_nudges so
  // the in-panel "Pause/Resume nudges" toggle can render + optimistically update
  // without a new store. Hydrated from /v1/users/me wherever it is read (account
  // page); defaults to opted-in.
  proactiveNudges: boolean;
}

interface LumiActions {
  setContext: (signal: LumiContextSignal) => void;
  appendAction: (description: string) => void;
  openPanel: (mode?: PanelMode) => void;
  closePanel: () => void;
  hydrateThread: (surface: LumiSurface, threadId: string, turns: Turn[]) => void;
  appendTurn: (turn: Turn) => void;
  setTalkSession: (sessionId: string) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setVoiceError: (msg: string | null) => void;
  endTalkSession: () => void;
  setNudge: (turn: Turn | null) => void;
  setProactiveNudges: (value: boolean) => void;
  reset: () => void;
}

const INITIAL_STATE: LumiState = {
  surface: 'general',
  contextSignal: null,

  threadIds: {},
  turns: [],
  isHydrating: false,

  talkSessionId: null,
  voiceStatus: 'idle',
  isSpeaking: false,
  voiceError: null,

  isPanelOpen: false,
  panelMode: 'text',

  pendingNudge: null,
  proactiveNudges: true,
};

export const useLumiStore = create<LumiState & LumiActions>()((set) => ({
  ...INITIAL_STATE,

  setContext: (signal) =>
    set({
      surface: signal.surface,
      contextSignal: signal,
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

  openPanel: (mode) =>
    set((state) => ({
      isPanelOpen: true,
      panelMode: mode ?? state.panelMode,
      // Opening the panel acknowledges any waiting nudge — the orb (driven by
      // pendingNudge !== null) reverts to calm. (Story 12-S12 AC#10.)
      pendingNudge: null,
    })),

  closePanel: () => set({ isPanelOpen: false }),

  // surface arg guards against TOCTOU: caller passes the surface it fetched for,
  // so a mid-flight setContext() cannot write the thread ID under the wrong key.
  hydrateThread: (surface, threadId, turns) =>
    set((state) => ({
      threadIds: { ...state.threadIds, [surface]: threadId },
      // Only replace turns when the hydrated surface is still the active one.
      turns: state.surface === surface ? turns : state.turns,
      isHydrating: state.surface === surface ? false : state.isHydrating,
    })),

  appendTurn: (turn) =>
    set((state) => ({ turns: [...state.turns, turn] })),

  setTalkSession: (sessionId) =>
    set({ talkSessionId: sessionId, voiceStatus: 'connecting', voiceError: null }),

  setVoiceStatus: (status) => set({ voiceStatus: status }),

  setVoiceError: (msg) =>
    set({ voiceError: msg, voiceStatus: msg === null ? 'idle' : 'error' }),

  endTalkSession: () =>
    set({
      talkSessionId: null,
      voiceStatus: 'idle',
      isSpeaking: false,
      voiceError: null,
      panelMode: 'text',
    }),

  setNudge: (turn) => set({ pendingNudge: turn }),

  setProactiveNudges: (value) => set({ proactiveNudges: value }),

  reset: () => set({ ...INITIAL_STATE }),
}));
