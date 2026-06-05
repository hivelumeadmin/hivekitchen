import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { MemoryRepository } from '../modules/memory/memory.repository.js';
import type { AuditService } from '../audit/audit.service.js';

const MEMORY_FORGET_QUEUE = 'memory-forget';
const MEMORY_FORGET_SCHEDULER_ID = 'nightly-memory-forget';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface MemoryForgetSweepDeps {
  repo: Pick<MemoryRepository, 'hardDeleteSoftForgotten'>;
  audit: Pick<AuditService, 'write'>;
  logger: FastifyBaseLogger;
}

// Story 7-S5 — the nightly sweep body, extracted from the worker callback so it
// can be unit-tested without standing up BullMQ. Hard-deletes every node whose
// soft_forget_at is older than 30 days, then writes one best-effort
// memory.hard_forgotten audit row per deleted node. Re-throws on delete failure
// so the worker triggers a BullMQ retry; individual audit failures are swallowed
// (the deletion is already committed and must not be re-attempted).
export async function runMemoryForgetSweep(deps: MemoryForgetSweepDeps): Promise<{ count: number }> {
  const cutoffAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  let deleted: Array<{ id: string; household_id: string; node_type: string }>;
  try {
    deleted = await deps.repo.hardDeleteSoftForgotten(cutoffAt);
  } catch (err) {
    deps.logger.error(
      { err, module: 'memory-forget', action: 'hard_delete.failed', cutoffAt },
      'memory-forget: hard-delete query failed',
    );
    throw err; // BullMQ retries (attempts: 3)
  }

  deps.logger.info(
    { module: 'memory-forget', action: 'promotion.complete', count: deleted.length, cutoffAt },
    'memory-forget: hard-deleted soft-forgotten nodes',
  );

  for (const node of deleted) {
    try {
      await deps.audit.write({
        event_type: 'memory.hard_forgotten',
        household_id: node.household_id,
        request_id: randomUUID(),
        metadata: { node_id: node.id, node_type: node.node_type },
      });
    } catch (err) {
      deps.logger.warn(
        { err, module: 'memory-forget', action: 'tombstone_audit.failed', node_id: node.id },
        'tombstone audit write failed — deletion committed, continuing',
      );
    }
  }

  return { count: deleted.length };
}

const memoryForgetPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('memoryForgetPlugin requires supabase — register supabasePlugin first');
  }

  const repo = new MemoryRepository(fastify.supabase);
  const queue = fastify.bullmq.getQueue(MEMORY_FORGET_QUEUE);

  void queue
    .upsertJobScheduler(
      MEMORY_FORGET_SCHEDULER_ID,
      { pattern: '0 3 * * *', tz: 'UTC' },
      {
        name: 'promote-soft-forgotten',
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
        { err, module: 'memory-forget', action: 'scheduler.registration.failed' },
        'failed to register memory-forget scheduler',
      );
    });

  fastify.bullmq.getWorker(MEMORY_FORGET_QUEUE, async () => {
    await runMemoryForgetSweep({
      repo,
      audit: fastify.auditService,
      logger: fastify.log,
    });
  });
};

export const memoryForgetJobPlugin = fp(memoryForgetPlugin, {
  name: 'memory-forget-job',
});
