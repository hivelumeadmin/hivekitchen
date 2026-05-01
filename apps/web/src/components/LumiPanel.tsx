import { useEffect } from 'react';
import { LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
import type { LumiSurface, Turn } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';

const MAX_VISIBLE_TURNS = 8;

export function LumiPanel() {
  const isPanelOpen = useLumiStore((s) => s.isPanelOpen);
  const panelMode = useLumiStore((s) => s.panelMode);
  const turns = useLumiStore((s) => s.turns);
  const isHydrating = useLumiStore((s) => s.isHydrating);
  const voiceError = useLumiStore((s) => s.voiceError);
  const surface = useLumiStore((s) => s.surface);

  // Hydrate when the panel opens or the surface changes (Story 12.7 wires setContext).
  // AbortController cancels the in-flight request on panel close or surface switch.
  useEffect(() => {
    if (!isPanelOpen) return;
    const { threadIds, isHydrating: hydratingNow, turns: turnsNow } = useLumiStore.getState();
    const threadId = threadIds[surface];
    if (threadId === undefined || hydratingNow || turnsNow.length > 0) return;

    const controller = new AbortController();
    useLumiStore.setState({ isHydrating: true });

    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/lumi/threads/${threadId}/turns`, {
          method: 'GET',
          signal: controller.signal,
        });
        const parsed = LumiThreadTurnsResponseSchema.parse(raw);
        useLumiStore.getState().hydrateThread(surface as LumiSurface, threadId, parsed.turns);
      } catch (err) {
        // Always reset on abort so the next panel open can re-attempt hydration.
        useLumiStore.setState({ isHydrating: false });
        if (controller.signal.aborted) return;
        console.warn('LumiPanel: thread hydration failed', err);
      }
    })();

    return () => controller.abort();
  }, [isPanelOpen, surface]);

  if (!isPanelOpen) return null;

  // Filter to message turns before slicing so non-message turns don't consume
  // slots and leave the panel blank when all visible turns are non-message.
  const visibleTurns = turns
    .filter((t) => t.body.type === 'message')
    .slice(-MAX_VISIBLE_TURNS);
  const showLoading = isHydrating && turns.length === 0;
  const isVoiceMode = panelMode === 'voice';

  function handleClose() {
    useLumiStore.getState().closePanel();
  }

  return (
    <aside
      id="lumi-panel"
      aria-label="Lumi panel"
      className="fixed bottom-20 right-6 z-50 w-full max-w-xs rounded-2xl border border-stone-200 bg-stone-50 shadow-xl"
    >
      <header className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="font-serif text-sm text-stone-700">Lumi</p>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close Lumi panel"
          className="text-stone-500 hover:text-stone-800 transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-amber-700 rounded"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="px-4 pb-3 max-h-72 overflow-y-auto flex flex-col gap-2">
        {showLoading ? (
          <p role="status" className="font-sans text-xs text-stone-500 italic">
            Catching up with Lumi…
          </p>
        ) : visibleTurns.length === 0 ? (
          <p className="font-sans text-xs text-stone-500">
            Nothing to show yet.
          </p>
        ) : (
          visibleTurns.map((turn) => <TurnRow key={turn.id} turn={turn} />)
        )}
      </div>

      {isVoiceMode && (
        <p className="px-4 pb-2 font-sans text-xs text-stone-600">
          Tap the orb to end voice session.
        </p>
      )}

      {isVoiceMode && voiceError !== null && (
        <p role="alert" className="px-4 pb-2 font-sans text-xs text-red-700">
          {voiceError}
        </p>
      )}

      <div className="border-t border-stone-200 px-4 py-3">
        {/* TODO Story 12.10 — wire POST /v1/lumi/turns and remove disabled. */}
        <textarea
          aria-label="Ask Lumi"
          placeholder="Ask Lumi…"
          rows={2}
          disabled
          className="w-full resize-none rounded-md border border-stone-200 bg-white px-2 py-1 font-sans text-sm text-stone-700 placeholder:text-stone-400 disabled:bg-stone-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-700"
        />
      </div>
    </aside>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.body.type !== 'message') return null;

  const isUser = turn.role === 'user';
  const senderLabel = isUser ? 'You' : 'Lumi';

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-sans text-[11px] uppercase tracking-wide text-stone-500">
        {senderLabel}
      </span>
      <p className="font-sans text-sm text-stone-800 whitespace-pre-wrap">
        {turn.body.content}
      </p>
    </div>
  );
}
