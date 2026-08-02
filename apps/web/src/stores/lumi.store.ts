import { create } from 'zustand';
import { PRESENCE_INITIAL_STATE, createPresenceSlice } from './lumi/presence.slice.js';
import { THREAD_INITIAL_STATE, createThreadSlice } from './lumi/thread.slice.js';
import { VOICE_INITIAL_STATE, createVoiceSlice } from './lumi/voice.slice.js';
import type { LumiStore } from './lumi/types.js';

export type { PlanEditDay, PlanEditScope } from './lumi/types.js';

// Story 14-s6 — one flat store composed from three slices:
//   presence — the valet FSM (atRest ↔ whisper ↔ summoned), panel mode, nudges
//   thread   — surface registration, thread ids, turns, hydration
//   voice    — session lifecycle, captions, caption-only mode
// The shape stays flat and every action signature is unchanged, so selectors and
// the bare useLumiStore.setState({...}) call sites keep working. Actions that
// legitimately span slices (setContext, endTalkSession) remain single set()
// calls and are commented where they live.
const INITIAL_STATE = {
  ...PRESENCE_INITIAL_STATE,
  ...THREAD_INITIAL_STATE,
  ...VOICE_INITIAL_STATE,
};

export const useLumiStore = create<LumiStore>()((...a) => ({
  ...createPresenceSlice(...a),
  ...createThreadSlice(...a),
  ...createVoiceSlice(...a),

  reset: () => a[0]({ ...INITIAL_STATE }),
}));
