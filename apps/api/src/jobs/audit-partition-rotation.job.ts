import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';

const QUEUE_NAME = 'audit:partition-rotation';
const SCHEDULER_ID = 'monthly-partition-create';

const auditPartitionRotation: FastifyPluginAsync = async (fastify) => {
  const queue = fastify.bullmq.getQueue(QUEUE_NAME);

  void queue
    .upsertJobScheduler(
      SCHEDULER_ID,
      { pattern: '5 0 1 * *', tz: 'UTC' },
      {
        name: 'create-next-partition',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 300_000 },
          removeOnComplete: { count: 12 },
          removeOnFail: { count: 48 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'audit', action: 'partition.scheduler.registration.failed' },
        'failed to register audit partition rotation scheduler',
      );
    });

  fastify.bullmq.getWorker(QUEUE_NAME, async (job: Job) => {
    fastify.log.info(
      { module: 'audit', action: 'partition.rotation.started', jobId: job.id },
      'creating next audit partition',
    );

    const { data, error } = await fastify.supabase.rpc('create_next_audit_partition');

    if (error) {
      fastify.log.error(
        { err: error, module: 'audit', action: 'partition.rotation.failed' },
        'failed to create audit partition',
      );
      throw error;
    }

    fastify.log.info(
      { module: 'audit', action: 'partition.rotation.completed', partition: data },
      'audit partition created',
    );
  });
};

export const auditPartitionRotationPlugin = fp(auditPartitionRotation, {
  name: 'audit-partition-rotation',
});
