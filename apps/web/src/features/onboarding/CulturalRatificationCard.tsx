import { useState } from 'react';
import type { CulturalPrior, RatifyAction } from '@hivekitchen/types';
import { useRatifyCulturalPrior } from '@/hooks/useRatifyCulturalPrior.js';

interface CulturalRatificationCardProps {
  prior: CulturalPrior;
  householdId: string;
  // Called after the user picks an action AND the API returns success.
  // Cards disappear one-by-one as the parent resolves them.
  onResolved: (priorId: string, action: RatifyAction) => void;
}

// UX-DR42 / UX-DR44 — Lumi notices, parent ratifies. No picker, no flag
// emojis (UX-DR45), no "Celebrating X" copy. Three buttons, no fourth.
export function CulturalRatificationCard({
  prior,
  householdId,
  onResolved,
}: CulturalRatificationCardProps) {
  const { mutate, isPending } = useRatifyCulturalPrior();
  const [error, setError] = useState<string | null>(null);
  const [lumiFollowUp, setLumiFollowUp] = useState<string | null>(null);

  async function handle(action: RatifyAction): Promise<void> {
    setError(null);
    const outcome = await mutate(householdId, prior.id, action);
    if (outcome.status === 'ok') {
      if (action === 'tell_lumi_more') {
        const followUp = outcome.result.lumi_response ?? null;
        if (followUp === null) {
          setError("Lumi had no reply just now. Please try again.");
          return;
        }
        setLumiFollowUp(followUp);
        return;
      }
      onResolved(prior.id, action);
      return;
    }
    if (outcome.status === 'forbidden' || outcome.status === 'not_found') {
      // Treat both as "this prior no longer applies" — remove the card so the
      // user is not stuck.
      onResolved(prior.id, action);
      return;
    }
    setError(outcome.message);
  }

  return (
    <article
      className="flex flex-col gap-4 p-6 rounded-3xl border border-stone-200 bg-white max-w-xl"
      aria-labelledby={`prior-${prior.id}-heading`}
    >
      <div className="flex items-center gap-3">
        {/* TrustChip equivalent — sacred-plum colourway for cultural-template
            provenance. Once a shared <TrustChip> primitive lands, swap this
            inline span for it. */}
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-800 text-xs font-sans tracking-wide">
          Cultural template
        </span>
        <span className="font-sans text-sm text-stone-500">{prior.label}</span>
      </div>

      <p
        id={`prior-${prior.id}-heading`}
        className="font-serif text-xl text-stone-800 leading-snug"
      >
        I noticed {prior.label} comes up — want me to keep that in mind?
      </p>

      {lumiFollowUp !== null ? (
        <p
          className="font-sans text-stone-700 italic border-l-2 border-purple-200 pl-3"
          role="status"
        >
          {lumiFollowUp}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handle('opt_in')}
          disabled={isPending}
          className="w-full px-5 py-2 rounded-full bg-amber-600 text-white font-sans text-base hover:bg-amber-700 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          Yes, keep it in mind
        </button>
        <button
          type="button"
          onClick={() => void handle('tell_lumi_more')}
          disabled={isPending}
          className="w-full px-5 py-2 rounded-full border border-stone-300 text-stone-700 font-sans text-base hover:bg-stone-100 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          Not quite — tell Lumi more
        </button>
        <button
          type="button"
          onClick={() => void handle('forget')}
          disabled={isPending}
          className="w-full px-5 py-2 font-sans text-sm text-stone-500 underline underline-offset-2 hover:text-stone-700 transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          Not for us
        </button>
      </div>

      {error !== null ? (
        <p className="text-sm text-red-700 font-sans" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
