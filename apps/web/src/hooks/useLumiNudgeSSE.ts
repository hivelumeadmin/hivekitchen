import { useEffect } from 'react';
import { LumiNudgeEventSchema } from '@hivekitchen/contracts';
import { useLumiStore } from '@/stores/lumi.store.js';

// Story 12-S12 — listens for proactive Lumi nudges on the SSE channel. The
// existing realtime bridge (lib/realtime/sse.ts) only handles the default
// `message` event (InvalidationEvent); nudges arrive as a NAMED `lumi.nudge`
// event, so they need a dedicated listener. A nudge sets pendingNudge (drives
// the orb breath) and, when the panel is already open on the matching surface,
// is appended live so the turn shows without a close/reopen.
//
// The URL base mirrors lib/realtime/sse.ts — EventSource must hit the API
// origin, not the web origin. accessToken is passed by the caller so the hook
// stays portable and testable; the EventSource is torn down and reopened when
// it changes (login / refresh).
export function useLumiNudgeSSE(accessToken: string | null): void {
  useEffect(() => {
    if (!accessToken) return;
    if (typeof EventSource === 'undefined') return;

    const clientId = crypto.randomUUID();
    const apiBase = import.meta.env.VITE_SSE_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? '';
    const url = new URL(`${apiBase}/v1/events`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('token', accessToken);

    const es = new EventSource(url.toString());

    function onNudge(e: MessageEvent) {
      let raw: unknown;
      try {
        raw = JSON.parse(e.data as string);
      } catch {
        return;
      }
      const parsed = LumiNudgeEventSchema.safeParse(raw);
      if (!parsed.success) return;

      const store = useLumiStore.getState();
      store.setNudge(parsed.data.turn);
      // Append directly if the sheet is already summoned on the matching surface —
      // avoids a close/reopen for a live update.
      if (store.presenceState === 'summoned' && store.surface === parsed.data.surface) {
        store.appendTurn(parsed.data.turn);
      }
      // Surface as a whisper (valet rule 3 — one quiet dismissible line) when
      // proactive nudges are enabled and the sheet is not already open. If the
      // sheet is open, the turn was just appended above; if nudges are paused,
      // the dot breath (atRest + pendingNudge) is the only signal.
      if (store.proactiveNudges && store.presenceState === 'atRest') {
        store.whisper();
      }
    }

    es.addEventListener('lumi.nudge', onNudge);
    return () => {
      es.removeEventListener('lumi.nudge', onNudge);
      es.close();
    };
  }, [accessToken]);
}
