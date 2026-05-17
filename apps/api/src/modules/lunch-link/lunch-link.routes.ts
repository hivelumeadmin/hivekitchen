import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  LunchLinkDevParamsSchema,
  LunchLinkDevResponseSchema,
} from '@hivekitchen/contracts';
import type { LunchLinkDevParams } from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { LunchLinkRepository } from './lunch-link.repository.js';
import { LunchLinkService } from './lunch-link.service.js';
import { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';
import { NotFoundError } from '../../common/errors.js';

const lunchLinkRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const lunchLinkRepo = new LunchLinkRepository(fastify.supabase);
  const heartNoteRepo = new HeartNoteRepository(fastify.supabase);
  const service = new LunchLinkService(lunchLinkRepo, heartNoteRepo);

  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  // Dev-only stub endpoint. Allow-list of envs that may serve it: any other
  // value (including unset / typo'd `'prod'`, `'preview'`, `'qa'`, etc.) must
  // fail-closed so a deploy-config misstep cannot expose real child data
  // through an unprotected child-surface URL. Real signed tokens + public
  // access ship in slice 4-S3.
  fastify.get(
    '/v1/lunch-link-dev/:childId/:date',
    {
      preHandler: requireMember,
      schema: {
        params: LunchLinkDevParamsSchema,
        response: { 200: LunchLinkDevResponseSchema },
      },
    },
    async (request, reply) => {
      if (
        fastify.env.NODE_ENV !== 'development' &&
        fastify.env.NODE_ENV !== 'test'
      ) {
        throw new NotFoundError('Not found');
      }

      const { childId, date } = request.params as LunchLinkDevParams;
      const payload = await service.getDevPayload(
        request.user.household_id,
        childId,
        date,
      );
      if (payload === null) throw new NotFoundError('Child not found in household');
      return reply.send(payload);
    },
  );
};

export const lunchLinkRoutes = fp(lunchLinkRoutesPlugin, { name: 'lunch-link-routes' });
