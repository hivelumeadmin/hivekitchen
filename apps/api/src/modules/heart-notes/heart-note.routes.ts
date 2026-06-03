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
import { GuestAuthorCapReachedError } from '../../common/errors.js';
import { HeartNoteRepository } from './heart-note.repository.js';
import { HeartNoteService } from './heart-note.service.js';

// Slice 4-S13 — guest_author monthly cap. Counted against the calendar month
// a note is *created* in; a note scheduled for a later month bypasses the cap.
// Exported so GET /v1/guest-author/cap can surface the same value without
// duplicating the constant.
export const GUEST_AUTHOR_CAP = 2;

// True when `isoDate` (YYYY-MM-DD) lands in a calendar month strictly after
// the current one (UTC). The cap bypass — "Save for next month" — only applies
// when the note is scheduled past the current month.
function isNextMonthOrLater(isoDate: string | undefined | null): boolean {
  if (!isoDate) return false;
  const now = new Date();
  const target = new Date(isoDate);
  return (
    target.getUTCFullYear() > now.getUTCFullYear() ||
    (target.getUTCFullYear() === now.getUTCFullYear() && target.getUTCMonth() > now.getUTCMonth())
  );
}

const heartNoteRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY
    ? Buffer.from(fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
    : null;
  const repository = new HeartNoteRepository(fastify.supabase, kek);
  const service = new HeartNoteService(repository);

  // Slice 4-S1 — either caregiver in the household may compose a heart note.
  // Authoring permission widens beyond the primary parent because both
  // caregivers are expected to leave their child a note (PRD FR32 framing).
  // GET routes stay caregiver-only; the grandparent reads its cap via
  // GET /v1/guest-author/cap, not the draft/history endpoints.
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);
  // Slice 4-S13 — guest_author may compose (POST) and schedule/cancel their own
  // note (PATCH). The service's household filter scopes PATCH to their own
  // household's notes, which is sufficient ownership for this slice.
  const requireAuthor = authorize(['primary_parent', 'secondary_caregiver', 'guest_author']);

  fastify.post(
    '/v1/heart-notes',
    {
      preHandler: requireAuthor,
      schema: {
        body: CreateHeartNoteBodySchema,
        response: { 201: HeartNotePayloadSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateHeartNoteBody;
      // Slice 4-S13 — cap enforcement is guest_author-only; primary_parent and
      // secondary_caregiver never hit a cap. A note scheduled for next month
      // bypasses the cap (the "Save for July 1" escape hatch).
      if (request.user.role === 'guest_author') {
        const notesUsed = await repository.countAuthoredThisMonth(
          request.user.id,
          request.user.household_id,
        );
        if (notesUsed >= GUEST_AUTHOR_CAP && !isNextMonthOrLater(body.scheduled_for)) {
          throw new GuestAuthorCapReachedError();
        }
      }
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
      preHandler: requireAuthor,
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
