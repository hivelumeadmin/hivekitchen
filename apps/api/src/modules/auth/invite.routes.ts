import fp from 'fastify-plugin';
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import {
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  RedeemInviteRequestSchema,
  RedeemInviteResponseSchema,
  AcceptInviteRequestSchema,
  AcceptInviteResponseSchema,
} from '@hivekitchen/contracts';
import type { AuthUser } from '@hivekitchen/types';
import type { z } from 'zod';
import { ForbiddenError, UnauthorizedError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { UserRepository } from '../users/user.repository.js';
import { InviteRepository } from './invite.repository.js';
import { InviteService } from './invite.service.js';

type CreateInviteBody = z.infer<typeof CreateInviteRequestSchema>;
type RedeemInviteBody = z.infer<typeof RedeemInviteRequestSchema>;
type AcceptInviteBody = z.infer<typeof AcceptInviteRequestSchema>;

interface CreateInviteParams {
  id: string;
}

interface AccessTokenPayload {
  sub: string;
  hh: string;
  role: AuthUser['role'];
}

const inviteRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new InviteRepository(fastify.supabase);
  const userRepository = new UserRepository(fastify.supabase);
  const service = new InviteService(repository, fastify.jwt, userRepository, fastify.log);
  const auditService = new AuditService(new AuditRepository(fastify.supabase));

  // The global authenticate hook skips the /v1/auth/ prefix (it hosts public
  // endpoints like login + redeem), so the accept route — which DOES require a
  // signed-in invitee — authenticates the bearer token itself and populates
  // request.user, mirroring authenticate.hook.ts. Missing/invalid → 401 (AC#8).
  const authenticateInvitee: preHandlerHookHandler = async (request) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication required');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedError('Authentication required');
    }
    let payload: AccessTokenPayload;
    try {
      payload = fastify.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedError('Invalid or missing access token');
    }
    request.user = { id: payload.sub, household_id: payload.hh, role: payload.role };
  };

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

  // Slice 5-S2 — authenticated caregiver redemption. Validates + marks the
  // invite redeemed (reusing redeemInvite atomicity), links the invitee to the
  // household, and returns a fresh access_token carrying the updated `hh` claim.
  fastify.post(
    '/v1/auth/invites/accept',
    {
      preHandler: authenticateInvitee,
      schema: {
        body: AcceptInviteRequestSchema,
        response: { 200: AcceptInviteResponseSchema },
      },
    },
    async (request) => {
      const body = request.body as AcceptInviteBody;
      // P4 — reject if the invitee already belongs to a household.
      if (request.user.household_id) {
        throw new ForbiddenError('You are already a member of a household');
      }
      const { updatedUser, redeemResult } = await service.acceptInvite(body.token, request.user.id);

      const user: AuthUser = {
        id: updatedUser.id,
        email: updatedUser.email,
        display_name: updatedUser.display_name,
        current_household_id: redeemResult.household_id,
        role: updatedUser.role,
      };

      // Fresh access_token with the updated household + role claims. Default
      // 15m TTL from the jwt plugin registration — matches completeLogin().
      const access_token = fastify.jwt.sign({
        sub: user.id,
        hh: redeemResult.household_id,
        role: user.role,
      });

      void auditService
        .write({
          event_type: 'invite.redeemed',
          household_id: redeemResult.household_id,
          user_id: request.user.id,
          correlation_id: redeemResult.invite_id,
          request_id: request.id,
          metadata: {
            invite_id: redeemResult.invite_id,
            invitee_user_id: request.user.id,
            household_id: redeemResult.household_id,
          },
        })
        .catch((err: unknown) => {
          request.log.error({ err }, 'invite.redeemed (accept) audit write failed');
        });

      return {
        access_token,
        user,
        household_id: redeemResult.household_id,
        scope_target: '/app',
      };
    },
  );
};

export const inviteRoutes = fp(inviteRoutesPlugin, { name: 'invite-routes' });
