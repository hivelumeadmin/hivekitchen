import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  BriefResponseSchema,
  GetMemoryResponseSchema,
  TileRetryRequestSchema,
  CreateExtraLibraryItemInputSchema,
  ExtraLibraryItemSchema,
  ListExtraLibraryResponseSchema,
  ExtraLibraryHouseholdIdParamSchema,
  HouseholdIdParamSchema,
  HouseholdProfilePatchBodySchema,
  HouseholdProfileResponseSchema,
  UpdateSovereigntyModeInputSchema,
  UpdateSovereigntyModeResponseSchema,
  ParentalDashboardResponseSchema,
  ConsentHistoryResponseSchema,
  DataExportResponseSchema,
  DeleteHouseholdRequestSchema,
  DeleteHouseholdResponseSchema,
  HouseholdMembersResponseSchema,
  DayAssignmentsResponseSchema,
  AssignPackerRequestSchema,
  AssignPackerResponseSchema,
} from '@hivekitchen/contracts';
import type {
  TileRetryRequest,
  HouseholdProfilePatchBody,
  UpdateSovereigntyModeInput,
  AssignPackerRequest,
} from '@hivekitchen/contracts';
import type { CreateExtraLibraryItemInput } from '@hivekitchen/types';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { HouseholdsRepository } from './households.repository.js';
import { HouseholdsService } from './households.service.js';
import { ExtraLibraryRepository } from './extra-library.repository.js';
import { DayAssignmentsRepository } from './day-assignments.repository.js';
import { ThreadRepository } from '../threads/thread.repository.js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { UserRepository } from '../users/user.repository.js';
import { MemoryRepository } from '../memory/memory.repository.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { ComplianceRepository } from '../compliance/compliance.repository.js';
import { ParentalDashboardService } from './parental-dashboard.service.js';
import { DATA_EXPORT_QUEUE, type DataExportJobData } from '../../jobs/data-export.job.js';

// Story 2.14: anxiety-leakage telemetry primitive. The Plan Tile component
// (Epic 3) emits a tile-retry beacon every time the parent re-edits the same
// slot/day. Three or more retries on the same edit_key within 60 seconds
// during the first 14 days flips the household-level ghost-timestamp flag
// (renders a "saved just now" pip on the tile after edits — UX-DR66 fallback
// for the parent who keeps looking for a save button). Beyond 14 days the
// flag never flips because the mental-model copy is presumed to have landed.
const SIXTY_SECONDS_MS = 60_000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const RETRY_THRESHOLD = 3;

const householdsRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  const households = new HouseholdsRepository(fastify.supabase, kek);
  const householdsService = new HouseholdsService({
    repository: households,
    vocabulary: fastify.vocabularyService,
    logger: fastify.log,
  });
  const auditService = new AuditService(new AuditRepository(fastify.supabase));
  // Story 3.21 — household-scoped Extra library.
  const extraLibraryRepository = new ExtraLibraryRepository(fastify.supabase);
  // Slice 5-S2 — household member roster read.
  const userRepository = new UserRepository(fastify.supabase);
  // Slice 5-S3 — PackerOfTheDay assignments + lazy coordination thread.
  const dayAssignmentsRepo = new DayAssignmentsRepository(fastify.supabase);
  const threadRepository = new ThreadRepository(fastify.supabase);

  // Story 7-S8 — parental review dashboard service. Composes four existing
  // reads; no new persisted data. The ChildrenRepository wiring is copied
  // verbatim from children.routes.ts (it needs the ChildAllergensRepository).
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
  const parentalDashboardService = new ParentalDashboardService({
    childrenRepository: new ChildrenRepository(
      fastify.supabase,
      kek,
      fastify.log,
      childAllergensRepository,
    ),
    memoryRepository: new MemoryRepository(fastify.supabase),
    culturalPriorRepository: new CulturalPriorRepository(fastify.supabase),
    complianceRepository: new ComplianceRepository(fastify.supabase),
  });

  // Both primary_parent and secondary_caregiver may be editing tiles, and
  // both should contribute to the per-user retry count.
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.post(
    '/v1/households/tile-retry',
    {
      preHandler: requireMember,
      schema: { body: TileRetryRequestSchema },
    },
    async (request, reply) => {
      const body = request.body as TileRetryRequest;
      const householdId = request.user.household_id;
      const userId = request.user.id;

      // 1. Persist the retry audit row first — this is the mechanism that the
      //    threshold check counts against, so it MUST be awaited (a swallowed
      //    failure would let the count drift below threshold). Failure here
      //    propagates to the global error handler and surfaces as 500 so the
      //    client retries.
      await auditService.write({
        event_type: 'tile.edit_retried',
        user_id: userId,
        household_id: householdId,
        request_id: request.id,
        metadata: {
          tile_id: body.tile_id,
          edit_key: body.edit_key,
          timestamp_ms: body.timestamp_ms,
        },
      });

      // 2. Count recent retries for this user + edit_key in the last 60s.
      //    Includes the row we just wrote, so a fresh user reaches count=3 on
      //    their third retry. user_id (not household_id) — the retry is
      //    user-scoped so a secondary caregiver's edits don't conflate with
      //    the primary parent's. Targeted query (count=exact, head=true) so
      //    the row payload is never returned.
      const sixtySecondsAgo = new Date(Date.now() - SIXTY_SECONDS_MS).toISOString();
      const { count, error: countError } = await fastify.supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'tile.edit_retried')
        .eq('user_id', userId)
        .eq('metadata->>edit_key', body.edit_key)
        .gte('created_at', sixtySecondsAgo);
      if (countError) throw countError;

      const retryCount = count ?? 0;

      if (retryCount >= RETRY_THRESHOLD) {
        // 3. Within the week-1–2 window? After 14 days the escalation is
        //    suppressed — the mental-model copy is the only intervention.
        const householdAgeMs = await households.getHouseholdAge(householdId);
        if (householdAgeMs < FOURTEEN_DAYS_MS) {
          // 4. Idempotency guard — the flag is permanent once set. Skip both
          //    the DB write and the threshold audit row on repeat bursts so the
          //    audit log records a single crossing event, not one per burst.
          const alreadyFlagged = await households.getTileGhostFlag(householdId);
          if (!alreadyFlagged) {
            await households.setTileGhostFlag(householdId);

            // Second audit row marking the threshold crossing. Same event_type
            // so the ops dashboard can count occurrences and crossings in one
            // query; threshold_reached:true distinguishes the crossing event.
            await auditService.write({
              event_type: 'tile.edit_retried',
              user_id: userId,
              household_id: householdId,
              request_id: request.id,
              metadata: {
                tile_id: body.tile_id,
                edit_key: body.edit_key,
                timestamp_ms: body.timestamp_ms,
                threshold_reached: true,
                retry_count: retryCount,
              },
            });

            request.log.info(
              {
                module: 'households',
                action: 'tile.ghost_timestamp_enabled',
                user_id: userId,
                household_id: householdId,
                edit_key: body.edit_key,
                retry_count: retryCount,
                household_age_ms: householdAgeMs,
              },
              'tile ghost-timestamp flag flipped on retry burst',
            );
          }
        }
      }

      return reply.code(204).send();
    },
  );

  // GET /v1/households/:householdId/brief — single-row read from the
  // brief_state projection. Never composes at request time
  // (architecture §1.5). Returns { brief: null } when no plan has been
  // committed yet.
  const requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.get(
    '/v1/households/:householdId/brief',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 200: BriefResponseSchema },
      },
    },
    async (request) => {
      const { householdId } = request.params as { householdId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household brief');
      }
      const brief = await fastify.plansService.getBrief(householdId);
      return { brief };
    },
  );

  // Story 7-S1 — GET /v1/households/:householdId/memory — Visible Memory read.
  // Returns active memory nodes only (hard_forgotten=false AND
  // soft_forget_at IS NULL), ordered created_at ASC. Distinct from the
  // planner recall path, which keeps soft-forgotten nodes visible.
  fastify.get(
    '/v1/households/:householdId/memory',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 200: GetMemoryResponseSchema },
      },
    },
    async (request) => {
      const { householdId } = request.params as { householdId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household memory');
      }
      const nodes = await fastify.memoryService.findActive(householdId);
      return { nodes };
    },
  );

  // Slice 5-S2 — GET /v1/households/:id/members — household roster (name +
  // role). Both caregivers may read; guest_authors are filtered out in the
  // repository query. 403 on cross-household read, matching sibling routes.
  fastify.get(
    '/v1/households/:id/members',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: HouseholdIdParamSchema,
        response: { 200: HouseholdMembersResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household roster');
      }
      const rows = await userRepository.findByHousehold(householdId);
      const { data: hhRow } = (await fastify.supabase
        .from('households')
        .select('display_name')
        .eq('id', householdId)
        .single()) as { data: { display_name: string | null } | null; error: unknown };
      return {
        household_display_name: hhRow?.display_name ?? null,
        members: rows.map((row) => ({
          user_id: row.id,
          display_name: row.display_name,
          role: row.role,
        })),
      };
    },
  );

  // Slice 5-S3 — GET /v1/households/:id/packers — all day_assignments rows for
  // the household, packer_display_name resolved from a single roster read
  // (avoids N+1). Either caregiver may read; 403 on cross-household.
  fastify.get(
    '/v1/households/:id/packers',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: HouseholdIdParamSchema,
        response: { 200: DayAssignmentsResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household packers');
      }
      const rows = await dayAssignmentsRepo.findByHousehold(householdId);
      const members = await userRepository.findByHousehold(householdId);
      const nameById = new Map(members.map((m) => [m.id, m.display_name]));
      return {
        assignments: rows.map((row) => ({
          date: row.date,
          packer_user_id: row.packer_user_id,
          packer_display_name:
            row.packer_user_id !== null ? nameById.get(row.packer_user_id) ?? null : null,
        })),
      };
    },
  );

  // Slice 5-S3 — PATCH /v1/households/:id/days/:date/packer — assign (or clear,
  // with packer_user_id=null) the packer for one day. Upserts the row, emits a
  // `packer.assigned` SSE on assignment (not on clear — the contract's packer_id
  // is non-nullable), and best-effort appends a system_event turn to the
  // household's lazily-created coordination thread.
  fastify.patch(
    '/v1/households/:id/days/:date/packer',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: HouseholdIdParamSchema.extend({ date: z.string() }),
        body: AssignPackerRequestSchema,
        response: { 200: AssignPackerResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId, date } = request.params as { id: string; date: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot assign packers for another household');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ValidationError('date must be an ISO date (YYYY-MM-DD)');
      }
      const body = request.body as AssignPackerRequest;

      // P1 fix: validate membership before upsert so a foreign UUID is never
      // written to day_assignments. findByHousehold also resolves display_name,
      // replacing the previous unscoped findUserById call.
      let packerDisplayName: string | null = null;
      if (body.packer_user_id) {
        const members = await userRepository.findByHousehold(householdId);
        const member = members.find((m) => m.id === body.packer_user_id);
        if (!member) {
          throw new ValidationError('packer_user_id must be a member of this household');
        }
        packerDisplayName = member.display_name ?? null;
      }

      const row = await dayAssignmentsRepo.upsert(
        householdId,
        date,
        body.packer_user_id,
        request.user.id,
      );

      // Emit only when assigning — the packer.assigned SSE contract carries a
      // non-nullable packer_id, so an unassign has no event to send.
      if (body.packer_user_id) {
        fastify.sseDispatcher.emit(
          householdId,
          'message',
          JSON.stringify({ type: 'packer.assigned', date, packer_id: body.packer_user_id }),
        );
      }

      // Best-effort coordination-thread turn. A failure here must not fail the
      // assignment — the row + SSE already landed.
      try {
        let thread = await threadRepository.findActiveThreadByHousehold(
          householdId,
          'coordination',
          'text',
        );
        if (!thread) {
          thread = await threadRepository.createThread(householdId, 'coordination', 'text');
        }
        const turn = await threadRepository.appendTurnNext({
          threadId: thread.id,
          role: 'system',
          body: {
            type: 'system_event',
            event: 'packer.assigned',
            payload: {
              date,
              packer_user_id: body.packer_user_id,
              packer_display_name: packerDisplayName,
            },
          },
          modality: 'text',
        });
        // Slice 5-S4 — emit thread.turn so open tabs track server_seq for gap
        // detection. server_seq is stringified: PostgreSQL bigint comes back as
        // a string from supabase-js and JSON.stringify drops a native bigint;
        // SequenceId accepts a numeric string. Fires on both assign and clear
        // (a cleared assignment is still a coordination event worth tracking).
        fastify.sseDispatcher.emit(
          householdId,
          'message',
          JSON.stringify({
            type: 'thread.turn',
            thread_id: thread.id,
            turn: {
              id: turn.id,
              thread_id: turn.thread_id,
              server_seq: String(turn.server_seq),
              created_at: turn.created_at,
              role: turn.role,
              body: turn.body,
              modality: turn.modality,
            },
          }),
        );
      } catch (err) {
        fastify.log.warn({ err }, 'packer: failed to write coordination thread turn');
      }

      return {
        date,
        packer_user_id: row.packer_user_id,
        packer_display_name: packerDisplayName,
      };
    },
  );

  // Story 7-S8 — GET /v1/households/:householdId/dashboard
  // Parental review dashboard: per-child + household-level data-collection summary.
  // Read-only aggregation of existing data. 403 on cross-household read (no oracle),
  // matching the sibling /memory route.
  fastify.get(
    '/v1/households/:householdId/dashboard',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 200: ParentalDashboardResponseSchema },
      },
    },
    async (request) => {
      const { householdId } = request.params as { householdId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household dashboard');
      }
      return parentalDashboardService.getDashboard(householdId);
    },
  );

  // Story 7-S9 — GET /v1/households/:householdId/consent-history
  // Full chronological consent history: vpc.consented + parental_notice.acknowledged
  // + account.* audit events, newest-first. Read-only; 403 on cross-household (no
  // oracle), matching the sibling /memory and /dashboard routes.
  fastify.get(
    '/v1/households/:householdId/consent-history',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 200: ConsentHistoryResponseSchema },
      },
    },
    async (request) => {
      const { householdId } = request.params as { householdId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household consent history');
      }
      const events = await auditService.getConsentHistory(householdId);
      return { events };
    },
  );

  // Story 7-S10 — POST /v1/households/:householdId/export
  // Data portability: queues a BullMQ job to compose a full JSON snapshot and
  // email a signed 30-day Supabase Storage URL. Primary Parent only (AADC
  // right-to-portability; secondary_caregiver cannot initiate an export).
  // Returns 202 immediately — export runs asynchronously in the background.
  fastify.post(
    '/v1/households/:householdId/export',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 202: DataExportResponseSchema },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params as { householdId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot export another household');
      }
      const exportQueue = fastify.bullmq.getQueue(DATA_EXPORT_QUEUE);
      await exportQueue.add(
        'compose-export',
        {
          household_id: householdId,
          user_id: request.user.id,
          request_id: randomUUID(),
        } satisfies DataExportJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60_000 },
          removeOnComplete: { count: 10 },
          removeOnFail: { count: 10 },
        },
      );
      reply.status(202);
      return {
        status: 'queued' as const,
        message:
          "We're preparing your export. You'll receive an email with a download link within 72 hours.",
      };
    },
  );

  // Story 7-S11 — POST /v1/households/:householdId/delete
  // COPPA right-to-delete (FR69, NFR-PRIV-2). Regulatory MVP wall.
  // Soft-deletes the household (sets deletion_requested_at), bans the caller,
  // and revokes all active sessions. Hard-delete runs at day 30 via
  // account-deletion.job.ts. Primary Parent only.
  fastify.post(
    '/v1/households/:householdId/delete',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        body: DeleteHouseholdRequestSchema,
        response: { 200: DeleteHouseholdResponseSchema },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params as { householdId: string };
      const { confirmation_name } = request.body as { confirmation_name: string };

      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot delete another household');
      }

      const household = await households.getDisplayName(householdId);
      if (!household) {
        throw new NotFoundError(`Household not found: ${householdId}`);
      }

      // Idempotent: if deletion is already scheduled, return early with no
      // repeat auth revocation.
      if (household.deletion_requested_at !== null) {
        const scheduledAt = new Date(
          new Date(household.deletion_requested_at).getTime() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
        reply.status(200);
        return {
          status: 'already_scheduled' as const,
          scheduled_hard_delete_at: scheduledAt,
          message: 'Account deletion is already scheduled.',
        };
      }

      // Confirmation name check (case-insensitive, trimmed).
      const expectedName = (household.display_name ?? '').trim().toLowerCase();
      const givenName = confirmation_name.trim().toLowerCase();
      if (expectedName === '' || expectedName !== givenName) {
        throw new ValidationError('Household name does not match');
      }

      const now = new Date().toISOString();
      const scheduledHardDeleteAt = new Date(
        new Date(now).getTime() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();

      // 1. Soft-delete: set deletion_requested_at.
      await households.requestDeletion(householdId, now);

      // 2. Ban login (~100-year ban prevents any re-authentication).
      await fastify.supabase.auth.admin.updateUserById(request.user.id, {
        ban_duration: '876600h',
      });

      // 3. Revoke all active sessions.
      await fastify.supabase.auth.admin.signOut(request.user.id, 'global');

      // 4. Audit row (best-effort — the deletion is already scheduled).
      try {
        await auditService.write({
          event_type: 'account.deletion_requested',
          household_id: householdId,
          user_id: request.user.id,
          request_id: randomUUID(),
          metadata: { scheduled_hard_delete_at: scheduledHardDeleteAt },
        });
      } catch (auditErr) {
        request.log.warn(
          { err: auditErr, module: 'households', action: 'audit.failed', householdId },
          'account-deletion: audit write failed — deletion scheduled, continuing',
        );
      }

      reply.status(200);
      return {
        status: 'scheduled' as const,
        scheduled_hard_delete_at: scheduledHardDeleteAt,
        message:
          'Your account deletion has been scheduled. Your data will be permanently erased within 30 days.',
      };
    },
  );

  // Story 3.21 — POST /v1/households/:id/extra-library
  // Save a parent-authored Extra entry the planner can choose from on future
  // plans. Primary Parent only — library entries persist household-wide.
  fastify.post(
    '/v1/households/:id/extra-library',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: ExtraLibraryHouseholdIdParamSchema,
        body: CreateExtraLibraryItemInputSchema,
        response: { 201: ExtraLibraryItemSchema },
      },
    },
    async (request, reply) => {
      const { id: householdId } = request.params as { id: string };
      // Cross-household guard: even though the JWT scopes the user, the URL
      // path id is independent. Reject mismatches to avoid an authenticated
      // primary parent writing into another household's library.
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError("Cannot add to another household's extra library");
      }
      const body = request.body as CreateExtraLibraryItemInput;
      const item = await extraLibraryRepository.create({
        householdId,
        name: body.name,
        description: body.description ?? null,
        componentType: body.component_type,
        isAllergenFree: body.is_allergen_free,
        createdBy: request.user.id,
      });

      // Audit metadata is PII-free — only ids and the component_type label.
      // The free-text `name` and `description` fields are user-authored and
      // could carry trivial PII (e.g. a child's nickname); they are NOT
      // copied into the audit row.
      request.auditContext = {
        event_type: 'household.extra_library_item_created',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: {
          item_id: item.id,
          component_type: item.component_type,
          is_allergen_free: item.is_allergen_free,
        },
      };
      return reply.status(201).send(item);
    },
  );

  // Story 3.21 — GET /v1/households/:id/extra-library
  // Either caregiver may read; the audit trail captures the parent who
  // mutated. Filters out archived entries.
  fastify.get(
    '/v1/households/:id/extra-library',
    {
      preHandler: authorize(['primary_parent', 'secondary_caregiver']),
      schema: {
        params: ExtraLibraryHouseholdIdParamSchema,
        response: { 200: ListExtraLibraryResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Cannot access another household library');
      }
      const items = await extraLibraryRepository.findByHousehold(householdId);
      return reply.status(200).send({ items });
    },
  );

  // Story 3.21 — DELETE /v1/households/:id/extra-library/:itemId
  // Soft-deletes a library item so plan_slots references and audit history
  // continue to resolve. Primary Parent only — library entries are
  // household-level decisions.
  fastify.delete(
    '/v1/households/:id/extra-library/:itemId',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: ExtraLibraryHouseholdIdParamSchema.extend({ itemId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const { id: householdId, itemId } = request.params as { id: string; itemId: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError("Cannot archive another household's extra library item");
      }
      const archived = await extraLibraryRepository.archive(itemId, householdId);
      if (!archived) {
        throw new NotFoundError(`extra library item not found: ${itemId}`);
      }

      request.auditContext = {
        event_type: 'household.extra_library_item_archived',
        user_id: request.user.id,
        household_id: householdId,
        correlation_id: request.id,
        request_id: request.id,
        metadata: { item_id: itemId },
      };

      return reply.code(204).send();
    },
  );
  // Slice 2-s27 — household-level food-identity profile. Cultural identifiers,
  // dietary preferences, and household-wide declared allergens live on the
  // household now (moved up from per-child). PATCH semantics: omit → preserve;
  // empty array → clear; non-empty array → replace.
  fastify.patch(
    '/v1/households/:id',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: HouseholdIdParamSchema,
        body: HouseholdProfilePatchBodySchema,
        response: { 200: HouseholdProfileResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError("Cannot update another household's profile");
      }
      const body = request.body as HouseholdProfilePatchBody;
      let updated;
      try {
        updated = await householdsService.patchProfile(householdId, body);
      } catch (err) {
        // VocabularyService rejects unknown tags with a plain Error; surface
        // as a 400 so the parent (or agent) gets actionable feedback.
        if (err instanceof Error && /Unknown or inactive/.test(err.message)) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      // PII-free audit metadata: only the field names that were touched and
      // their counts. Tag values themselves are user-authored and could leak
      // sensitive identifiers (e.g. specific religious affiliations) — never
      // copied into the audit row.
      const changed_fields: string[] = [];
      if (body.cultural_identifiers !== undefined) changed_fields.push('cultural_identifiers');
      if (body.dietary_preferences !== undefined) changed_fields.push('dietary_preferences');
      if (body.declared_allergens !== undefined) changed_fields.push('declared_allergens');

      request.auditContext = {
        event_type: 'household.profile_updated',
        user_id: request.user.id,
        household_id: householdId,
        request_id: request.id,
        metadata: {
          changed_fields,
          cultural_count: updated.cultural_identifiers.length,
          dietary_count: updated.dietary_preferences.length,
          allergen_count: updated.declared_allergens.length,
        },
      };

      return updated;
    },
  );

  // Story 3.29 — PATCH /v1/households/:id/sovereignty-mode
  // Primary Parent toggles cultural rule reconciliation between 'unified' (the
  // default — honor all rules simultaneously) and 'alternating' (rotate which
  // tradition leads each day). On success: clears any active degraded
  // plan_state in brief_state and triggers a regen so the parent sees the
  // alternating plan immediately.
  fastify.patch(
    '/v1/households/:id/sovereignty-mode',
    {
      preHandler: authorize(['primary_parent']),
      schema: {
        params: HouseholdIdParamSchema,
        body: UpdateSovereigntyModeInputSchema,
        response: { 200: UpdateSovereigntyModeResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: householdId } = request.params as { id: string };
      if (householdId !== request.user.household_id) {
        throw new ForbiddenError('Not your household');
      }
      const body = request.body as UpdateSovereigntyModeInput;

      const currentMode = await households.getSovereigntyMode(householdId);
      if (currentMode === body.sovereignty_mode) {
        return reply.send({ sovereignty_mode: body.sovereignty_mode });
      }

      await households.setSovereigntyMode(householdId, body.sovereignty_mode);

      // Clear the degraded plan_state — the parent has acknowledged and chosen
      // a mode. Filtered to plan_state='degraded' inside the repo so a future
      // 'hard_failed' row is not accidentally cleared.
      await fastify.plansService.clearDegradedPlanState(householdId);

      try {
        await auditService.write({
          event_type: 'household.sovereignty_mode_changed',
          user_id: request.user.id,
          household_id: householdId,
          request_id: request.id,
          metadata: { sovereignty_mode: body.sovereignty_mode },
        });
      } catch (err) {
        request.log.error(
          { err, household_id: householdId },
          'audit write failed for household.sovereignty_mode_changed',
        );
      }

      // Fire a regen so the parent sees the new plan immediately. Failure here
      // is non-fatal — the mode change is persisted; the next scheduled fan-out
      // will pick it up.
      try {
        await fastify.planAdjustmentService.triggerAdjustment({
          type: 'cultural_sovereignty_mode_changed',
          householdId,
          slotScope: 'bag_wide',
          dayScope: null,
          requestId: request.id,
          metadata: { sovereignty_mode: body.sovereignty_mode },
        });
      } catch (err) {
        request.log.error(
          { err, household_id: householdId },
          'plan-adjustment regen trigger failed — mode change persisted',
        );
      }

      return reply.send({ sovereignty_mode: body.sovereignty_mode });
    },
  );
};

export const householdsRoutes = fp(householdsRoutesPlugin, { name: 'households-routes' });
