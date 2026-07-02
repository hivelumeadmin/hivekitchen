import { useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { AppFooter } from '@/components/AppFooter.js';
import { AppHeader } from '@/components/AppHeader.js';
import { AppSidebar } from '@/components/AppSidebar.js';
import { LumiPresence } from '@/components/LumiPresence.js';
import { VoiceSessionProvider } from '@/contexts/VoiceSessionContext.js';
import { useLumiVoiceSession } from '@/hooks/useLumiVoiceSession.js';
import { useLumiStore } from '@/stores/lumi.store.js';

export default function AppScopeLayout() {
  useScope('app-scope');
  const onLunchRoute = useMatch('/lunch/*');
  const [mobileOpen, setMobileOpen] = useState(false);

  // Story 13-s2.5 — proactive Lumi nudges are now delivered on the single SSE
  // bridge (see providers/query-provider.tsx + lib/realtime/sse.ts), which folds
  // in the `lumi.nudge` listener. The dedicated useLumiNudgeSSE EventSource was
  // removed so each tab holds exactly one connection to /v1/events.

  // Mount the ambient voice session hook at layout level so it survives route
  // changes and the LumiPresence dot + sheet can access startSession/endSession
  // via VoiceSessionContext without prop-drilling.
  const { startSession, endSession } = useLumiVoiceSession({
    // Turns are appended to the thread inside the hook via the store; here we
    // mirror the latest user/Lumi text into the caption state so <CaptionRibbon>
    // can show synchronized captions while Lumi speaks (Story 5-S5).
    onTranscript: (text) => { useLumiStore.getState().setCaptionTranscript(text); },
    onLumiReply: (text) => { useLumiStore.getState().setCaptionLumiReply(text); },
    onError: (msg) => { useLumiStore.getState().setVoiceError(msg); },
  });

  return (
    <VoiceSessionProvider startSession={startSession} endSession={endSession}>
      <div className="flex min-h-screen bg-bg text-fg">
        {/* Sidebar suppressed on the child-scope lunch-link surface */}
        {!onLunchRoute && (
          <AppSidebar
            mobileOpen={mobileOpen}
            onMobileClose={() => setMobileOpen(false)}
          />
        )}

        {/* Main column: header + scrollable content + footer */}
        <div className="flex flex-1 flex-col min-w-0">
          <AppHeader onMenuToggle={onLunchRoute ? undefined : () => setMobileOpen((v) => !v)} />
          <div className="flex-grow">
            <Outlet />
          </div>
          <AppFooter />
        </div>

        {!onLunchRoute && <LumiPresence />}
      </div>
    </VoiceSessionProvider>
  );
}
