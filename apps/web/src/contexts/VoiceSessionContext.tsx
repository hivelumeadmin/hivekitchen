import { createContext, useContext, type ReactNode } from 'react';
import type { LumiContextSignal } from '@hivekitchen/types';

interface VoiceSessionContextValue {
  startSession: (sig: LumiContextSignal) => Promise<void>;
  endSession: () => Promise<void>;
}

const noop = async () => {};

export const VoiceSessionContext = createContext<VoiceSessionContextValue>({
  startSession: noop,
  endSession: noop,
});

interface VoiceSessionProviderProps {
  startSession: (sig: LumiContextSignal) => Promise<void>;
  endSession: () => Promise<void>;
  children: ReactNode;
}

export function VoiceSessionProvider({
  startSession,
  endSession,
  children,
}: VoiceSessionProviderProps) {
  return (
    <VoiceSessionContext.Provider value={{ startSession, endSession }}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSessionContext() {
  return useContext(VoiceSessionContext);
}
