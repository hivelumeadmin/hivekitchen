import fp from 'fastify-plugin';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import {
  PausePlanDayInputSchema,
  SwapPlanItemInputSchema,
  SwapPlanItemResponseSchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
  GetPlansQuerySchema,
  GetPlansResponseSchema,
  PlanWeekIdParamSchema,
  PlanHistoryResponseSchema,
  SetDayOverrideInputSchema,
  SetDayOverrideResponseSchema,
  DayOverridePlanItemParamSchema,
  DayOverrideRevertParamSchema,
} from '@hivekitchen/contracts';
import type {
  PausePlanDayInput,
  PlanItemRow,
  SwapPlanItemInput,
  RegeneratePlanQuery,
  GetPlansQuery,
  SetDayOverrideInput,
} from '@hivekitchen/types';
import { ValidationError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';

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
  // Story 3.14 — drives the upcoming-week tab on the brief surface (FR21).
  // Returns { plan: null, plan_items: [], is_draft: true, week_of: <ISO> } when
  // the week's plan has not yet been generated; the client renders the
  // "Lumi is drafting next week" loading state.
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
      const { plan, planItems, isDraft, weekOf } = await fastify.plansService.getPlanForWeek({
        householdId,
        week,
      });

      // Story 3.25/3.26 — hard-fail surface. Only check when plan===null &&
      // !isDraft (the slow path that hits the reworking UX). Drafts never
      // hard-fail since they haven't gone through the guardrail loop yet.
      // Story 3.26 — payload now includes failed_at so the client can render
      // a real estimated recovery time (failed_at + 1h).
      let hardFail: { week_of: string; failed_at: string } | null = null;
      if (plan === null && !isDraft) {
        try {
          hardFail = await fastify.plansService.getHardFailStatus(householdId, weekOf);
        } catch (err) {
          request.log.error({ err, householdId, weekOf }, 'getHardFailStatus failed — omitting hard_fail from response');
        }
      }

      return reply.status(200).send({
        plan: plan ?? null,
        plan_items: planItems,
        is_draft: isDraft,
        week_of: weekOf,
        ...(hardFail !== null ? { hard_fail: hardFail } : {}),
      });
    },
  );

  // GET /v1/plans/:weekId/history
  // Story 3.15 — historical plan + outcomes view (FR25).
  // Returns the FINAL plan committed for a week + a per-slot swap audit
  // derived from archived plan_items. ratings is keyed by child_id; it is
  // always {} until Epic 4 lunch_link_sessions ships and Story 4.14 wires
  // the rating projection in here.
  fastify.get(
    '/v1/plans/:weekId/history',
    {
      preHandler: requireMember,
      schema: {
        params: PlanWeekIdParamSchema,
        response: { 200: PlanHistoryResponseSchema },
      },
    },
    async (request, reply) => {
      const { weekId } = request.params as { weekId: string };
      const { plan, planItems, swapHistory, weekOf } =
        await fastify.plansService.getPlanHistory({
          householdId: request.user.household_id,
          weekId,
        });
      return reply.status(200).send({
        plan,
        plan_items: planItems,
        swap_history: swapHistory,
        week_of: weekOf,
        ratings: {},
      });
    },
  );

  // PATCH /v1/plans/:planId/items/:itemId
  // Per-slot ingredient swap. Runs allergyGuardrail.evaluate on the new item only.
  // Returns 200 { item } on success; 422 if guardrail blocks; 404 if plan/item not found.
  fastify.patch(
    '/v1/plans/:planId/items/:itemId',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          itemId: z.string().uuid(),
        }),
        body: SwapPlanItemInputSchema,
        response: { 200: SwapPlanItemResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, itemId } = request.params as {
        planId: string;
        itemId: string;
      };
      const body = request.body as SwapPlanItemInput;

      const updatedItem = await fastify.plansService.swapItem({
        planId,
        itemId,
        householdId: request.user.household_id,
        input: body,
        requestId,
      });

      return reply.status(200).send({ item: updatedItem });
    },
  );

  // PATCH /v1/plans/:planId/days/:day/pause
  // Sick-day pause. Sets paused_at on all plan_items for the day.
  // Returns 204. Idempotent at DB level (re-pausing already-paused day is a no-op).
  fastify.patch(
    '/v1/plans/:planId/days/:day/pause',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          day: z.enum([
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
          ]),
        }),
        body: PausePlanDayInputSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, day } = request.params as {
        planId: string;
        day: PlanItemRow['day'];
      };
      const body = request.body as PausePlanDayInput;

      await fastify.plansService.pauseDay({
        planId,
        day,
        householdId: request.user.household_id,
        requestId,
        reason: body.reason,
      });

      return reply.status(204).send();
    },
  );

  // POST /v1/plans/:planId/regenerate?scope=week|day&day=monday
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

      const { jobId, rateLimitRemaining } = await fastify.plansService.requestRegeneration({
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

  // POST /v1/plans/:planId/items/:itemId/override
  // Story 3.19 — day-level context override (FR118, FR119). Composition-changing
  // overrides enqueue a day-scope regen via REGEN_QUEUE; pausing overrides
  // (bag_suspended, sick_day) flip the slot's paused_at and refresh the brief.
  fastify.post(
    '/v1/plans/:planId/items/:itemId/override',
    {
      preHandler: requireMember,
      schema: {
        params: DayOverridePlanItemParamSchema,
        body: SetDayOverrideInputSchema,
        response: { 201: SetDayOverrideResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, itemId } = request.params as {
        planId: string;
        itemId: string;
      };
      const body = request.body as SetDayOverrideInput;

      const { override, regenTriggered } =
        await fastify.dayOverridesService.setOverride({
          planId,
          planItemId: itemId,
          householdId: request.user.household_id,
          input: body,
          requestId,
        });

      return reply
        .status(201)
        .send({ override, regen_triggered: regenTriggered });
    },
  );

  // DELETE /v1/plans/:planId/items/:itemId/override/:overrideId
  // Story 3.19 — soft revert. Returns 204 on success; 404 if the override
  // does not belong to this household or has already been reverted.
  fastify.delete(
    '/v1/plans/:planId/items/:itemId/override/:overrideId',
    {
      preHandler: requireMember,
      schema: {
        params: DayOverrideRevertParamSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, itemId, overrideId } = request.params as {
        planId: string;
        itemId: string;
        overrideId: string;
      };

      await fastify.dayOverridesService.revertOverride({
        planId,
        planItemId: itemId,
        overrideId,
        householdId: request.user.household_id,
        requestId,
      });

      return reply.status(204).send();
    },
  );
};

export const plansRoutes = fp(plansRoutesPlugin, { name: 'plans-routes' });
