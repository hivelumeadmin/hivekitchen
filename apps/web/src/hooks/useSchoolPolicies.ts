import { useCallback, useEffect, useState } from 'react';
import { ZodError } from 'zod';
import {
  GetSchoolPoliciesResponseSchema,
  UpdateSchoolPolicyResponseSchema,
} from '@hivekitchen/contracts';
import type {
  SchoolPolicy,
  UpdateSchoolPolicyInput,
} from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

type LoadOutcome =
  | { ok: true; policies: SchoolPolicy[] }
  | { ok: false; message: string };

type ToggleOutcome =
  | { ok: true; policy: SchoolPolicy; regenerationTriggered: boolean }
  | { ok: false; message: string };

interface UseSchoolPolicies {
  policies: SchoolPolicy[];
  loading: boolean;
  pending: boolean;
  loadError: string | null;
  reload: () => Promise<LoadOutcome>;
  update: (body: UpdateSchoolPolicyInput) => Promise<ToggleOutcome>;
}

// Story 3.16 — small client wrapper around GET + PATCH /v1/children/:id/school-policies.
// Mirrors the shape of useSetBagComposition (Story 2.12). Keeping it tight: no
// optimistic updates — a parent toggling a school policy is rare and expects
// the server's confirmation (the response carries regeneration_triggered).
export function useSchoolPolicies(childId: string): UseSchoolPolicies {
  const [policies, setPolicies] = useState<SchoolPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<LoadOutcome> => {
    setLoading(true);
    setLoadError(null);
    try {
      const raw = await hkFetch<unknown>(`/v1/children/${childId}/school-policies`, {
        method: 'GET',
      });
      const parsed = GetSchoolPoliciesResponseSchema.parse(raw);
      setPolicies(parsed.policies);
      return { ok: true, policies: parsed.policies };
    } catch (err) {
      const message =
        err instanceof HkApiError
          ? "Couldn't load school policies. Please try again."
          : err instanceof ZodError
            ? 'School policies response was unexpected. Please refresh.'
            : "Couldn't load school policies. Please try again.";
      setLoadError(message);
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(
    async (body: UpdateSchoolPolicyInput): Promise<ToggleOutcome> => {
      setPending(true);
      try {
        const raw = await hkFetch<unknown>(`/v1/children/${childId}/school-policies`, {
          method: 'PATCH',
          body,
        });
        const parsed = UpdateSchoolPolicyResponseSchema.parse(raw);
        // Refresh local state. The PATCH only returns the single upserted
        // policy, so we splice it into the existing list.
        setPolicies((prev) => {
          const others = prev.filter((p) => p.policy_type !== parsed.policy.policy_type);
          return parsed.policy.is_active ? [...others, parsed.policy] : others;
        });
        return {
          ok: true,
          policy: parsed.policy,
          regenerationTriggered: parsed.regeneration_triggered,
        };
      } catch (err) {
        if (err instanceof HkApiError) {
          return {
            ok: false,
            message: "Couldn't save school policy. Please try again.",
          };
        }
        if (err instanceof ZodError) {
          return {
            ok: false,
            message:
              'Policy saved but the response was unexpected. Please refresh to confirm.',
          };
        }
        return { ok: false, message: "Couldn't save school policy. Please try again." };
      } finally {
        setPending(false);
      }
    },
    [childId],
  );

  return { policies, loading, pending, loadError, reload, update };
}
