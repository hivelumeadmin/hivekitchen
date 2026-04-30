import { useCallback, useState } from 'react';
import { ZodError } from 'zod';
import { RatifyCulturalPriorResponseSchema } from '@hivekitchen/contracts';
import type { RatifyAction, RatifyCulturalPriorResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

export type RatifyOutcome =
  | { status: 'ok'; result: RatifyCulturalPriorResponse }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

interface UseRatifyCulturalPrior {
  mutate: (
    householdId: string,
    priorId: string,
    action: RatifyAction,
  ) => Promise<RatifyOutcome>;
  isPending: boolean;
  error: string | null;
}

export function useRatifyCulturalPrior(): UseRatifyCulturalPrior {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (
      householdId: string,
      priorId: string,
      action: RatifyAction,
    ): Promise<RatifyOutcome> => {
      setIsPending(true);
      setError(null);
      try {
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/cultural-priors/${priorId}`,
          {
            method: 'PATCH',
            body: { action },
          },
        );
        const parsed = RatifyCulturalPriorResponseSchema.parse(raw);
        return { status: 'ok', result: parsed };
      } catch (err) {
        if (err instanceof HkApiError) {
          if (err.status === 403) return { status: 'forbidden' };
          if (err.status === 404) return { status: 'not_found' };
        }
        if (err instanceof ZodError) {
          // Server returned 200 but the shape was wrong. Likely a deploy
          // skew — surface a clean message rather than a parse trace.
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
