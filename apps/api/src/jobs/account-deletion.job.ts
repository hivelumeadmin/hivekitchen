import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditService } from '../audit/audit.service.js';
import { HouseholdsRepository } from '../modules/households/households.repository.js';

export const ACCOUNT_DELETION_QUEUE = 'account-deletion';
const ACCOUNT_DELETION_SCHEDULER_ID = 'nightly-account-deletion';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// These audit event types are retained for regulatory purposes even after the
// household is hard-deleted. All other event_types for the household are purged.
const REGULATORY_EVENT_TYPES = [
  'billing.subscribed',
  'billing.cancelled',
  'billing.payment_failed',
  'billing.payment_recovered',
  'billing.upgraded',
  'billing.downgraded',
  'billing.gift_redeemed',
  'allergy.guardrail_rejection',
  'allergy.uncertainty',
  'allergy.check_overridden',
  'vpc.consented',
  'parental_notice.acknowledged',
  'account.created',
  'account.deletion_requested',
  'account.hard_deleted',
] as const;

const PROCESSORS = [
  'supabase_auth',
  'elevenlabs',
  'sendgrid',
  'twilio',
  'stripe',
  'openai',
] as const;

export interface AccountDeletionDeps {
  supabase: SupabaseClient;
  audit: Pick<AuditService, 'write'>;
  logger: FastifyBaseLogger;
}

// Reads the ids of every row in `table` scoped to this household. Child-scoped
// tables are deleted via a two-step (fetch parent ids → .in(...)) because
// Supabase JS .in() takes an array, not a subquery. Returns [] on any read
// failure (e.g. a table that doesn't exist yet) so the cascade keeps going.
async function fetchScopedIds(
  supabase: SupabaseClient,
  table: string,
  householdId: string,
  logger: FastifyBaseLogger,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.from(table).select('id').eq('household_id', householdId);
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch (err) {
    logger.warn(
      { err, householdId, table },
      `account-deletion: id lookup for ${table} failed — dependent deletes will be skipped`,
    );
    return [];
  }
}

