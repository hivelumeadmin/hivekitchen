import { create } from 'zustand';

interface VoiceState {
  sessionId: string | null;
  status: 'idle' | 'connecting' | 'active' | 'ended' | 'error';
  isSpeaking: boolean;
  error: string | null;
}

interface VoiceActions {
  startSession: (sessionId: string) => void;
  endSession: () => void;
  setIsSpeaking: (v: boolean) => void;
  setStatus: (s: VoiceState['status']) => void;
  setError: (msg: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

const INITIAL_STATE: VoiceState = {
  sessionId: null,
  status: 'idle',
  isSpeaking: false,
  error: null,
};

export const useVoiceStore = create<VoiceState & VoiceActions>()((set) => ({
  ...INITIAL_STATE,
  startSession: (sessionId) => set({ sessionId, status: 'active', error: null }),
  endSession: () => set({ sessionId: null, status: 'ended', isSpeaking: false }),
  setIsSpeaking: (v) => set({ isSpeaking: v }),
  // Status mirroring must not clobber `error`. A status-mirror effect on the
  // consumer side races with the synchronous `setError(...)` set during the
  // same commit; if setStatus auto-cleared `error` here, the initial
  // status='idle' mirror would erase the error before the next mirror call
  // (status='error') runs, leaving the store with status='error' but
  // error=null and the consumer rendering no fallback. Errors are owned by
  // setError / clearError; setStatus just updates status.
  setStatus: (s) => set({ status: s }),
  setError: (msg) => set({ error: msg, status: msg === null ? 'idle' : 'error' }),
  clearError: () => set({ error: null, status: 'idle' }),
  reset: () => set({ ...INITIAL_STATE }),
}));
