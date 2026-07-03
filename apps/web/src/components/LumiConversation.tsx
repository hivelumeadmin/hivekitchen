import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LumiTurnResponseSchema } from '@hivekitchen/contracts';
import type { Turn } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useFamilyLanguageTerms } from '@/hooks/useFamilyLanguageTerms.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useVoiceSessionContext } from '@/contexts/VoiceSessionContext.js';
import { CaptionRibbon } from './CaptionRibbon.js';
import { FamilyLanguageRatificationCard } from './FamilyLanguageRatificationCard.js';

const MAX_VISIBLE_TURNS = 8;

// Epic 13-s11 — the Lumi conversation body, extracted from LumiSheet so the
// SAME implementation backs both the summoned corner sheet and the full-screen
// `/app/lumi` anchor page (vision §2c: "Lumi — the thread itself, full-screen").
// Owns turn submission, voice/caption states, the family-language ratification
// card, and the nudge opt-out. It does NOT own thread hydration or a Dialog
// shell — each host supplies those (the sheet hydrates on summon; the page
// hydrates via useLumiContext). `active` gates the family-language suppression
// fetch (sheet: only while summoned; page: always). `fullHeight` lets the page
// grow the thread to fill the frame instead of the sheet's compact scroll box.
export interface LumiConversationProps {
  active: boolean;
  fullHeight?: boolean;
}

