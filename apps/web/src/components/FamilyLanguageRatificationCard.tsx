import { useState } from 'react';
import type { FamilyLanguageRatifyAction } from '@hivekitchen/types';
import { useRatifyFamilyLanguage } from '@/hooks/useRatifyFamilyLanguage.js';

interface FamilyLanguageRatificationCardProps {
  term: string;
  maps_to: string;
  householdId: string;
  // Called once the card no longer applies — on opt_in/forget success, or when
  // the server says the term is gone (forbidden / not_found). tell_lumi_more does
  // NOT resolve: it keeps the card up with Lumi's inline follow-up.
  onResolved: () => void;
}

// Slice 5-S10 / UX-DR43-44-47 — Lumi noticed a family-language kinship word.
// Three pills, sacred-plum tinted term. No flag emojis, no "Celebrating" copy
// (UX-DR45). On opt_in the term locks forward forever.
export function FamilyLanguageRatificationCard({
  term,
  householdId,
  onResolved,
}: FamilyLanguageRatificationCardProps) {
  const { mutate, isPending } = useRatifyFamilyLanguage();
  const [error, setError] = useState<string | null>(null);
  const [lumiFollowUp, setLumiFollowUp] = useState<string | null>(null);

  // Review patch (5-S10): without a household id the ratify URL collapses to
  // `/v1/households//family-language/ratify` and strands the card on a generic
  // error. Disable the pills until the auth store has a household.
  const disabled = isPending || householdId === '';

  async function handle(action: FamilyLanguageRatifyAction): Promise<void> {
    setError(null);
    const outcome = await mutate(householdId, term, action);
    if (outcome.status === 'ok') {
      if (action === 'tell_lumi_more') {
        const followUp = outcome.result.lumi_response ?? null;
        if (followUp === null) {
          setError('Lumi had no reply just now. Please try again.');
          return;
        }
        setLumiFollowUp(followUp);
        return;
      }
      onResolved();
      return;
    }
    if (outcome.status === 'forbidden' || outcome.status === 'not_found') {
      // No longer applies — remove the card so the user is not stranded.
      onResolved();
      return;
    }
    setError(outcome.message);
  }

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3"
      aria-labelledby={`family-language-${term}-heading`}
    >
      <p
        id={`family-language-${term}-heading`}
        className="font-serif text-sm leading-snug text-fg"
      >
        I noticed you call them{' '}
        <span className="font-serif text-sacred-700">{term}</span> — want me to keep
        using that?
      </p>

      {lumiFollowUp !== null ? (
        <p className="border-l-2 border-sacred ps-3 font-sans text-xs italic text-fg-muted" role="status">
          {lumiFollowUp}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void handle('opt_in')}
          disabled={disabled}
          className="w-full rounded-full bg-sacred px-4 py-1.5 font-sans text-xs text-white transition-colors motion-reduce:transition-none hover:bg-sacred-600 disabled:opacity-50"
        >
          Yes, keep it in mind
        </button>
        <button
          type="button"
          onClick={() => void handle('tell_lumi_more')}
          disabled={disabled}
          className="w-full rounded-full border border-border px-4 py-1.5 font-sans text-xs text-fg transition-colors motion-reduce:transition-none hover:bg-surface disabled:opacity-50"
        >
          Not quite — tell Lumi more
        </button>
        <button
          type="button"
          onClick={() => void handle('forget')}
          disabled={disabled}
          className="w-full font-sans text-[11px] text-fg-muted underline underline-offset-2 transition-colors motion-reduce:transition-none hover:text-fg disabled:opacity-50"
        >
          Not for us
        </button>
      </div>

      {error !== null ? (
        <p className="font-sans text-xs text-lumi-terracotta" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
