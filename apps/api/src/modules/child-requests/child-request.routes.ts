import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { PendingChildRequestsResponseSchema } from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import { ThreadRepository } from '../threads/thread.repository.js';
import { ChildRequestRepository } from './child-request.repository.js';
import { ChildRequestService } from './child-request.service.js';

// Slice 4-S15 — parent-facing child-request endpoints. Gated to household
// members; guest_author (grandparents) cannot see or resolve child requests.

const IdParamSchema = z.object({ id: z.string().uuid() });
const OkResponseSchema = z.object({ ok: z.literal(true) });

const childRequestRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY
    ? Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
    : null;

  const service = new ChildRequestService(
    new ChildRequestRepository(fastify.supabase),
    new FoodPreferencesRepository(fastify.supabase, kek),
    new ThreadRepository(fastify.supabase),
    fastify.log,
  );

  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.get(
    '/v1/child-requests',
    {
      preHandler: requireMember,
      schema: {
        response: { 200: PendingChildRequestsResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await service.getPendingRequests(request.user.household_id);
      return reply.send(result);
    },
  );

  fastify.post(
    '/v1/child-requests/:id/approve',
    {
      preHandler: requireMember,
      schema: {
        params: IdParamSchema,
        response: { 200: OkResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParamSchema>;
      await service.approve(id, {
        resolvedByUserId: request.user.id,
        householdId: request.user.household_id,
      });
      return reply.send({ ok: true });
    },
  );

  fastify.post(
    '/v1/child-requests/:id/decline',
    {
      preHandler: requireMember,
      schema: {
        params: IdParamSchema,
        response: { 200: OkResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParamSchema>;
      await service.decline(id, {
        resolvedByUserId: request.user.id,
        householdId: request.user.household_id,
      });
      return reply.send({ ok: true });
    },
  );
};

export const childRequestRoutes = fp(childRequestRoutesPlugin, {
  name: 'child-request-routes',
});
