import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hkFetch } from '@/lib/fetch.js';
import type {
  SwapPlanItemInput,
  PlanItemRow,
  RegeneratePlanResponse,
  SetDayOverrideInput,
  SetDayOverrideResponse,
  ConfirmVariantProposalInput,
} from '@hivekitchen/types';

// Browser crypto.randomUUID() is available in all modern browsers in secure contexts.
// Fallback for tests and non-secure contexts (http, iframe sandboxing): use
// crypto.getRandomValues to assemble an RFC 4122 v4 UUID. Math.random is never
// used — the value is treated as a security-relevant header (Idempotency-Key)
// and predictable RNG would invite collisions or replay manipulation.
function safeRandomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('safeRandomUuid: no cryptographic RNG available');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;  // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;  // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

// PATCH /v1/plans/:planId/items/:itemId with Idempotency-Key.
// A new Idempotency-Key is generated per mutation invocation — retrying a failed
// mutation re-generates the key (no replay-cache on server in this story; safe to retry).
// On success: invalidates ['brief'] wildcard so BriefCanvas re-fetches updated brief_state.
export function useSwapPlanItemMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    { item: PlanItemRow },
    Error,
    { planId: string; itemId: string; input: SwapPlanItemInput }
  >({
    mutationFn: ({ planId, itemId, input }) =>
      hkFetch(`/v1/plans/${planId}/items/${itemId}`, {
        method: 'PATCH',
        body: input,
        headers: { 'Idempotency-Key': safeRandomUuid() },
      }),
    onSuccess: () => {
      // ['brief'] wildcard matches every ['brief', householdId] key.
      // At most one is hot per session — one current_household_id.
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    },
  });
}

// PATCH /v1/plans/:planId/days/:day/pause with Idempotency-Key.
// On success: invalidates ['brief'] so tile paused state reflects immediately.
export function usePauseDayMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; day: string; reason?: 'sick' | 'absent' | 'holiday' }
  >({
    mutationFn: ({ planId, day, reason }) =>
      hkFetch(`/v1/plans/${planId}/days/${day}/pause`, {
        method: 'PATCH',
        body: reason !== undefined ? { reason } : {},
        headers: { 'Idempotency-Key': safeRandomUuid() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    },
  });
}

// POST /v1/plans/:planId/items/:itemId/override with Idempotency-Key.
// Story 3.19 — day-level context override (FR118, FR119). On success: invalidates
// ['brief'] so paused-state and any tile copy reflects immediately. The async
// regen, when triggered, lands later via plan_revision bump.
export function useSetDayOverrideMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    SetDayOverrideResponse,
    Error,
    { planId: string; itemId: string; input: SetDayOverrideInput }
  >({
    mutationFn: ({ planId, itemId, input }) =>
      hkFetch<SetDayOverrideResponse>(
        `/v1/plans/${planId}/items/${itemId}/override`,
        {
          method: 'POST',
          body: input,
          headers: { 'Idempotency-Key': safeRandomUuid() },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    },
  });
}

// DELETE /v1/plans/:planId/items/:itemId/override/:overrideId with Idempotency-Key.
// Story 3.19 — soft revert. Brief is invalidated so the tile clears any
// override copy / paused state on the next render.
export function useRevertDayOverrideMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; itemId: string; overrideId: string }
  >({
    mutationFn: ({ planId, itemId, overrideId }) =>
      hkFetch(
        `/v1/plans/${planId}/items/${itemId}/override/${overrideId}`,
        {
          method: 'DELETE',
          headers: { 'Idempotency-Key': safeRandomUuid() },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    },
  });
}

// POST /v1/plans/:planId/variant-proposals/:proposalId/confirm with Idempotency-Key.
// Story 3.27 — parent confirms or rejects a Lumi-proposed preparation variant.
// On success the proposal stops being active, so we invalidate ['plans'] to
// drop the pending-input pills from the tile on the next render.
export function useConfirmVariantProposalMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; proposalId: string; input: ConfirmVariantProposalInput }
  >({
    mutationFn: ({ planId, proposalId, input }) =>
      hkFetch(
        `/v1/plans/${planId}/variant-proposals/${proposalId}/confirm`,
        {
          method: 'POST',
          body: input,
          headers: { 'Idempotency-Key': safeRandomUuid() },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

// POST /v1/plans/:planId/regenerate?scope=week|day&day=<day> with Idempotency-Key.
// Story 3.13 — returns 202 Accepted with job_id and rate_limit_remaining.
// Does NOT immediately invalidate ['brief'] — the regeneration is async; the
// call site polls the brief and detects completion via plan_revision bump.
export function useRequestRegenerationMutation() {
  return useMutation<
    RegeneratePlanResponse,
    Error,
    { planId: string; scope: 'week' | 'day'; day?: string }
  >({
    mutationFn: ({ planId, scope, day }) => {
      const qs = day !== undefined ? `?scope=${scope}&day=${day}` : `?scope=${scope}`;
      return hkFetch<RegeneratePlanResponse>(`/v1/plans/${planId}/regenerate${qs}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': safeRandomUuid() },
      });
    },
  });
}
