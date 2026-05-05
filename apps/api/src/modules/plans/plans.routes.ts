import fp from 'fastify-plugin';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import {
  PausePlanDayInputSchema,
  SwapPlanItemInputSchema,
  SwapPlanItemResponseSchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
} from '@hivekitchen/contracts';
import type {
  PausePlanDayInput,
  PlanItemRow,
  SwapPlanItemInput,
  RegeneratePlanQuery,
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
};

export const plansRoutes = fp(plansRoutesPlugin, { name: 'plans-routes' });
