import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  LoginRequestSchema,
  LoginResponseSchema,
  OAuthCallbackRequestSchema,
  RefreshResponseSchema,
} from '@hivekitchen/contracts';
import { UnauthorizedError } from '../../common/errors.js';
import { z } from 'zod';
import { AuthRepository } from './auth.repository.js';
import { AuthService, type LoginResult } from './auth.service.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';

type LoginBody = z.infer<typeof LoginRequestSchema>;
type CallbackBody = z.infer<typeof OAuthCallbackRequestSchema>;

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AuthService(
    new AuthRepository(fastify.supabase),
    fastify.supabase,
    fastify.jwt,
  );
  const auditService = new AuditService(new AuditRepository(fastify.supabase));

  fastify.post(
    '/v1/auth/login',
    { schema: { body: LoginRequestSchema, response: { 200: LoginResponseSchema } } },
    async (request, reply) => {
      const body = request.body as LoginBody;
      const result = await service.loginWithPassword(body);
      setRefreshCookie(reply, result.refresh_token_plaintext, result.refresh_token_max_age_seconds, fastify.env);
      if (result.is_first_login) {
        void auditService.write({
          event_type: 'account.created',
          user_id: result.user.id,
          request_id: request.id,
          metadata: {},
        }).catch((err: unknown) => {
          request.log.error({ err }, 'account.created audit write failed');
        });
      }
      request.auditContext = {
        event_type: 'auth.login',
        user_id: result.user.id,
        request_id: request.id,
        metadata: { method: 'email', is_first_login: result.is_first_login },
      };
      return loginPayload(result);
    },
  );

  fastify.post(
    '/v1/auth/callback',
    { schema: { body: OAuthCallbackRequestSchema, response: { 200: LoginResponseSchema } } },
    async (request, reply) => {
      const body = request.body as CallbackBody;
      const result = await service.loginWithOAuth(body);
      setRefreshCookie(reply, result.refresh_token_plaintext, result.refresh_token_max_age_seconds, fastify.env);
      if (result.is_first_login) {
        void auditService.write({
          event_type: 'account.created',
          user_id: result.user.id,
          request_id: request.id,
          metadata: {},
        }).catch((err: unknown) => {
          request.log.error({ err }, 'account.created audit write failed');
        });
      }
      request.auditContext = {
        event_type: 'auth.login',
        user_id: result.user.id,
        request_id: request.id,
        metadata: { method: body.provider, is_first_login: result.is_first_login },
      };
      return loginPayload(result);
    },
  );

  fastify.post(
    '/v1/auth/refresh',
    { schema: { body: z.object({}).strict(), response: { 200: RefreshResponseSchema } } },
    async (request, reply) => {
      const plaintext = request.cookies['refresh_token'] ?? '';
      const result = await service.refreshToken(plaintext);

      if (result.type === 'reuse_detected') {
        request.auditContext = {
          event_type: 'auth.token_reuse_revoked',
          user_id: result.user_id,
          request_id: request.id,
          metadata: {},
        };
        throw new UnauthorizedError('Token reuse detected');
      }

      setRefreshCookie(
        reply,
        result.refresh_token_plaintext,
        result.refresh_token_max_age_seconds,
        fastify.env,
      );
      request.auditContext = {
        event_type: 'auth.refresh_rotated',
        user_id: result.user_id,
        request_id: request.id,
        metadata: {},
      };
      return { access_token: result.access_token, expires_in: result.expires_in };
    },
  );

  fastify.post('/v1/auth/logout', async (request, reply) => {
    const token = request.cookies['refresh_token'] ?? '';
    const { user_id } = await service.logout(token);
    void reply.clearCookie('refresh_token', { path: '/v1/auth' });
    request.auditContext = {
      event_type: 'auth.logout',
      user_id: user_id ?? undefined,
      request_id: request.id,
      metadata: {},
    };
    return reply.code(204).send();
  });
};

function loginPayload(result: LoginResult) {
  return {
    access_token: result.access_token,
    expires_in: result.expires_in,
    user: result.user,
    is_first_login: result.is_first_login,
  };
}

function setRefreshCookie(
  reply: FastifyReply,
  value: string,
  maxAgeSeconds: number,
  env: { NODE_ENV: string },
): void {
  void reply.setCookie('refresh_token', value, {
    httpOnly: true,
    secure: env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/v1/auth',
    maxAge: maxAgeSeconds,
  });
}