export function LumiConversation({ active, fullHeight = false }: LumiConversationProps) {
  const turns = useLumiStore((s) => s.turns);
  const isHydrating = useLumiStore((s) => s.isHydrating);
  const voiceError = useLumiStore((s) => s.voiceError);
  const voiceStatus = useLumiStore((s) => s.voiceStatus);
  const captionTranscript = useLumiStore((s) => s.captionTranscript);
  const captionLumiReply = useLumiStore((s) => s.captionLumiReply);
  const surface = useLumiStore((s) => s.surface);
  const contextSignal = useLumiStore((s) => s.contextSignal);
  const panelMode = useLumiStore((s) => s.panelMode);
  const proactiveNudges = useLumiStore((s) => s.proactiveNudges);
  const householdId = useAuthStore((s) => s.user?.current_household_id) ?? '';

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
    // Clear any lingering voice notice now that the user is acting in text.
    // Direct setState avoids setVoiceError's voiceStatus side effect.
    if (useLumiStore.getState().voiceError !== null) {
      useLumiStore.setState({ voiceError: null });
    }

    try {
      const raw = await hkFetch<unknown>('/v1/lumi/turns', {
        method: 'POST',
        body: { message, context_signal: contextSignal ?? { surface } },
      });
      const data = LumiTurnResponseSchema.parse(raw);

      // Pin threadIds[surface] so the next summon pre-hydrates from the lazily
      // created thread. Append both turns rather than re-hydrating.
      useLumiStore.setState((s) => ({
        threadIds: { ...s.threadIds, [surface]: data.thread_id },
      }));
      useLumiStore.getState().appendTurn(data.user_turn);
      useLumiStore.getState().appendTurn(data.lumi_turn);
      // Slice 5-S10 — a family-language term crossed the ratification threshold;
      // append the prompt immediately (no SSE round-trip) so the card shows.
      if (data.ratification_turn) {
        useLumiStore.getState().appendTurn(data.ratification_turn);
      }
      setDraft('');
    } catch {
      // Draft is NOT cleared — the user can retry or edit.
      setSendError("Lumi couldn't send that. Try again.");
    } finally {
      setIsSending(false);
    }
  }

  // Slice 5-S10 — suppress a persisted family_language_prompt whose term is no
  // longer `candidate` (already opted-in / forgotten). Fails OPEN. Only fetched
  // while the conversation is active with a prompt present.
  const hasPromptTurn = turns.some((t) => t.body.type === 'family_language_prompt');
  const familyLanguageTerms = useFamilyLanguageTerms(householdId, active && hasPromptTurn);
  const resolvedTermNames = new Set(
    familyLanguageTerms.filter((t) => t.state !== 'candidate').map((t) => t.term),
  );

  // Filter to renderable turns before slicing so non-renderable turns don't
  // consume slots. Slice 5-S10 adds the family_language_prompt card.
  const visibleTurns = turns
    .filter((t) => {
      if (t.body.type === 'message') return true;
      if (t.body.type === 'family_language_prompt') return !resolvedTermNames.has(t.body.term);
      return false;
    })
    .slice(-MAX_VISIBLE_TURNS);
  const showLoading = isHydrating && turns.length === 0;
  const isVoiceMode = panelMode === 'voice';

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
    <>
      <div className="flex items-center justify-end pb-2">
        <div className="flex items-center gap-1 rounded border border-border bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => useLumiStore.getState().summon('text')}
            aria-label="Text mode"
            className={[
              'font-sans text-xs px-2 py-0.5 rounded transition-colors motion-reduce:transition-none',
              !isVoiceMode ? 'bg-surface text-fg shadow-sm' : 'text-fg',
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
              isVoiceMode ? 'bg-surface text-fg shadow-sm' : 'text-fg',
              voiceStatus === 'connecting' ? 'opacity-50 cursor-not-allowed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            Voice
          </button>
        </div>
      </div>

      {voiceStatus === 'connecting' && (
        <p className="pb-1 font-sans text-xs text-fg-muted italic">Connecting to Lumi voice…</p>
      )}
      {voiceStatus === 'active' && (
        <p className="pb-1 font-sans text-xs text-fg-muted italic">Listening…</p>
      )}
      {voiceStatus === 'active' && (
        <div className="pb-2">
          <CaptionRibbon userTranscript={captionTranscript} lumiCaption={captionLumiReply} />
        </div>
      )}

      <div
        className={[
          'flex flex-col gap-2 overflow-y-auto pb-3',
          fullHeight ? 'flex-1 min-h-0' : 'max-h-72',
        ].join(' ')}
      >
        {showLoading ? (
          <p role="status" className="font-sans text-xs text-fg-muted italic">
            Catching up with Lumi…
          </p>
        ) : visibleTurns.length === 0 ? (
          <p className="font-sans text-xs text-fg-muted">Nothing to show yet.</p>
        ) : (
          visibleTurns.map((turn) => (
            <TurnRow key={turn.id} turn={turn} householdId={householdId} />
          ))
        )}
      </div>

      {isVoiceMode && (
        <p className="pb-2 font-sans text-xs text-fg-muted">Use Voice tab above to end session.</p>
      )}

      {voiceError !== null && (
        <p role="alert" className="pb-2 font-sans text-xs text-lumi-terracotta">
          {voiceError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="border-t border-border pt-3">
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
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSending || !draft.trim()}
            className="font-sans text-xs px-3 py-1 rounded bg-lumi-terracotta text-white hover:bg-lumi-terracotta-warmed transition-colors motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-foliage"
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {sendError !== null && (
          <p role="alert" className="mt-1 font-sans text-xs text-lumi-terracotta">
            {sendError}
          </p>
        )}
      </form>

      <div className="flex justify-end border-t border-border pt-2">
        <button
          type="button"
          onClick={() => void handleNudgeToggle()}
          disabled={nudgeToggleSaving}
          className="font-sans text-xs text-fg-muted hover:text-fg transition-colors motion-reduce:transition-none disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-foliage rounded"
        >
          {proactiveNudges ? 'Pause nudges' : 'Resume nudges'}
        </button>
      </div>
    </>
  );
}

function TurnRow({ turn, householdId }: { turn: Turn; householdId: string }) {
  const queryClient = useQueryClient();

  if (turn.body.type === 'family_language_prompt') {
    return (
      <FamilyLanguageRatificationCard
        term={turn.body.term}
        maps_to={turn.body.maps_to}
        householdId={householdId}
        onResolved={() => {
          useLumiStore.getState().removeTurn(turn.id);
          void queryClient.invalidateQueries({
            queryKey: QueryKeys.familyLanguage(householdId),
          });
        }}
      />
    );
  }

  if (turn.body.type !== 'message') return null;

  const isUser = turn.role === 'user';
  const senderLabel = isUser ? 'You' : 'Lumi';

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-sans text-[11px] uppercase tracking-wide text-fg-muted">
        {senderLabel}
      </span>
      <p className="font-sans text-sm text-fg whitespace-pre-wrap">{turn.body.content}</p>
    </div>
  );
}
