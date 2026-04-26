import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  RedeemInviteRequestSchema,
  RedeemInviteResponseSchema,
} from '@hivekitchen/contracts';
import type { z } from 'zod';
import { ForbiddenError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { InviteRepository } from './invite.repository.js';
import { InviteService } from './invite.service.js';

type CreateInviteBody = z.infer<typeof CreateInviteRequestSchema>;
type RedeemInviteBody = z.infer<typeof RedeemInviteRequestSchema>;

interface CreateInviteParams {
  id: string;
}

const inviteRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new InviteRepository(fastify.supabase);
  const service = new InviteService(repository, fastify.jwt);
  const auditService = new AuditService(new AuditRepository(fastify.supabase));

  fastify.post(
    '/v1/households/:id/invites',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        body: CreateInviteRequestSchema,
        response: { 201: CreateInviteResponseSchema },
      },
    },
    async (request, reply) => {
      const params = request.params as CreateInviteParams;
      const body = request.body as CreateInviteBody;
      const user = request.user;

      if (params.id !== user.household_id) {
        throw new ForbiddenError('You may only invite to your own household');
      }

      const result = await service.createInvite({
        household_id: user.household_id,
        role: body.role,
        invited_by_user_id: user.id,
        invited_email: body.email ?? null,
      });

      void auditService
        .write({
          event_type: 'invite.sent',
          household_id: user.household_id,
          user_id: user.id,
          request_id: request.id,
          metadata: {
            invite_id: result.invite_id,
            household_id: user.household_id,
            role: body.role,
            has_invited_email: body.email !== undefined,
          },
        })
        .catch((err: unknown) => {
          request.log.error({ err }, 'invite.sent audit write failed');
        });

      return reply.code(201).send({ invite_url: result.invite_url });
    },
  );

  fastify.post(
    '/v1/auth/invites/redeem',
    {
      schema: {
        body: RedeemInviteRequestSchema,
        response: { 200: RedeemInviteResponseSchema },
      },
    },
    async (request) => {
      const body = request.body as RedeemInviteBody;
      const result = await service.redeemInvite(body.token);

      void auditService
        .write({
          event_type: 'invite.redeemed',
          household_id: result.household_id,
          correlation_id: result.invite_id,
          request_id: request.id,
          metadata: {
            invite_id: result.invite_id,
            household_id: result.household_id,
          },
        })
        .catch((err: unknown) => {
          request.log.error({ err }, 'invite.redeemed audit write failed');
        });

      return {
        role: result.role,
        scope_target: result.scope_target,
        household_id: result.household_id,
      };
    },
  );
};

export const inviteRoutes = fp(inviteRoutesPlugin, { name: 'invite-routes' });
