import { Outlet, useMatch } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { AppFooter } from '@/components/AppFooter.js';
import { AppHeader } from '@/components/AppHeader.js';
import { LumiOrb } from '@/components/LumiOrb.js';
import { LumiPanel } from '@/components/LumiPanel.js';
import { VoiceSessionProvider } from '@/contexts/VoiceSessionContext.js';
import { useLumiVoiceSession } from '@/hooks/useLumiVoiceSession.js';
import { useLumiNudgeSSE } from '@/hooks/useLumiNudgeSSE.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';

export default function AppScopeLayout() {
  useScope('app-scope');
  const onLunchRoute = useMatch('/lunch/*');

  // Story 12-S12 — subscribe to proactive Lumi nudges so the orb breathes the
  // moment a nudge lands. Keyed on accessToken: the EventSource reopens on login
  // / refresh and closes on logout.
  const accessToken = useAuthStore((s) => s.accessToken);
  useLumiNudgeSSE(accessToken);

  // Mount the ambient voice session hook at layout level so it survives route
  // changes and both LumiOrb and LumiPanel can access startSession/endSession
  // via VoiceSessionContext without prop-drilling.
  const { startSession, endSession } = useLumiVoiceSession({
    onTranscript: () => { /* turns appended inside hook via store */ },
    onLumiReply: () => { /* turns appended inside hook via store */ },
    onError: (msg) => { useLumiStore.getState().setVoiceError(msg); },
  });

  return (
    <VoiceSessionProvider startSession={startSession} endSession={endSession}>
      <div className="flex min-h-screen flex-col bg-bg text-fg">
        <AppHeader />
        <div className="flex-grow">
          <Outlet />
        </div>
        <AppFooter />
        {!onLunchRoute && <LumiOrb />}
        {!onLunchRoute && <LumiPanel />}
      </div>
    </VoiceSessionProvider>
  );
}
