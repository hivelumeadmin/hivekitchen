import { useEffect, useState, type FormEvent } from 'react';
import { LumiThreadTurnsResponseSchema, LumiTurnResponseSchema } from '@hivekitchen/contracts';
import type { LumiSurface, Turn } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useVoiceSessionContext } from '@/contexts/VoiceSessionContext.js';
import { CaptionRibbon } from './CaptionRibbon.js';

const MAX_VISIBLE_TURNS = 8;

export function LumiPanel() {
  const isPanelOpen = useLumiStore((s) => s.isPanelOpen);
  const panelMode = useLumiStore((s) => s.panelMode);
  const turns = useLumiStore((s) => s.turns);
  const isHydrating = useLumiStore((s) => s.isHydrating);
  const voiceError = useLumiStore((s) => s.voiceError);
  const voiceStatus = useLumiStore((s) => s.voiceStatus);
  const captionTranscript = useLumiStore((s) => s.captionTranscript);
  const captionLumiReply = useLumiStore((s) => s.captionLumiReply);
  const surface = useLumiStore((s) => s.surface);
  const contextSignal = useLumiStore((s) => s.contextSignal);
  const proactiveNudges = useLumiStore((s) => s.proactiveNudges);

  const { startSession, endSession } = useVoiceSessionContext();

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [nudgeToggleSaving, setNudgeToggleSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || isSending) return;

    setIsSending(true);
    setSendError(null);
    // Clear any lingering voice notice (Premium fallback / connection error)
    // now that the user is acting in text. Direct setState avoids setVoiceError's
    // voiceStatus side effect.
    if (useLumiStore.getState().voiceError !== null) {
      useLumiStore.setState({ voiceError: null });
    }

    try {
      const raw = await hkFetch<unknown>('/v1/lumi/turns', {
        method: 'POST',
        body: { message, context_signal: contextSignal ?? { surface } },
      });
      const data = LumiTurnResponseSchema.parse(raw);

      // Pin threadIds[surface] so the next panel open pre-hydrates from the
      // lazily-created thread. Append both turns rather than re-hydrating
      // (hydrateThread would replace the whole list — see 12.7 invariants).
      useLumiStore.setState((s) => ({
        threadIds: { ...s.threadIds, [surface]: data.thread_id },
      }));
      useLumiStore.getState().appendTurn(data.user_turn);
      useLumiStore.getState().appendTurn(data.lumi_turn);
      setDraft('');
    } catch {
      // Draft is NOT cleared — the user can retry or edit.
      setSendError("Lumi couldn't send that. Try again.");
    } finally {
      setIsSending(false);
    }
  }

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

  // Optimistically flip the proactive-nudge opt-out, then persist. Revert the
  // local store value if the PATCH fails so the label reflects reality.
  async function handleNudgeToggle() {
    if (nudgeToggleSaving) return;
    const next = !proactiveNudges;
    setNudgeToggleSaving(true);
    useLumiStore.getState().setProactiveNudges(next);
    try {
      await hkFetch<unknown>('/v1/users/me/notifications', {
        method: 'PATCH',
        body: { proactive_lumi_nudges: next },
      });
    } catch {
      useLumiStore.getState().setProactiveNudges(!next);
    } finally {
      setNudgeToggleSaving(false);
    }
  }

  function handleVoiceClick() {
    if (voiceStatus === 'active') {
      void endSession();
    } else if (voiceStatus === 'connecting') {
      // no-op while connecting
    } else {
      // idle or error — attempt to start (error state clears on setTalkSession)
      void startSession(contextSignal ?? { surface });
    }
  }

  return (
    <aside
      id="lumi-panel"
      aria-label="Lumi panel"
      className="fixed bottom-20 right-6 z-50 w-full max-w-xs rounded-lg border border-border bg-surface shadow-xl"
    >
      <header className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="font-serif text-sm text-fg">Lumi</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-border bg-surface-2 p-0.5">
            <button
              type="button"
              onClick={() => useLumiStore.getState().openPanel('text')}
              aria-label="Text mode"
              className={[
                'font-sans text-xs px-2 py-0.5 rounded transition-colors motion-reduce:transition-none',
                !isVoiceMode
                  ? 'bg-surface text-fg shadow-sm'
                  : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              Text
            </button>
            <button
              type="button"
              onClick={handleVoiceClick}
              aria-label="Voice mode"
              disabled={voiceStatus === 'connecting'}
              className={[
                'font-sans text-xs px-2 py-0.5 rounded transition-colors motion-reduce:transition-none',
                isVoiceMode
                  ? 'bg-surface text-fg shadow-sm'
                  : 'text-fg-muted hover:text-fg',
                voiceStatus === 'connecting' ? 'opacity-50 cursor-not-allowed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              Voice
            </button>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close Lumi panel"
            className="text-fg-muted hover:text-fg transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage rounded"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      {voiceStatus === 'connecting' && (
        <p className="px-4 pb-1 font-sans text-xs text-fg-muted italic">
          Connecting to Lumi voice…
        </p>
      )}
      {voiceStatus === 'active' && (
        <p className="px-4 pb-1 font-sans text-xs text-fg-muted italic">
          Listening…
        </p>
      )}
      {voiceStatus === 'active' && (
        <div className="px-4 pb-2">
          <CaptionRibbon userTranscript={captionTranscript} lumiCaption={captionLumiReply} />
        </div>
      )}

      <div className="px-4 pb-3 max-h-72 overflow-y-auto flex flex-col gap-2">
        {showLoading ? (
          <p role="status" className="font-sans text-xs text-fg-muted italic">
            Catching up with Lumi…
          </p>
        ) : visibleTurns.length === 0 ? (
          <p className="font-sans text-xs text-fg-muted">
            Nothing to show yet.
          </p>
        ) : (
          visibleTurns.map((turn) => <TurnRow key={turn.id} turn={turn} />)
        )}
      </div>

      {isVoiceMode && (
        <p className="px-4 pb-2 font-sans text-xs text-fg-muted">
          Tap the orb to end voice session.
        </p>
      )}

      {voiceError !== null && (
        <p role="alert" className="px-4 pb-2 font-sans text-xs text-lumi-terracotta">
          {voiceError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="border-t border-border px-4 py-3">
        <textarea
          aria-label="Ask Lumi"
          placeholder="Ask Lumi…"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isSending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e as unknown as FormEvent);
            }
          }}
          className="w-full resize-none rounded-md border border-border bg-surface text-fg px-2 py-1 font-sans text-sm placeholder:text-fg-muted disabled:bg-surface-2 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-foliage"
        />
        {sendError !== null && (
          <p role="alert" className="mt-1 font-sans text-xs text-lumi-terracotta">
            {sendError}
          </p>
        )}
      </form>

      <div className="flex justify-end border-t border-border px-4 py-2">
        <button
          type="button"
          onClick={() => void handleNudgeToggle()}
          disabled={nudgeToggleSaving}
          className="font-sans text-xs text-fg-muted hover:text-fg transition-colors motion-reduce:transition-none disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-foliage rounded"
        >
          {proactiveNudges ? 'Pause nudges' : 'Resume nudges'}
        </button>
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
      <span className="font-sans text-[11px] uppercase tracking-wide text-fg-muted">
        {senderLabel}
      </span>
      <p className="font-sans text-sm text-fg whitespace-pre-wrap">
        {turn.body.content}
      </p>
    </div>
  );
}
