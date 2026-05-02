import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BriefResponseSchema, TileRetryRequestSchema } from '@hivekitchen/contracts';
import type { TileRetryRequest } from '@hivekitchen/contracts';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { ForbiddenError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';
import { HouseholdsRepository } from './households.repository.js';

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
  const auditService = new AuditService(new AuditRepository(fastify.supabase));

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
};

export const householdsRoutes = fp(householdsRoutesPlugin, { name: 'households-routes' });
