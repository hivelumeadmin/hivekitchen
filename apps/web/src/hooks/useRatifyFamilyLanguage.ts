import { useCallback, useState } from 'react';
import { ZodError } from 'zod';
import { FamilyLanguageRatifyResponseSchema } from '@hivekitchen/contracts';
import type { FamilyLanguageRatifyAction, FamilyLanguageRatifyResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

export type RatifyFamilyLanguageOutcome =
  | { status: 'ok'; result: FamilyLanguageRatifyResponse }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

interface UseRatifyFamilyLanguage {
  mutate: (
    householdId: string,
    term: string,
    action: FamilyLanguageRatifyAction,
  ) => Promise<RatifyFamilyLanguageOutcome>;
  isPending: boolean;
  error: string | null;
}

// Slice 5-S10 — mirror of useRatifyCulturalPrior for the family-language ratchet.
// POSTs { term, action } to /v1/households/:id/family-language/ratify and parses
// the response with FamilyLanguageRatifyResponseSchema.
export function useRatifyFamilyLanguage(): UseRatifyFamilyLanguage {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (
      householdId: string,
      term: string,
      action: FamilyLanguageRatifyAction,
    ): Promise<RatifyFamilyLanguageOutcome> => {
      setIsPending(true);
      setError(null);
      try {
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/family-language/ratify`,
          {
            method: 'POST',
            body: { term, action },
          },
        );
        const parsed = FamilyLanguageRatifyResponseSchema.parse(raw);
        return { status: 'ok', result: parsed };
      } catch (err) {
        if (err instanceof HkApiError) {
          if (err.status === 403) return { status: 'forbidden' };
          if (err.status === 404) return { status: 'not_found' };
        }
        if (err instanceof ZodError) {
          const msg = "Couldn't read Lumi's reply just now. Please try again.";
          setError(msg);
          return { status: 'error', message: msg };
        }
        const msg = "Couldn't save that just now. Please try again.";
        setError(msg);
        return { status: 'error', message: msg };
      } finally {
        setIsPending(false);
      }
    },
    [],
  );

  return { mutate, isPending, error };
}
