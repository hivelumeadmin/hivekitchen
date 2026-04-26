import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  PasswordResetRequestSchema,
  UpdateProfileRequestSchema,
  UserProfileSchema,
} from '@hivekitchen/contracts';
import type { UpdateProfileRequest, PasswordResetRequest } from '@hivekitchen/types';
import { UserRepository } from './user.repository.js';
import { UserService } from './user.service.js';

const userRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new UserRepository(fastify.supabase);
  const service = new UserService(repository, fastify.supabase);

  fastify.get(
    '/v1/users/me',
    {
      schema: { response: { 200: UserProfileSchema } },
    },
    async (request) => {
      return service.getMyProfile(request.user.id);
    },
  );

  fastify.patch(
    '/v1/users/me',
    {
      schema: {
        body: UpdateProfileRequestSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (request) => {
      const body = request.body as UpdateProfileRequest;
      const { profile, fieldsChanged } = await service.updateMyProfile(request.user.id, body);
      request.auditContext = {
        event_type: 'account.updated',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { fields_changed: fieldsChanged },
      };
      return profile;
    },
  );

  fastify.post(
    '/v1/auth/password-reset',
    {
      schema: { body: PasswordResetRequestSchema },
    },
    async (request, reply) => {
      const body = request.body as PasswordResetRequest;
      await service.initiatePasswordReset(body.email, fastify.env.WEB_BASE_URL);
      request.auditContext = {
        event_type: 'auth.password_reset_initiated',
        request_id: request.id,
        metadata: {},
      };
      return reply.code(204).send();
    },
  );
};

export const userRoutes = fp(userRoutesPlugin, { name: 'user-routes' });
