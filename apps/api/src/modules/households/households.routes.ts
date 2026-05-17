import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  BriefResponseSchema,
  TileRetryRequestSchema,
  CreateExtraLibraryItemInputSchema,
  ExtraLibraryItemSchema,
  ListExtraLibraryResponseSchema,
  ExtraLibraryHouseholdIdParamSchema,
  HouseholdIdParamSchema,
  HouseholdProfilePatchBodySchema,
  HouseholdProfileResponseSchema,
} from '@hivekitchen/contracts';
import type {
  TileRetryRequest,
  HouseholdProfilePatchBody,
} from '@hivekitchen/contracts';
import type { CreateExtraLibraryItemInput } from '@hivekitchen/types';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { HouseholdsRepository } from './households.repository.js';
import { HouseholdsService } from './households.service.js';
import { ExtraLibraryRepository } from './extra-library.repository.js';

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
  // Soft-deletes a library item so plan_items references and audit history
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
};

export const householdsRoutes = fp(householdsRoutesPlugin, { name: 'households-routes' });