// Story 7-S11 — the hard-delete cascade for one household, extracted from the
// worker callback so it can be unit-tested without standing up BullMQ. Writes
// the account.hard_deleted audit row first (while household_id is still valid),
// cascades the deletes in dependency order (children before plans, users before
// households, households LAST), selectively purges audit_log, then runs the
// per-processor erasure stubs. A households-row delete failure re-throws so the
// job retries; every other step is best-effort.
export async function runAccountDeletion(
  deps: AccountDeletionDeps,
  household: { id: string; deletion_requested_at: string },
): Promise<void> {
  const { supabase, audit, logger } = deps;
  const householdId = household.id;

  logger.info(
    { module: 'account-deletion', householdId },
    'account-deletion: starting hard-delete cascade',
  );

  // ── 0. Find all household user IDs BEFORE deleting users rows ───────────
  // Captures every role (primary_parent + secondary_caregiver) so supabase_auth
  // erasure removes all auth identities, not just the primary parent's.
  let householdUserIds: string[] = [];
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('current_household_id', householdId);
    if (error) throw error;
    householdUserIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch (err) {
    logger.warn(
      { err, householdId },
      'account-deletion: household user lookup failed — supabase_auth erasure will be skipped',
    );
  }

  // ── 1. Write account.hard_deleted audit row FIRST ────────────────────────
  try {
    await audit.write({
      event_type: 'account.hard_deleted',
      household_id: householdId,
      request_id: householdId, // stable dedup key; no UUID to avoid Date.now()
      metadata: { cascade_started_at: household.deletion_requested_at },
    });
  } catch (auditErr) {
    logger.warn(
      { err: auditErr, householdId },
      'account-deletion: audit.hard_deleted write failed — cascade continues',
    );
  }

  // ── 2. Hard-delete cascade (dependency order) ────────────────────────────
  const childIds = await fetchScopedIds(supabase, 'children', householdId, logger);
  const memoryNodeIds = await fetchScopedIds(supabase, 'memory_nodes', householdId, logger);
  const threadIds = await fetchScopedIds(supabase, 'threads', householdId, logger);

  // ids: null → delete .eq(column, householdId); ids: [...] → delete .in(column, ids).
  const ops: Array<{ table: string; column: string; ids: string[] | null }> = [
    { table: 'memory_provenance', column: 'memory_node_id', ids: memoryNodeIds },
    { table: 'memory_nodes', column: 'household_id', ids: null },
    { table: 'child_allergens', column: 'child_id', ids: childIds },
    { table: 'child_preferences', column: 'child_id', ids: childIds },
    { table: 'child_lunch_requests', column: 'household_id', ids: null },
    { table: 'flavor_passport_stamps', column: 'child_id', ids: childIds },
    { table: 'children', column: 'household_id', ids: null },
    { table: 'plan_day_context', column: 'household_id', ids: null },
    { table: 'plans', column: 'household_id', ids: null },
    { table: 'heart_notes', column: 'household_id', ids: null },
    { table: 'lunch_link_sessions', column: 'household_id', ids: null },
    { table: 'vpc_consents', column: 'household_id', ids: null },
    { table: 'thread_turns', column: 'thread_id', ids: threadIds },
    { table: 'threads', column: 'household_id', ids: null },
    { table: 'household_recipe_usage', column: 'household_id', ids: null },
    { table: 'brief_state', column: 'household_id', ids: null },
    { table: 'users', column: 'current_household_id', ids: null },
  ];

  for (const op of ops) {
    try {
      if (op.ids !== null) {
        if (op.ids.length === 0) continue;
        const { error } = await supabase.from(op.table).delete().in(op.column, op.ids);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(op.table).delete().eq(op.column, householdId);
        if (error) throw error;
      }
      logger.info(
        { module: 'account-deletion', householdId, table: op.table },
        `account-deletion: deleted ${op.table}`,
      );
    } catch (err) {
      // Missing table or transient error: log and continue — never halt the
      // cascade on a single table.
      logger.warn(
        { err, householdId, table: op.table },
        `account-deletion: delete from ${op.table} failed — continuing`,
      );
    }
  }

  // ── 3. Selective audit_log purge (keep regulatory-retention rows) ────────
  try {
    const { error } = await supabase
      .from('audit_log')
      .delete()
      .eq('household_id', householdId)
      .not('event_type', 'in', `(${REGULATORY_EVENT_TYPES.map((t) => `"${t}"`).join(',')})`);
    if (error) throw error;
  } catch (err) {
    logger.warn(
      { err, householdId },
      'account-deletion: audit_log selective purge failed — continuing',
    );
  }

  // ── 4. Delete households row (LAST) ──────────────────────────────────────
  const { error: householdDeleteError } = await supabase
    .from('households')
    .delete()
    .eq('id', householdId);
  if (householdDeleteError) {
    // households delete failure is critical — re-throw so the job retries.
    throw householdDeleteError;
  }
  logger.info(
    { module: 'account-deletion', householdId },
    'account-deletion: households row deleted',
  );

  // ── 5. Processor erasure stubs ───────────────────────────────────────────
  // Run sequentially (not Promise.all) to avoid partial-log ambiguity. Called
  // AFTER the households row is gone to avoid a FK violation on supabase_auth.
  for (const processor of PROCESSORS) {
    const attemptedAt = new Date().toISOString();
    let status: 'completed' | 'failed' = 'completed';
    let errorMessage: string | null = null;

    logger.info(
      { module: 'account-deletion', householdId, processor },
      `account-deletion: running processor erasure for ${processor}`,
    );

    try {
      if (processor === 'supabase_auth') {
        if (householdUserIds.length > 0) {
          for (const uid of householdUserIds) {
            await supabase.auth.admin.deleteUser(uid);
          }
          logger.info(
            { module: 'account-deletion', householdId, processor, count: householdUserIds.length },
            'account-deletion: supabase_auth users deleted',
          );
        } else {
          logger.warn(
            { module: 'account-deletion', householdId, processor },
            'account-deletion: no household users found — skipping auth deletion',
          );
        }
      } else {
        // TODO: implement real erasure call — stubbed at MVP.
        // ElevenLabs: no user-level deletion API at MVP.
        // SendGrid: no contact management needed (account deleted, no future sends).
        // Twilio: no user record stored at MVP.
        // Stripe: cancel subscription via Stripe API if active billing exists.
        // OpenAI: no user-level data stored (stateless prompt calls only).
        logger.info(
          { module: 'account-deletion', householdId, processor },
          `account-deletion: ${processor} erasure stubbed at MVP`,
        );
      }
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, householdId, processor },
        `account-deletion: ${processor} erasure failed`,
      );
    }

    const completedAt = new Date().toISOString();
    try {
      const { error } = await supabase.from('processor_deletion_log').insert({
        household_id: householdId,
        processor,
        status,
        error_message: errorMessage,
        attempted_at: attemptedAt,
        completed_at: status === 'completed' ? completedAt : null,
      });
      if (error) throw error;
    } catch (logErr) {
      logger.warn(
        { err: logErr, householdId, processor },
        'account-deletion: processor_deletion_log write failed',
      );
    }
  }

  logger.info(
    { module: 'account-deletion', householdId },
    'account-deletion: cascade complete',
  );
}

const accountDeletionPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('accountDeletionPlugin requires supabase — register supabasePlugin first');
  }

  const queue = fastify.bullmq.getQueue(ACCOUNT_DELETION_QUEUE);

  // Nightly cron: 4am UTC (1h after the memory-forget job at 3am UTC).
  void queue
    .upsertJobScheduler(
      ACCOUNT_DELETION_SCHEDULER_ID,
      { pattern: '0 4 * * *', tz: 'UTC' },
      {
        name: 'sweep',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60_000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 14 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'account-deletion', action: 'scheduler.registration.failed' },
        'failed to register account-deletion scheduler',
      );
    });

  fastify.bullmq.getWorker(ACCOUNT_DELETION_QUEUE, async () => {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const householdsRepo = new HouseholdsRepository(fastify.supabase, null);
    const pendingHouseholds = await householdsRepo.findPendingHardDeletes(cutoff);

    fastify.log.info(
      { module: 'account-deletion', count: pendingHouseholds.length },
      `account-deletion: found ${pendingHouseholds.length} households pending hard-delete`,
    );

    const deps: AccountDeletionDeps = {
      supabase: fastify.supabase,
      audit: fastify.auditService,
      logger: fastify.log,
    };

    for (const household of pendingHouseholds) {
      try {
        await runAccountDeletion(deps, household);
      } catch (err) {
        // Per-household failure must NOT halt other households.
        fastify.log.error(
          { err, module: 'account-deletion', householdId: household.id },
          'account-deletion: household cascade failed — skipping to next',
        );
      }
    }
  });
};

export const accountDeletionJobPlugin = fp(accountDeletionPlugin, {
  name: 'account-deletion-job',
});
