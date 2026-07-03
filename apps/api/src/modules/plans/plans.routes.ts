import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import {
  GetPlansQuerySchema,
  GetPlansResponseSchema,
  PlanWeekIdParamSchema,
  PlanHistoryResponseSchema,
  SwapMainInputSchema,
  SwapMainResponseSchema,
  UpdateVariationInputSchema,
  UpdateVariationResponseSchema,
  SwapSlotRecipeInputSchema,
  SwapSlotRecipeResponseSchema,
  PausePlanDayTreeInputSchema,
  PauseChildOnDayInputSchema,
  MainAssignmentParamSchema,
  VariationParamSchema,
  PlanSlotParamSchema,
  PlanDayContextSlotParamSchema,
  PlanDayContextSlotRevertParamSchema,
  WeekdaySchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
  GeneratePlanResponseSchema,
  SetPlanDayContextInputSchema,
  SetPlanDayContextResponseSchema,
  ConfirmVariantProposalInputSchema,
  ProposeSwapInputSchema,
  ProposeSwapResponseSchema,
  PlanEditParamSchema,
  PlanEditInputSchema,
  PlanEditResponseSchema,
} from '@hivekitchen/contracts';
import type {
  GetPlansQuery,
  SwapMainInput,
  UpdateVariationInput,
  SwapSlotRecipeInput,
  PausePlanDayTreeInput,
  PauseChildOnDayInput,
  RegeneratePlanQuery,
  SetPlanDayContextInput,
  ConfirmVariantProposalInput,
  ProposeSwapInput,
  Weekday,
  VariantProposal,
  FlaggedCompoundItem,
  PlanEditParam,
  PlanEditInput,
} from '@hivekitchen/types';
import { ValidationError, NotFoundError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { toWireResult, shouldEmitPlanUpdated } from './plan-edit.service.js';
import { createPlanIntentTracer } from '../../agents/plan-intent-tracer.js';
import { buildPlanUpdatedPayload } from '../../jobs/plan-generation.job.js';
import { deriveWeekId } from '../../lib/derive-week-id.js';

// Story 3.12 — Idempotency-Key: UUIDv4 format, max 128 chars (architecture §Idempotency).
// Full Redis replay-cache deferred to a later story — see deferred-work.md.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_MAX = 128;

function requireIdempotencyKey(raw: unknown): string {
  if (!raw || typeof raw !== 'string') {
    throw new ValidationError('Idempotency-Key header is required');
  }
  const trimmed = raw.trim();
  if (!UUID_RE.test(trimmed) || trimmed.length > IDEMPOTENCY_KEY_MAX) {
    throw new ValidationError(
      'Idempotency-Key must be a valid UUID (max 128 chars)',
    );
  }
  return trimmed;
}

const plansRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  // GET /v1/plans?week=current|next
  //
  // Story 3-DM-C1 Phase 9b part 4 step 3 — tree-shape response. The wire now
  // carries the four canonical arrays (main_assignments, days, slots,
  // variations) instead of the flat plan_items[]. Draft and hard-fail paths
  // still return `plan: null` + empty arrays so the client renders the
  // "Lumi is drafting next week" loading state and the AllergyUncertaintyBanner.
  fastify.get(
    '/v1/plans',
    {
      preHandler: requireMember,
      schema: {
        querystring: GetPlansQuerySchema,
        response: { 200: GetPlansResponseSchema },
      },
    },
    async (request, reply) => {
      const { week } = request.query as GetPlansQuery;
      const householdId = request.user.household_id;
      const {
        plan,
        mainAssignments,
        days,
        slots,
        variations,
        isDraft,
        weekOf,
      } = await fastify.plansService.getPlanForWeekTree({
        householdId,
        week,
      });

      // Story 3.25/3.26 — hard-fail surface. Only check when plan===null &&
      // !isDraft (the slow path that hits the reworking UX). Drafts never
      // hard-fail since they haven't gone through the guardrail loop yet.
      // Story pre-4-s3 — getHardFailStatus also returns compound-uncertain
      // flagged_items extracted from the audit's stages; surface those so the
      // frontend's AllergyUncertaintyBanner can show the specific ingredients.
      let hardFail: { week_of: string; failed_at: string } | null = null;
      let flaggedItems: FlaggedCompoundItem[] = [];
      if (plan === null && !isDraft) {
        try {
          const failStatus = await fastify.plansService.getHardFailStatus(
            householdId,
            weekOf,
          );
          if (failStatus !== null) {
            hardFail = {
              week_of: failStatus.week_of,
              failed_at: failStatus.failed_at,
            };
            flaggedItems = failStatus.flagged_items;
          }
        } catch (err) {
          request.log.error(
            { err, householdId, weekOf },
            'getHardFailStatus failed — omitting hard_fail and flagged_items from response',
          );
        }
      }

      // Story 3.27 — active variant proposals for the resolved plan. Failure
      // to load is non-fatal: the proposal is a learning signal, not safety
      // state. VariantProposalSchema still carries plan_item_id; the field
      // swaps to plan_slot_variation_id in a sibling slice.
      let variantProposals: VariantProposal[] = [];
      if (plan !== null) {
        try {
          variantProposals = await fastify.variantProposalService.findActiveByPlan(
            plan.id,
          );
        } catch (err) {
          request.log.error(
            { err, householdId, planId: plan.id },
            'findActiveByPlan failed — omitting variant_proposals',
          );
        }
      }

      return reply.status(200).send({
        plan,
        main_assignments: mainAssignments,
        days,
        slots,
        variations,
        is_draft: isDraft,
        week_of: weekOf,
        ...(hardFail !== null ? { hard_fail: hardFail } : {}),
        variant_proposals: variantProposals,
        ...(flaggedItems.length > 0 ? { flagged_items: flaggedItems } : {}),
      });
    },
  );

  // POST /v1/plans/generate
  //
  // Story 3-S34 — on-demand ("compose now") plan composition. The window is
  // server-derived from "now" + the household timezone, so there is no body.
  // Create-only: 409 when a plan already covers the target week. Rate-limited
  // per household per target week → 429. Enqueues a plan-generation job with no
  // delay and responds 202. The client then polls GET /v1/plans?week=current|next.
  fastify.post(
    '/v1/plans/generate',
    {
      preHandler: requireMember,
      schema: {
        response: { 202: GeneratePlanResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );

      const { jobId, weekOf, plannedDays, basis } =
        await fastify.plansService.requestOnDemandGeneration({
          householdId: request.user.household_id,
          requestId,
        });

      return reply.status(202).send({
        job_id: jobId,
        week_of: weekOf,
        planned_days: plannedDays,
        basis,
      });
    },
  );

  // POST /v1/plans/:planId/variant-proposals/:proposalId/confirm
  //
  // Story 3.27 — parent confirms or rejects a Lumi-proposed preparation
  // variant. 204 on success. The proposal becomes inactive (no longer surfaced
  // in GET /v1/plans) regardless of choice, so the next pill the parent sees
  // is a fresh proposal from a future plan.
  fastify.post(
    '/v1/plans/:planId/variant-proposals/:proposalId/confirm',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          proposalId: z.string().uuid(),
        }),
        body: ConfirmVariantProposalInputSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { proposalId } = request.params as {
        planId: string;
        proposalId: string;
      };
      const body = request.body as ConfirmVariantProposalInput;

      await fastify.variantProposalService.confirmProposal({
        proposalId,
        householdId: request.user.household_id,
        choice: body.choice,
        requestId,
      });

      return reply.status(204).send();
    },
  );

  // GET /v1/plans/:weekOf/history
  //
  // Story 3-DM-C1 Phase 9b part 4 step 3 — tree-shape history response.
  // swap_history is `[]` for now (the canonical model has no archived
  // plan_items; audit-derived population lands in a follow-up slice).
  // ratings is keyed by child_id; it stays `{}` until Story 4.14 wires the
  // lunch_link_session projection here.
  fastify.get(
    '/v1/plans/:weekOf/history',
    {
      preHandler: requireMember,
      schema: {
        params: PlanWeekIdParamSchema,
        response: { 200: PlanHistoryResponseSchema },
      },
    },
    async (request, reply) => {
      const { weekOf } = request.params as { weekOf: string };
      const {
        plan,
        mainAssignments,
        days,
        slots,
        variations,
        swapHistory,
      } = await fastify.plansService.getPlanHistoryTree({
        householdId: request.user.household_id,
        weekOf,
      });
      return reply.status(200).send({
        plan,
        main_assignments: mainAssignments,
        days,
        slots,
        variations,
        swap_history: swapHistory,
        week_of: weekOf,
        ratings: {},
      });
    },
  );

  // PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe
  //
  // Story 3-DM-C1 — swap a shared Main. Affects every day whose main slot
  // points at this M-assignment (the dominant operation under the 3-Main
  // weekly pattern). Per-child variations carry their own removals / add_ons
  // that survive the swap untouched. The service re-evaluates the guardrail
  // against the new recipe per affected (child, day) pair.
  fastify.patch(
    '/v1/plans/:planId/main-assignments/:mainAssignmentId/recipe',
    {
      preHandler: requireMember,
      schema: {
        params: MainAssignmentParamSchema,
        body: SwapMainInputSchema,
        response: { 200: SwapMainResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, mainAssignmentId } = request.params as {
        planId: string;
        mainAssignmentId: string;
      };
      const body = request.body as SwapMainInput;

      const updated = await fastify.plansService.swapMain({
        planId,
        mainAssignmentId,
        householdId: request.user.household_id,
        requestId,
        input: body,
      });

      // Epic 13-s10 (AC10 / sse-remediation §2b Tier 2c) — the swap-main
      // optimistic pilot drops its client onSuccess refetch, so this route must
      // push plan.updated as the authoritative reconciler (and cross-tab
      // convergence). Scoped to swap-main only — the other swap routes still
      // refetch on success. Emit failure is non-fatal (the swap is committed).
      const plan = await fastify.plansService.findById(
        planId,
        request.user.household_id,
      );
      if (plan !== null) {
        fastify.sseDispatcher.emit(
          request.user.household_id,
          'message',
          JSON.stringify(buildPlanUpdatedPayload(deriveWeekId(plan.week_of))),
        );
      }

      return reply.status(200).send({ main_assignment: updated });
    },
  );

  // POST /v1/plans/:planId/swap-proposals
  //
  // Slice 5-S12 — conversational swap proposal (L3 DisambiguationPicker). Stores
  // the user's free-text intent as a TurnBodyProposal turn in the household's
  // family thread (lazily created). Lumi's resolution (swapMain + plan_diff
  // turn) is a deferred agent step (D-5S12-2).
  fastify.post(
    '/v1/plans/:planId/swap-proposals',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({ planId: z.string().uuid() }),
        body: ProposeSwapInputSchema,
        response: { 201: ProposeSwapResponseSchema },
      },
    },
    async (request, reply) => {
      requireIdempotencyKey(request.headers['idempotency-key']);
      const { planId } = request.params as { planId: string };
      const body = request.body as ProposeSwapInput;
      const householdId = request.user.household_id;

      // Verify the plan belongs to this household.
      const plan = await fastify.plansService.findById(planId, householdId);
      if (plan === null) throw new NotFoundError(`plan ${planId}`);

      // Ensure there is an active family thread (create if absent).
      const thread =
        (await fastify.threadRepository.findActiveThreadByHousehold(
          householdId,
          'family',
          'text',
        )) ??
        (await fastify.threadRepository.createThread(householdId, 'family', 'text'));

      const proposalId = randomUUID();
      await fastify.threadRepository.appendTurnNext({
        threadId: thread.id,
        role: 'user',
        body: {
          type: 'proposal',
          proposal_id: proposalId,
          day: body.day,
          content: body.content,
        },
        modality: 'text',
      });

      return reply.status(201).send({ proposal_id: proposalId });
    },
  );

  // PATCH /v1/plans/:planId/variations/:variationId
  //
  // Story 3-DM-C1 — patch a per-child variation. Recipe stays the same; the
  // guardrail re-evaluates against the NEW effective ingredient set
  // (recipe.ingredients − new.removals + new.add_ons). Pause-toggling is
  // not exposed here — pause flows live on /pause and /pause-child.
  fastify.patch(
    '/v1/plans/:planId/variations/:variationId',
    {
      preHandler: requireMember,
      schema: {
        params: VariationParamSchema,
        body: UpdateVariationInputSchema,
        response: { 200: UpdateVariationResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, variationId } = request.params as {
        planId: string;
        variationId: string;
      };
      const body = request.body as UpdateVariationInput;

      const updated = await fastify.plansService.updateVariation({
        planId,
        variationId,
        householdId: request.user.household_id,
        requestId,
        input: body,
      });

      return reply.status(200).send({ variation: updated });
    },
  );

  // PATCH /v1/plans/:planId/slots/:planSlotId/recipe
  //
  // Story 3-DM-C1 — swap the recipe on a snack or extra slot. Main slots
  // reject with 400 (use the main-assignments route). Each variation under
  // the slot is re-evaluated against the new recipe.
  fastify.patch(
    '/v1/plans/:planId/slots/:planSlotId/recipe',
    {
      preHandler: requireMember,
      schema: {
        params: PlanSlotParamSchema,
        body: SwapSlotRecipeInputSchema,
        response: { 200: SwapSlotRecipeResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, planSlotId } = request.params as {
        planId: string;
        planSlotId: string;
      };
      const body = request.body as SwapSlotRecipeInput;

      const updated = await fastify.plansService.swapSlotRecipe({
        planId,
        planSlotId,
        householdId: request.user.household_id,
        requestId,
        input: body,
      });

      return reply.status(200).send({ slot: updated });
    },
  );

  // PATCH /v1/plans/:planId/days/:day/pause
  //
  // Story 3-DM-C1 — full-day pause via plan_days.paused_at. reason is now
  // required (DB CHECK enforces paused_at + paused_reason set together). The
  // enum widens from 'sick' / 'absent' / 'holiday' to PauseReasonSchema's
  // six-value set ('sick_day' / 'holiday' / 'snow_day' / 'field_trip' /
  // 'half_day' / 'other').
  fastify.patch(
    '/v1/plans/:planId/days/:day/pause',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          day: WeekdaySchema,
        }),
        body: PausePlanDayTreeInputSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, day } = request.params as {
        planId: string;
        day: Weekday;
      };
      const body = request.body as PausePlanDayTreeInput;

      await fastify.plansService.pauseDayTree({
        planId,
        day,
        householdId: request.user.household_id,
        requestId,
        input: body,
      });

      return reply.status(204).send();
    },
  );

  // PATCH /v1/plans/:planId/days/:day/pause-child
  //
  // Story 3-DM-C1 — per-child day-level pause via plan_slot_variations.paused_at
  // for every (child_id, plan_day_id) pair. Used when ONE child is sick but
  // the rest of the family eats as planned. Idempotent: the RPC returns
  // pausedCount = 0 when all matching variations were already paused.
  fastify.patch(
    '/v1/plans/:planId/days/:day/pause-child',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          day: WeekdaySchema,
        }),
        body: PauseChildOnDayInputSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, day } = request.params as {
        planId: string;
        day: Weekday;
      };
      const body = request.body as PauseChildOnDayInput;

      await fastify.plansService.pauseChildOnDayTree({
        planId,
        day,
        householdId: request.user.household_id,
        requestId,
        input: body,
      });

      return reply.status(204).send();
    },
  );

  // POST /v1/plans/:planId/regenerate?scope=week|day&day=monday
  //
  // Story 3.13 — enqueues a plan-regeneration BullMQ job. Rate-limited to
  // 5/week/household. Returns 202 Accepted with { job_id, rate_limit_remaining }.
  // SSE plan.updated is deferred to Story 5.2; client polls via TanStack Query.
  fastify.post(
    '/v1/plans/:planId/regenerate',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({ planId: z.string().uuid() }),
        querystring: RegeneratePlanQuerySchema,
        response: { 202: RegeneratePlanResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId } = request.params as { planId: string };
      const query = request.query as RegeneratePlanQuery;

      const { jobId, rateLimitRemaining } =
        await fastify.plansService.requestRegeneration({
          planId,
          householdId: request.user.household_id,
          query,
          requestId,
        });

      return reply
        .status(202)
        .send({ job_id: jobId, rate_limit_remaining: rateLimitRemaining });
    },
  );

  // POST /v1/plans/:planId/slots/:planSlotId/override
  //
  // Story 3-DM-C1 — day-level context override scoped to a plan_slot.
  // Composition-changing overrides (field_trip / half_day / post_dentist /
  // sport_practice / test_day) enqueue a day-scope regen. Pause semantics
  // (formerly bag_suspended / sick_day) are no longer expressible here — the
  // canonical pause grain lives on plan_days.paused_at /
  // plan_slot_variations.paused_at, and those enum values were dropped by E1.
  fastify.post(
    '/v1/plans/:planId/slots/:planSlotId/override',
    {
      preHandler: requireMember,
      schema: {
        params: PlanDayContextSlotParamSchema,
        body: SetPlanDayContextInputSchema,
        response: { 201: SetPlanDayContextResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, planSlotId } = request.params as {
        planId: string;
        planSlotId: string;
      };
      const body = request.body as SetPlanDayContextInput;

      const { override, regenTriggered } =
        await fastify.planDayContextService.setOverride({
          planId,
          planSlotId,
          householdId: request.user.household_id,
          input: body,
          requestId,
        });

      return reply
        .status(201)
        .send({ override, regen_triggered: regenTriggered });
    },
  );

  // DELETE /v1/plans/:planId/slots/:planSlotId/override/:overrideId
  //
  // Story 3-DM-C1 — soft revert. 204 on success; 404 if the override does
  // not belong to this household or has already been reverted.
  fastify.delete(
    '/v1/plans/:planId/slots/:planSlotId/override/:overrideId',
    {
      preHandler: requireMember,
      schema: {
        params: PlanDayContextSlotRevertParamSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, planSlotId, overrideId } = request.params as {
        planId: string;
        planSlotId: string;
        overrideId: string;
      };

      await fastify.planDayContextService.revertOverride({
        planId,
        planSlotId,
        overrideId,
        householdId: request.user.household_id,
        requestId,
      });

      return reply.status(204).send();
    },
  );

  // POST /v1/plans/:planId/edit
  //
  // Epic 13-s9 — the conversational plan-edit turn. Body is either a free-text
  // utterance (one 'mini'-tier classifier call) or a pre-built intent (chip
  // tap — zero LLM). Dispatch + execution are deterministic; T2 intents come
  // back as `escalate` for the client's confirm gate (the expensive path never
  // fires from this route). A successful T0 mutation pushes plan.updated over
  // SSE so other tabs reconcile (13-s10).
  fastify.post(
    '/v1/plans/:planId/edit',
    {
      preHandler: requireMember,
      schema: {
        params: PlanEditParamSchema,
        body: PlanEditInputSchema,
        response: { 200: PlanEditResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId } = request.params as PlanEditParam;
      const householdId = request.user.household_id;
      const body = request.body as PlanEditInput;

      const { intent, dispatch, outcome, utterance, weekOf } =
        await fastify.planEditService.run({ planId, householdId, requestId, body });

      // Epic 13-s10 (AC6/AC8) — emit plan.updated only when state actually
      // changed: applied swaps/vary always; safety_write only on inserted:true;
      // commit only on the first confirm. No-op re-declares / re-confirms and
      // read/clarify/escalate suppress the emit.
      if (shouldEmitPlanUpdated(outcome)) {
        fastify.sseDispatcher.emit(
          householdId,
          'message',
          JSON.stringify(buildPlanUpdatedPayload(deriveWeekId(weekOf))),
        );
      }

      // Routing trace (spec §8) — fire-and-forget, no-op unless PLAN_TRACE_DIR.
      const tracer = createPlanIntentTracer({ householdId, planId }, request.log);
      void tracer?.write({ utterance, intent, dispatch, outcomeStatus: outcome.status });

      return reply
        .status(200)
        .send({ intent, tier: dispatch.tier, result: toWireResult(outcome) });
    },
  );
};

export const plansRoutes = fp(plansRoutesPlugin, { name: 'plans-routes' });
