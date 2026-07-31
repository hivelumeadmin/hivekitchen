import type { LumiSliceCreator, VoiceStatus } from './types.js';

export interface VoiceState {
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

  // Slice 5-S13 — mirrors users.caption_only_mode. When true, the voice-session
  // hook skips TTS playback; captions still stream. Hydrated from /v1/users/me
  // at account page load (same pattern as proactiveNudges).
  captionOnlyMode: boolean;
}

export interface VoiceSlice extends VoiceState {
  setTalkSession: (sessionId: string) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setVoiceError: (msg: string | null) => void;
  setCaptionTranscript: (text: string) => void;
  setCaptionLumiReply: (text: string) => void;
  setLumiThinking: (value: boolean) => void;
  endTalkSession: () => void;
  setCaptionOnlyMode: (value: boolean) => void;
}

export const VOICE_INITIAL_STATE: VoiceState = {
  talkSessionId: null,
  voiceStatus: 'idle',
  isSpeaking: false,
  voiceError: null,

  captionTranscript: '',
  captionLumiReply: '',

  lumiThinking: false,

  captionOnlyMode: false,
};

export const createVoiceSlice: LumiSliceCreator<VoiceSlice> = (set) => ({
  ...VOICE_INITIAL_STATE,

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

  // Cross-slice atomic: tearing down a voice session also returns the panel to
  // text mode (a presence key). presenceState is deliberately NOT touched —
  // ending a session must not close a sheet the parent is still reading.
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

  setCaptionOnlyMode: (value) => set({ captionOnlyMode: value }),
});
