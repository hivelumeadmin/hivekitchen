import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  LunchLinkDevParamsSchema,
  LunchLinkDevResponseSchema,
  GenerateLunchLinkBodySchema,
  GenerateLunchLinkResponseSchema,
  LunchLinkTokenParamSchema,
  LunchLinkPayloadSchema,
  LunchLinkExpiredPayloadSchema,
  RateLunchLinkBodySchema,
} from '@hivekitchen/contracts';
import type {
  LunchLinkDevParams,
  GenerateLunchLinkBody,
  LunchLinkTokenParam,
} from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { LunchLinkRepository } from './lunch-link.repository.js';
import { LunchLinkService, getMondayOfWeek } from './lunch-link.service.js';
import { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';
import { NotFoundError } from '../../common/errors.js';

const lunchLinkRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const lunchLinkRepo = new LunchLinkRepository(fastify.supabase);
  const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY
    ? Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
    : null;
  const heartNoteRepo = new HeartNoteRepository(fastify.supabase, kek);
  const service = new LunchLinkService(
    lunchLinkRepo,
    heartNoteRepo,
    fastify.env.WEB_BASE_URL,
  );

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

  // Slice 4-S3 — parent-facing: generate a real signed Lunch Link URL.
  // Auth-gated. Returns 404 if the child does not belong to the caller's household.
  fastify.post(
    '/v1/lunch-link/generate',
    {
      preHandler: requireMember,
      schema: {
        body: GenerateLunchLinkBodySchema,
        response: { 201: GenerateLunchLinkResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as GenerateLunchLinkBody;
      const result = await service.generate(request.user.household_id, body);

      request.auditContext = {
        event_type: 'lunch_link.created',
        household_id: request.user.household_id,
        user_id: request.user.id,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { child_id: body.child_id, date: body.date },
      };
      return reply.status(201).send(result);
    },
  );

  // Slice 4-S3 — child-facing: verify token + return payload or 410 snapshot.
  // PUBLIC — authenticate hook is skipped for GET /v1/lunch-link/:token via regex.
  // Never returns 401/403; all failure modes are 404 so the route cannot be
  // used as an oracle for the existence of a child or session.
  fastify.get(
    '/v1/lunch-link/:token',
    {
      schema: {
        params: LunchLinkTokenParamSchema,
        response: {
          200: LunchLinkPayloadSchema,
          410: LunchLinkExpiredPayloadSchema,
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params as LunchLinkTokenParam;
      const result = await service.verifyAndFetch(token);

      if (result.status === 'invalid') {
        throw new NotFoundError('Link not found');
      }

      if (result.status === 'expired') {
        request.auditContext = {
          event_type: 'lunch_link.expired',
          household_id: result.householdId,
          correlation_id: request.id,
          request_id: request.id,
          metadata: { child_id: result.childId, token_prefix: token.slice(0, 8) },
        };
        return reply.status(410).send(result.expiredPayload);
      }

      request.auditContext = {
        event_type: 'lunch_link.opened',
        household_id: result.householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { child_id: result.childId, date: result.payload.date },
      };
      return reply.send(result.payload);
    },
  );

  // Slice 4-S4 — child-facing: submit emoji rating for a lunch link session.
  // PUBLIC — authenticate hook is skipped for POST /v1/lunch-link/:token/rate.
  // All failure modes return 404 (never 401/403) — oracle prevention.
  fastify.post(
    '/v1/lunch-link/:token/rate',
    {
      schema: {
        params: LunchLinkTokenParamSchema,
      },
    },
    async (request, reply) => {
      const { token } = request.params as LunchLinkTokenParam;
      const bodyParsed = RateLunchLinkBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new NotFoundError('Link not found');
      }
      const { rating } = bodyParsed.data;

      const result = await service.rate(token, rating);
      if (result.status === 'invalid') {
        throw new NotFoundError('Link not found');
      }

      request.auditContext = {
        event_type: 'lunch_link.rated',
        household_id: result.householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { child_id: result.childId, date: result.date, rating },
      };

      // Fire-and-forget brief refresh — composer never throws (architecture §1.5).
      // weekId = Monday of the week containing the token's date.
      void fastify.briefStateComposer.refresh(
        result.householdId,
        getMondayOfWeek(result.date),
        request.id,
      );

      return reply.status(204).send();
    },
  );
};

export const lunchLinkRoutes = fp(lunchLinkRoutesPlugin, { name: 'lunch-link-routes' });
