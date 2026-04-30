import { useCallback, useState } from 'react';
import { SetBagCompositionResponseSchema } from '@hivekitchen/contracts';
import { ZodError } from 'zod';
import type { ChildResponse, SetBagCompositionBody } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

export type SetBagCompositionOutcome =
  | { ok: true; child: ChildResponse }
  | { ok: false; message: string };

interface UseSetBagComposition {
  submit: (childId: string, body: SetBagCompositionBody) => Promise<SetBagCompositionOutcome>;
  pending: boolean;
}

export function useSetBagComposition(): UseSetBagComposition {
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (
      childId: string,
      body: SetBagCompositionBody,
    ): Promise<SetBagCompositionOutcome> => {
      setPending(true);
      try {
        const raw = await hkFetch<unknown>(`/v1/children/${childId}/bag-composition`, {
          method: 'PATCH',
          body,
        });
        const parsed = SetBagCompositionResponseSchema.parse(raw);
        return { ok: true, child: parsed.child };
      } catch (err) {
        if (err instanceof HkApiError) {
          // The API rejected the change. Surface a friendly message; the
          // parent can dismiss the card without losing their child profile.
          return {
            ok: false,
            message: "Couldn't save bag preferences. Please try again.",
          };
        }
        if (err instanceof ZodError) {
          return {
            ok: false,
            message:
              'Bag preferences saved but the response was unexpected. Please refresh to confirm.',
          };
        }
        return { ok: false, message: "Couldn't save bag preferences. Please try again." };
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { submit, pending };
}
