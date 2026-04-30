import { useCallback, useState } from 'react';
import { AddChildResponseSchema } from '@hivekitchen/contracts';
import { ZodError } from 'zod';
import type { AddChildBody, ChildResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

export type AddChildOutcome =
  | { status: 'ok'; child: ChildResponse }
  | { status: 'parental_notice_required' }
  | { status: 'error'; message: string };

interface UseAddChild {
  submit: (householdId: string, body: AddChildBody) => Promise<AddChildOutcome>;
  pending: boolean;
}

export function useAddChild(): UseAddChild {
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (householdId: string, body: AddChildBody): Promise<AddChildOutcome> => {
      setPending(true);
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/children`, {
          method: 'POST',
          body,
        });
        const parsed = AddChildResponseSchema.parse(raw);
        return { status: 'ok', child: parsed.child };
      } catch (err) {
        if (err instanceof HkApiError) {
          const problemType = (err.problem as { type?: string } | null)?.type;
          if (problemType === '/errors/parental-notice-required') {
            return { status: 'parental_notice_required' };
          }
        }
        if (err instanceof ZodError) {
          // The API returned 201 but the response shape didn't match the schema.
          // The child was saved — tell the user to refresh rather than retry.
          return {
            status: 'error',
            message: 'Child was saved but the response was unexpected. Please refresh to see the updated list.',
          };
        }
        return { status: 'error', message: "Couldn't add this child. Please try again." };
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { submit, pending };
}
