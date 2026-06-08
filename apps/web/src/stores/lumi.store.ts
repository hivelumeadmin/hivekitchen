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

  // Story 5-S5 — synchronized voice captions. Ephemeral UI state (not server
  // truth): the latest user-speech transcript and Lumi reply for the active
  // voice turn. The voice session hook's onTranscript/onLumiReply callbacks
  // write here; <CaptionRibbon> in LumiPanel reads them. Cleared on session end.
  captionTranscript: string;
  captionLumiReply: string;

  // Slice 5-S6 — non-verbal "thinking" pulse. Set true when a `lumi.thinking`
  // voice frame arrives (the STT→reply gap); cleared when the reply starts/ends
  // or any error frame lands, and on session teardown, so a dropped turn never
  // leaves the pulse hanging.
  lumiThinking: boolean;

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
  removeTurn: (turnId: string) => void;
  setTalkSession: (sessionId: string) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setVoiceError: (msg: string | null) => void;
  setCaptionTranscript: (text: string) => void;
  setCaptionLumiReply: (text: string) => void;
  setLumiThinking: (value: boolean) => void;
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

  captionTranscript: '',
  captionLumiReply: '',

  lumiThinking: false,

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

  // Slice 5-S10 — remove a resolved family-language ratification turn so its card
  // disappears once the parent opts in / forgets.
  removeTurn: (turnId) =>
    set((state) => ({ turns: state.turns.filter((t) => t.id !== turnId) })),

  setTalkSession: (sessionId) =>
    set({ talkSessionId: sessionId, voiceStatus: 'connecting', voiceError: null }),

  setVoiceStatus: (status) => set({ voiceStatus: status }),

  setVoiceError: (msg) =>
    set({ voiceError: msg, voiceStatus: msg === null ? 'idle' : 'error' }),

  // A new user turn replaces the transcript and clears the prior Lumi caption so
  // captions never bleed across turns (the Lumi reply lands a moment later).
  setCaptionTranscript: (text) => set({ captionTranscript: text, captionLumiReply: '' }),

  setCaptionLumiReply: (text) => set({ captionLumiReply: text }),

  setLumiThinking: (value) => set({ lumiThinking: value }),

  endTalkSession: () =>
    set({
      talkSessionId: null,
      voiceStatus: 'idle',
      isSpeaking: false,
      voiceError: null,
      panelMode: 'text',
      captionTranscript: '',
      captionLumiReply: '',
      lumiThinking: false,
    }),

  setNudge: (turn) => set({ pendingNudge: turn }),

  setProactiveNudges: (value) => set({ proactiveNudges: value }),

  reset: () => set({ ...INITIAL_STATE }),
}));
