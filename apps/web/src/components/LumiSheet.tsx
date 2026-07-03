import { useEffect } from 'react';
import { LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
import type { LumiSurface } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { Dialog } from './Dialog.js';
import { LumiConversation } from './LumiConversation.js';
// Epic 13-s10 — the conversational plan-edit exchange. LumiSheet is already a
// feature-aware shared surface (it owns turns, voice, nudges, family-language),
// so rendering the plan-edit panel here — not a pure primitive import — matches
// its existing nature; the sheet is the single summoned surface.
import { PlanEditPanel } from '@/features/plan/PlanEditPanel.js';

const SHEET_TITLE_ID = 'lumi-sheet-title';
export const LUMI_SHEET_ID = 'lumi-sheet';

// Epic 13-s2 — the valet "summoned" surface. A focused, temporary sheet that
// slides in from the corner, runs a turn, and recedes back into the finished
// product. Built on <Dialog> so it inherits focus-trap / Escape / scrim-close /
// scroll-lock / focus-restoration (the dot is restored on close). It is NOT a
// persistent chat column — it only exists while presenceState === 'summoned'.
// Epic 13-s11 — the conversation body now lives in the shared <LumiConversation>,
// consumed identically by the full-screen /app/lumi anchor page; the sheet keeps
// only the Dialog shell + the plan-edit branch + summon-time hydration.
export function LumiSheet() {
  const presenceState = useLumiStore((s) => s.presenceState);
  const planEditScope = useLumiStore((s) => s.planEditScope);
  const surface = useLumiStore((s) => s.surface);

  const isSummoned = presenceState === 'summoned';

  // Hydrate when the sheet is summoned or the surface changes. AbortController
  // cancels the in-flight request on recede or surface switch.
  useEffect(() => {
    if (!isSummoned) return;
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
        useLumiStore.setState({ isHydrating: false });
        if (controller.signal.aborted) return;
        console.warn('LumiSheet: thread hydration failed', err);
      }
    })();

    return () => controller.abort();
  }, [isSummoned, surface]);

  function handleClose() {
    useLumiStore.getState().recede();
  }

  return (
    <Dialog
      open={isSummoned}
      onClose={handleClose}
      id={LUMI_SHEET_ID}
      titleId={SHEET_TITLE_ID}
      placement="bottom-right"
      scrimClassName="bg-stone-900/40"
      panelClassName="flex w-full max-w-sm max-h-[80vh] flex-col rounded-2xl border border-border bg-surface p-5 shadow-xl animate-[hk-slide-in-sheet_150ms_ease-out] motion-reduce:animate-none"
    >
      <header className="flex items-center justify-between pb-2">
        <h2 id={SHEET_TITLE_ID} className="font-serif text-sm text-fg">
          Lumi
        </h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close Lumi"
          className="text-fg-muted hover:text-fg transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage rounded"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {planEditScope !== null ? (
        <PlanEditPanel scope={planEditScope} />
      ) : (
        <LumiConversation active={isSummoned} />
      )}
    </Dialog>
  );
}
