import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js';

const REVERT_QUEUE = 'day-override-revert';
const REVERT_SCHEDULER_ID = 'day-override-revert-nightly';

const dayOverrideRevertPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error(
      'dayOverrideRevertPlugin requires supabase decorator — register supabasePlugin first',
    );
  }

  const repo = new PlanDayContextRepository(fastify.supabase);
  const queue = fastify.bullmq.getQueue(REVERT_QUEUE);

  // Story 3.19 — nightly soft-revert sweep at 00:05 UTC. The five-minute
  // offset gives late-night override writes time to land before the sweep
  // runs. If the worker is down at fire time the next tick catches up.
  void queue
    .upsertJobScheduler(
      REVERT_SCHEDULER_ID,
      { pattern: '5 0 * * *', tz: 'UTC' },
      {
        name: 'revert-expired',
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 7 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'day-override-revert', action: 'scheduler.registration.failed' },
        'failed to register day-override revert scheduler',
      );
    });

  fastify.bullmq.getWorker(REVERT_QUEUE, async (_job: Job) => {
    const reverted = await repo.revertExpired();
    fastify.log.info(
      { module: 'day-override-revert', action: 'sweep.complete', reverted },
      'day-override-revert: reverted expired overrides',
    );
  });
};

export const dayOverrideRevertJobPlugin = fp(dayOverrideRevertPlugin, {
  name: 'day-override-revert-job',
});
