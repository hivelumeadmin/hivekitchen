import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import { HeartNoteRepository } from '../modules/heart-notes/heart-note.repository.js';

const DELIVERY_QUEUE = 'heart-note-delivery';
const DELIVERY_SCHEDULER_ID = 'heart-note-delivery-daily';

// Slice 4-S6 — daily sweep at 06:00 UTC: any note whose status is 'scheduled'
// and whose scheduled_for matches today flips to 'delivered' with delivered_at
// stamped to now. The repository UPDATE never reads or decrypts content, so
// the repo is constructed with kek = null intentionally.
const heartNoteDeliveryPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error(
      'heartNoteDeliveryPlugin requires supabase decorator — register supabasePlugin first',
    );
  }

  const repo = new HeartNoteRepository(fastify.supabase, null);
  const queue = fastify.bullmq.getQueue(DELIVERY_QUEUE);

  void queue
    .upsertJobScheduler(
      DELIVERY_SCHEDULER_ID,
      { pattern: '0 6 * * *', tz: 'UTC' },
      {
        name: 'deliver-scheduled-notes',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60_000 },
          removeOnComplete: { count: 14 },
          removeOnFail: { count: 14 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'heart-note-delivery', action: 'scheduler.registration.failed' },
        'failed to register heart-note delivery scheduler',
      );
    });

  fastify.bullmq.getWorker(DELIVERY_QUEUE, async (_job: Job) => {
    const isoDate = new Date().toISOString().slice(0, 10);
    const count = await repo.deliverScheduled(isoDate);
    fastify.log.info(
      { module: 'heart-note-delivery', action: 'sweep.complete', date: isoDate, count },
      'heart-note-delivery: delivered scheduled notes',
    );
  });
};

export const heartNoteDeliveryJobPlugin = fp(heartNoteDeliveryPlugin, {
  name: 'heart-note-delivery-job',
});
