import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { KitchenMapSchema } from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { ForbiddenError } from '../../common/errors.js';

const kitchenMapRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/households/:householdId/kitchen-map',
    {
      preHandler: authorize(['primary_parent', 'secondary_caregiver']),
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 200: KitchenMapSchema },
      },
    },
    async (request) => {
      const { householdId } = request.params as { householdId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household kitchen map');
      }
      return fastify.kitchenMapService.get(householdId);
    },
  );
};

export const kitchenMapRoutes = fp(kitchenMapRoutesPlugin, { name: 'kitchen-map-routes' });
