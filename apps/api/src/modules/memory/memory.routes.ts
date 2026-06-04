import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GetProvenanceResponseSchema } from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { NotFoundError } from '../../common/errors.js';

const memoryRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver']);

  // Story 7-S2 — GET /v1/memory/:nodeId/provenance
  // Returns provenance records for a node owned by the caller's household.
  // Returns 404 for missing nodes AND cross-household probes (no info leakage).
  fastify.get(
    '/v1/memory/:nodeId/provenance',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ nodeId: z.string().uuid() }),
        response: { 200: GetProvenanceResponseSchema },
      },
    },
    async (request) => {
      const { nodeId } = request.params as { nodeId: string };
      const householdId = request.user.household_id;
      const provenance = await fastify.memoryService.getProvenance(nodeId, householdId);
      if (provenance === null) throw new NotFoundError('Memory node not found');
      return { provenance };
    },
  );
};

export const memoryRoutes = fp(memoryRoutesPlugin, { name: 'memory-routes' });
