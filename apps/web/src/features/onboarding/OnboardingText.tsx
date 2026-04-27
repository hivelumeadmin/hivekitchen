import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
} from '@hivekitchen/contracts';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

type Turn = { id: string; role: 'lumi' | 'user'; content: string };

const OPENING_GREETING =
  "I'm Lumi. I'd love to learn a little about your family — three short questions, and you can answer however feels natural. Tell me, what did your grandmother cook?";

const GREETING_TURN_ID = 'greeting';

export function OnboardingText() {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([
    { id: GREETING_TURN_ID, role: 'lumi', content: OPENING_GREETING },
  ]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationEndRef = useRef<HTMLLIElement | null>(null);

  // Cancel any pending fetch on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-scroll to the bottom of the conversation as new turns arrive.
  // jsdom omits scrollIntoView, so guard the call for tests.
  useEffect(() => {
    const node = conversationEndRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [turns.length, isComplete]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || pending) return;

    setError(null);
    setPending(true);

    // Optimistic user turn — server will persist it server-side too.
    const optimisticUserTurn: Turn = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setTurns((prev) => [...prev, optimisticUserTurn]);
    setDraft('');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const raw = await hkFetch<unknown>('/v1/onboarding/text/turn', {
        method: 'POST',
        body: { message: trimmed },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const parsed = TextOnboardingTurnResponseSchema.parse(raw);
      // Replace the optimistic id with the server's authoritative id, then append Lumi.
      setTurns((prev) => [
        ...prev.map((t) => (t.id === optimisticUserTurn.id ? { ...t, id: parsed.turn_id } : t)),
        { id: parsed.lumi_turn_id, role: 'lumi', content: parsed.lumi_response },
      ]);
      setIsComplete(parsed.is_complete);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const isUpstream = err instanceof HkApiError && err.status === 502;
      const message = isUpstream
        ? "I'm having a little trouble — try sending that again in a moment."
        : err instanceof HkApiError && err.status === 409
          ? 'Onboarding is already complete for this household.'
          : 'Something went wrong. Try again?';
      setError(message);
      // F11/F12 — only the 502 path leaves the user turn persisted server-side
      // (AC7). For every other failure the server did NOT save the message,
      // so roll back the optimistic render and put the text back in the draft
      // so the user can re-send (or edit) without retyping from scratch.
      if (!isUpstream) {
        setTurns((prev) => prev.filter((t) => t.id !== optimisticUserTurn.id));
        setDraft(trimmed);
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
      }
    }
  }, [draft, pending]);

  const handleFinalize = useCallback(async () => {
    if (finalizing) return;
    setError(null);
    setFinalizing(true);
    try {
      const raw = await hkFetch<unknown>('/v1/onboarding/text/finalize', { method: 'POST' });
      TextOnboardingFinalizeResponseSchema.parse(raw);
      void navigate('/app');
    } catch (err) {
      const message =
        err instanceof HkApiError && err.status === 409
          ? 'Onboarding is not quite ready to finish — keep talking with Lumi for a moment.'
          : "I couldn't finish onboarding right now. Try again?";
      setError(message);
      setFinalizing(false);
    }
  }, [finalizing, navigate]);

  return (
    <div className="flex flex-col w-full gap-6">
      <ol className="flex flex-col gap-4" aria-label="Onboarding conversation">
        {turns.map((turn) => (
          <li
            key={turn.id}
            className={[
              'flex',
              turn.role === 'lumi' ? 'justify-start' : 'justify-end',
            ].join(' ')}
          >
            <div
              className={[
                'max-w-[80%] px-4 py-3 rounded-2xl text-base leading-relaxed transition-opacity duration-300 motion-reduce:transition-none',
                turn.role === 'lumi'
                  ? 'bg-amber-50 text-stone-800 font-serif rounded-tl-sm'
                  : 'bg-stone-100 text-stone-700 font-sans rounded-tr-sm',
              ].join(' ')}
            >
              {turn.content}
            </div>
          </li>
        ))}
        <li ref={conversationEndRef} aria-hidden="true" />
      </ol>

      {error && (
        <p className="font-sans text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* F07 — keep the Finish onboarding affordance visible even when an
          error is set, otherwise a finalize failure permanently traps the
          user (the textarea is also disabled when isComplete=true). The
          error message above already explains what happened. */}
      {isComplete && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleFinalize}
            disabled={finalizing}
            className="px-8 py-3 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {finalizing ? 'Finishing…' : 'Finish onboarding'}
          </button>
          <p className="font-sans text-xs text-stone-400">Lumi has everything needed.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="onboarding-message" className="sr-only">
          Your message to Lumi
        </label>
        <textarea
          id="onboarding-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Type your answer…"
          disabled={pending || isComplete}
          className="w-full px-4 py-3 rounded-2xl border border-stone-200 bg-white text-stone-800 font-sans text-base resize-none focus:outline-none focus:border-amber-600 disabled:bg-stone-50 disabled:text-stone-400"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || isComplete || draft.trim().length === 0}
            className="px-6 py-2 rounded-full bg-stone-800 text-white font-sans text-sm hover:bg-stone-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
