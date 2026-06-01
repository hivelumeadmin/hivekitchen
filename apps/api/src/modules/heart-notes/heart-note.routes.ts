import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHeartNoteBodySchema,
  GetHeartNotesQuerySchema,
  HeartNoteIdParamSchema,
  HeartNoteNullablePayloadSchema,
  HeartNotePayloadSchema,
  HeartNotesListPayloadSchema,
  HeartNotesListQuerySchema,
  PatchHeartNoteBodySchema,
} from '@hivekitchen/contracts';
import type {
  CreateHeartNoteBody,
  GetHeartNotesQuery,
  HeartNoteIdParam,
  HeartNotesListQuery,
  PatchHeartNoteBody,
} from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { HeartNoteRepository } from './heart-note.repository.js';
import { HeartNoteService } from './heart-note.service.js';

const heartNoteRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY
    ? Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
    : null;
  const repository = new HeartNoteRepository(fastify.supabase, kek);
  const service = new HeartNoteService(repository);

  // Slice 4-S1 — either caregiver in the household may compose a heart note.
  // Authoring permission widens beyond the primary parent because both
  // caregivers are expected to leave their child a note (PRD FR32 framing).
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.post(
    '/v1/heart-notes',
    {
      preHandler: requireMember,
      schema: {
        body: CreateHeartNoteBodySchema,
        response: { 201: HeartNotePayloadSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateHeartNoteBody;
      const note = await service.createDraft(
        request.user.household_id,
        request.user.id,
        body,
      );
      request.auditContext = {
        event_type: 'heart_note.created',
        user_id: request.user.id,
        household_id: request.user.household_id,
        correlation_id: request.id,
        request_id: request.id,
        metadata: {
          heart_note_id: note.id,
          child_id: note.child_id,
          status: note.status,
        },
      };
      return reply.code(201).send({ note });
    },
  );

  fastify.get(
    '/v1/heart-notes',
    {
      preHandler: requireMember,
      schema: {
        querystring: GetHeartNotesQuerySchema,
        response: { 200: HeartNoteNullablePayloadSchema },
      },
    },
    async (request) => {
      const query = request.query as GetHeartNotesQuery;
      // S1 — date defaults to "today" in UTC; per-household-tz resolution is
      // a later slice (the scheduling work in 4-S6).
      const isoDate = query.date ?? new Date().toISOString().slice(0, 10);
      const note = await service.getDraft(
        request.user.household_id,
        query.child_id,
        isoDate,
      );
      return { note };
    },
  );

  // Slice 4-S6 — All Notes delivery-status list. Registered before the
  // PATCH /v1/heart-notes/:id route so '/history' is matched as a literal
  // path even though there is currently no GET /:id route; this keeps the
  // ordering intent explicit if a wildcard GET is ever added.
  fastify.get(
    '/v1/heart-notes/history',
    {
      preHandler: requireMember,
      schema: {
        querystring: HeartNotesListQuerySchema,
        response: { 200: HeartNotesListPayloadSchema },
      },
    },
    async (request) => {
      const query = request.query as HeartNotesListQuery;
      const notes = await service.listNotes(request.user.household_id, {
        status: query.status,
      });
      return { notes };
    },
  );

  fastify.patch(
    '/v1/heart-notes/:id',
    {
      preHandler: requireMember,
      schema: {
        params: HeartNoteIdParamSchema,
        body: PatchHeartNoteBodySchema,
        response: { 200: HeartNotePayloadSchema },
      },
    },
    async (request) => {
      const { id } = request.params as HeartNoteIdParam;
      const body = request.body as PatchHeartNoteBody;
      const note = await service.patchNote(id, request.user.household_id, body);
      request.auditContext = {
        event_type: 'heart_note.updated',
        user_id: request.user.id,
        household_id: request.user.household_id,
        correlation_id: request.id,
        request_id: request.id,
        metadata: {
          heart_note_id: note.id,
          child_id: note.child_id,
          status: note.status,
        },
      };
      return { note };
    },
  );
};

export const heartNoteRoutes = fp(heartNoteRoutesPlugin, { name: 'heart-note-routes' });
