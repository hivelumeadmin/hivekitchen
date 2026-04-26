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
  // setStatus auto-clears any prior error so retry paths don't render stale UI.
  setStatus: (s) => set((prev) => ({ status: s, error: s === 'error' ? prev.error : null })),
  setError: (msg) => set({ error: msg, status: msg === null ? 'idle' : 'error' }),
  clearError: () => set({ error: null, status: 'idle' }),
  reset: () => set({ ...INITIAL_STATE }),
}));
