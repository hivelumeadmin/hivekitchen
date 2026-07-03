import { create } from 'zustand';
import type { LumiSurface, LumiContextSignal, Turn } from '@hivekitchen/types';

type VoiceStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error';
type PanelMode = 'text' | 'voice';

// Epic 13-s2 — the valet presence machine. `atRest` = the quiet ambient dot, no
// open sheet. `summoned` = the focused temporary sheet is open (runs a turn, then
// recedes). `whisper` is reserved for 13-s3 (the single dismissible nudge line);
// this slice defines the value but drives only atRest ↔ summoned.
export type PresenceState = 'atRest' | 'whisper' | 'summoned';

// Epic 13-s10 — the plan-edit scope. Frontend-only routing state (NOT part of
// the LumiContextSignal wire shape POSTed to /v1/lumi/turns): when it is set,
// the sheet routes a typed utterance to POST /v1/plans/:planId/edit instead of
// the general turn endpoint, and renders the tapped day's context. `day` is the
// short weekday the plan-intent classifier uses; dayLabel + dishes are the
// display context the summoning surface (a PlanTile, or the week-level
// TalkToLumi button) captured. Week-level scope omits day/dayLabel/dishes.
export type PlanEditDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';

export interface PlanEditScope {
  planId: string;
  weekOf: string;
  day?: PlanEditDay;
  dayLabel?: string;
  dishes?: string[];
  // Rosters the zero-LLM clarify chips draw from (captured by the summoning
  // surface so the sheet stays self-contained — no extra queries). `days` is the
  // week's non-paused days; `children` is the plan's child roster (id + name).
  days?: PlanEditDay[];
  children?: { id: string; name: string }[];
  // 13-s10 (AC9) — a proactive offer that opens the sheet directly on a
  // confirm-then-fire gate (e.g. the Friday next-week nudge → compose_next). No
  // classifier call; nothing fires without the explicit confirm tap.
  offer?: 'compose_next';
}

interface LumiState {
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;
  planEditScope: PlanEditScope | null;

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

  presenceState: PresenceState;
  panelMode: PanelMode;

  pendingNudge: Turn | null;
  // Story 12-S12 — mirror of users.notification_prefs.proactive_lumi_nudges so
  // the in-panel "Pause/Resume nudges" toggle can render + optimistically update
  // without a new store. Hydrated from /v1/users/me wherever it is read (account
  // page); defaults to opted-in.
  proactiveNudges: boolean;

  // Slice 5-S13 — mirrors users.caption_only_mode. When true, the voice-session
  // hook skips TTS playback; captions still stream. Hydrated from /v1/users/me
  // at account page load (same pattern as proactiveNudges).
  captionOnlyMode: boolean;
}

interface LumiActions {
  setContext: (signal: LumiContextSignal) => void;
  appendAction: (description: string) => void;
  // 13-s10 — arm the plan-edit scope, then summon(). Pass null to clear.
  setPlanEditScope: (scope: PlanEditScope | null) => void;
  summon: (mode?: PanelMode) => void;
  recede: () => void;
  // 13-s3 — drives the whisper channel (one quiet dismissible line).
  whisper: () => void;
  // 13-s3 — atomic nudge dismiss: clears the nudge and recedes in one set() call
  // to prevent a torn intermediate state (pendingNudge=null + presenceState='whisper').
  dismissNudge: () => void;
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
  setCaptionOnlyMode: (value: boolean) => void;
  reset: () => void;
}

const INITIAL_STATE: LumiState = {
  surface: 'general',
  contextSignal: null,
  planEditScope: null,

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

  presenceState: 'atRest',
  panelMode: 'text',

  pendingNudge: null,
  proactiveNudges: true,
  captionOnlyMode: false,
};

export const useLumiStore = create<LumiState & LumiActions>()((set) => ({
  ...INITIAL_STATE,

  setContext: (signal) =>
    set({
      surface: signal.surface,
      contextSignal: signal,
      // A new surface registration clears any stale plan-edit scope.
      planEditScope: null,
      turns: [],
      isHydrating: false,
    }),

  setPlanEditScope: (scope) => set({ planEditScope: scope }),

  // Cap recent_actions at 5 with FIFO eviction. No-op if no contextSignal yet.
  appendAction: (description) =>
    set((state) => {
      if (!state.contextSignal) return {};
      const prev = state.contextSignal.recent_actions ?? [];
      const next = [...prev, description].slice(-5);
      return { contextSignal: { ...state.contextSignal, recent_actions: next } };
    }),

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
  // Called by useLumiNudgeSSE when proactiveNudges is true and the sheet is
  // not already open. The dot stops breathing — the whisper IS the signal.
  whisper: () => set({ presenceState: 'whisper' }),

  // Atomic dismiss: clears the nudge and recedes in one set() call so no
  // subscriber ever sees presenceState='whisper' with pendingNudge=null.
  dismissNudge: () => set({ pendingNudge: null, presenceState: 'atRest', planEditScope: null }),

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

  setCaptionOnlyMode: (value) => set({ captionOnlyMode: value }),

  reset: () => set({ ...INITIAL_STATE }),
}));
