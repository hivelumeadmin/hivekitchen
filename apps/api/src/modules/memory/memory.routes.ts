import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  GetProvenanceResponseSchema,
  EditMemoryRequestSchema,
  EditMemoryResponseSchema,
  ForgetMemoryRequestSchema,
  ForgetMemoryResponseSchema,
} from '@hivekitchen/contracts';
import type { EditMemoryRequest, ForgetMemoryRequest } from '@hivekitchen/types';
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

  // Story 7-S3 — PATCH /v1/memory/:nodeId
  // Edits a memory sentence owned by the caller's household. Returns 404 for
  // missing nodes AND cross-household probes (no info leakage).
  fastify.patch(
    '/v1/memory/:nodeId',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ nodeId: z.string().uuid() }),
        body: EditMemoryRequestSchema,
        response: { 200: EditMemoryResponseSchema },
      },
    },
    async (request) => {
      const { nodeId } = request.params as { nodeId: string };
      const { prose_text, reason } = request.body as EditMemoryRequest;
      const node = await fastify.memoryService.editProse(
        nodeId,
        request.user.household_id,
        request.user.id,
        prose_text,
        reason,
      );
      if (node === null) throw new NotFoundError('Memory node not found');
      return { node };
    },
  );

  // Story 7-S4 — PATCH /v1/memory/:nodeId/forget
  // Soft-forgets a memory node owned by the caller's household.
  // Returns 404 for missing, cross-household, AND already-soft-forgotten nodes.
  fastify.patch(
    '/v1/memory/:nodeId/forget',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ nodeId: z.string().uuid() }),
        body: ForgetMemoryRequestSchema,
        response: { 200: ForgetMemoryResponseSchema },
      },
    },
    async (request) => {
      const { nodeId } = request.params as { nodeId: string };
      const { reason } = request.body as ForgetMemoryRequest;
      const node = await fastify.memoryService.softForget(
        nodeId,
        request.user.household_id,
        request.user.id,
        reason?.trim() || null,
      );
      if (node === null) throw new NotFoundError('Memory node not found');
      // SSE forget.completed — server-side emit is deferred; web uses the
      // API response for optimistic update. ForgetCompletedEvent contract
      // is already defined in @hivekitchen/contracts for future fan-out.
      return { node };
    },
  );
};

export const memoryRoutes = fp(memoryRoutesPlugin, { name: 'memory-routes' });
