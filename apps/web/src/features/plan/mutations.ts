import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hkFetch } from '@/lib/fetch.js';
import type {
  PlanMainAssignmentRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PauseReason,
  RegeneratePlanResponse,
  SetDayOverrideInput,
  SetDayOverrideResponse,
  SwapMainInput,
  SwapMainResponse,
  SwapSlotRecipeInput,
  SwapSlotRecipeResponse,
  UpdateVariationInput,
  UpdateVariationResponse,
  ConfirmVariantProposalInput,
  UpdateSovereigntyModeInput,
  UpdateSovereigntyModeResponse,
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

// Story 3-DM-C1 Phase 9b part 4 — the flat single PATCH /items/:itemId surface
// decomposes into three canonical operations. swapMain replaces the recipe on
// one M-assignment (cascades to every day using that Main). updateVariation
// patches one per-child variation row (portion / texture / spice / add_ons /
// removals / notes etc.). swapSlotRecipe replaces the recipe on a snack/extra
// slot (main slots reject with 400). All three invalidate ['brief'] so the
// brief surface re-fetches its cleared-allergies + tile summaries.

// PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe.
export function useSwapMainMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    SwapMainResponse,
    Error,
    { planId: string; mainAssignmentId: string; input: SwapMainInput }
  >({
    mutationFn: ({ planId, mainAssignmentId, input }) =>
      hkFetch<SwapMainResponse>(
        `/v1/plans/${planId}/main-assignments/${mainAssignmentId}/recipe`,
        {
          method: 'PATCH',
          body: input,
          headers: { 'Idempotency-Key': safeRandomUuid() },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

// PATCH /v1/plans/:planId/variations/:variationId.
export function useUpdateVariationMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateVariationResponse,
    Error,
    { planId: string; variationId: string; input: UpdateVariationInput }
  >({
    mutationFn: ({ planId, variationId, input }) =>
      hkFetch<UpdateVariationResponse>(
        `/v1/plans/${planId}/variations/${variationId}`,
        {
          method: 'PATCH',
          body: input,
          headers: { 'Idempotency-Key': safeRandomUuid() },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

// PATCH /v1/plans/:planId/slots/:planSlotId/recipe.
export function useSwapSlotRecipeMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    SwapSlotRecipeResponse,
    Error,
    { planId: string; planSlotId: string; input: SwapSlotRecipeInput }
  >({
    mutationFn: ({ planId, planSlotId, input }) =>
      hkFetch<SwapSlotRecipeResponse>(
        `/v1/plans/${planId}/slots/${planSlotId}/recipe`,
        {
          method: 'PATCH',
          body: input,
          headers: { 'Idempotency-Key': safeRandomUuid() },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

// PATCH /v1/plans/:planId/days/:day/pause — tree-shape body.
// reason is REQUIRED (DB CHECK demands paused_at + paused_reason both set);
// enum widens from flat 'sick'|'absent'|'holiday' to PauseReason's six-value set.
export function usePauseDayMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; day: string; reason: PauseReason; note?: string }
  >({
    mutationFn: ({ planId, day, reason, note }) =>
      hkFetch(`/v1/plans/${planId}/days/${day}/pause`, {
        method: 'PATCH',
        body: note !== undefined ? { reason, note } : { reason },
        headers: { 'Idempotency-Key': safeRandomUuid() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

// PATCH /v1/plans/:planId/days/:day/pause-child — per-child whole-day pause.
// Sets paused_at on every plan_slot_variation under (child_id, plan_day_id).
export function usePauseChildOnDayMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; day: string; childId: string }
  >({
    mutationFn: ({ planId, day, childId }) =>
      hkFetch(`/v1/plans/${planId}/days/${day}/pause-child`, {
        method: 'PATCH',
        body: { child_id: childId },
        headers: { 'Idempotency-Key': safeRandomUuid() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

// POST /v1/plans/:planId/slots/:planSlotId/override with Idempotency-Key.
// Story 3.19 — day-level context override (FR118, FR119). Path param swaps
// from planItemId → planSlotId in the tree model. On success: invalidates
// ['brief'] so paused-state and any tile copy reflects immediately. The async
// regen, when triggered, lands later via plan_revision bump.
export function useSetDayOverrideMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    SetDayOverrideResponse,
    Error,
    { planId: string; planSlotId: string; input: SetDayOverrideInput }
  >({
    mutationFn: ({ planId, planSlotId, input }) =>
      hkFetch<SetDayOverrideResponse>(
        `/v1/plans/${planId}/slots/${planSlotId}/override`,
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

// DELETE /v1/plans/:planId/slots/:planSlotId/override/:overrideId with Idempotency-Key.
// Story 3.19 — soft revert. Brief is invalidated so the tile clears any
// override copy / paused state on the next render.
export function useRevertDayOverrideMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; planSlotId: string; overrideId: string }
  >({
    mutationFn: ({ planId, planSlotId, overrideId }) =>
      hkFetch(
        `/v1/plans/${planId}/slots/${planSlotId}/override/${overrideId}`,
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

// PATCH /v1/households/:id/sovereignty-mode — Story 3.29.
// On success invalidates ['brief'] so the inline degraded note disappears (the
// API clears plans.state) and the queued regen plan replaces the
// degraded one when committed.
export function useUpdateSovereigntyModeMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateSovereigntyModeResponse,
    Error,
    { householdId: string; input: UpdateSovereigntyModeInput; idempotencyKey: string }
  >({
    mutationFn: ({ householdId, input, idempotencyKey }) =>
      hkFetch<UpdateSovereigntyModeResponse>(
        `/v1/households/${householdId}/sovereignty-mode`,
        {
          method: 'PATCH',
          body: input,
          headers: { 'Idempotency-Key': idempotencyKey },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
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

// Re-export the row shapes the parent component consumes so callers don't need
// to thread @hivekitchen/types imports through every layer that handles a
// mutation result.
export type { PlanMainAssignmentRow, PlanSlotRow, PlanSlotVariationRow };
